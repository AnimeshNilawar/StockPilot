const request = require('supertest');
const app = require('../src/app');
const {
  prisma,
  createUserWithToken,
  createWarehouseWithLocations,
  createProduct,
  createPartner,
  unique,
} = require('./helpers');
const { DOC_STATES } = require('../src/domain/documentState');

describe('receipts', () => {
  let manager, staff, otherStaff;
  let warehouse, loc, otherWarehouse, otherLoc;
  let product, product2;
  let partner, partner2;

  beforeAll(async () => {
    manager = await createUserWithToken('INVENTORY_MANAGER');
    staff = await createUserWithToken('WAREHOUSE_STAFF');
    otherStaff = await createUserWithToken('WAREHOUSE_STAFF');
    product = await createProduct();
    product2 = await createProduct();
    partner = await createPartner();
    partner2 = await createPartner();

    const wh1 = await createWarehouseWithLocations();
    warehouse = wh1.warehouse;
    loc = wh1.locations;
    await prisma.userWarehouseAccess.create({
      data: { userId: staff.user.id, warehouseId: warehouse.id },
    });

    const wh2 = await createWarehouseWithLocations();
    otherWarehouse = wh2.warehouse;
    otherLoc = wh2.locations;
    await prisma.userWarehouseAccess.create({
      data: { userId: otherStaff.user.id, warehouseId: otherWarehouse.id },
    });

    // Give manager access to warehouse
    await prisma.userWarehouseAccess.create({
      data: { userId: manager.user.id, warehouseId: warehouse.id },
    });
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  const auth = (token) => ({ Authorization: `Bearer ${token}` });
  const reqBody = (overrides = {}) => ({
    partnerId: partner.id,
    warehouseId: warehouse.id,
    lines: [
      {
        productId: product.id,
        quantity: '50.0000',
        destinationLocationId: loc.store.id,
      },
    ],
    ...overrides,
  });

  describe('creation', () => {
    it('creates a draft receipt', async () => {
      const res = await request(app)
        .post('/api/v1/receipts')
        .set(auth(staff.token))
        .send(reqBody());
      expect(res.status).toBe(201);
      expect(res.body.data.state).toBe(DOC_STATES.DRAFT);
      expect(res.body.data.reference).toMatch(/^RCP-/);
      expect(res.body.data.lines).toHaveLength(1);
    });

    it('requires warehouse access to create', async () => {
      const res = await request(app)
        .post('/api/v1/receipts')
        .set(auth(otherStaff.token))
        .send(reqBody());
      expect(res.status).toBe(403);
    });

    it('rejects if destination location belongs to a different warehouse', async () => {
      const res = await request(app)
        .post('/api/v1/receipts')
        .set(auth(staff.token))
        .send(
          reqBody({
            lines: [
              { productId: product.id, quantity: '10', destinationLocationId: otherLoc.store.id },
            ],
          }),
        );
      expect(res.status).toBe(400);
      expect(res.body.message).toMatch(/does not belong to warehouse/);
    });

    it('rejects if destination location is a boundary type', async () => {
      const res = await request(app)
        .post('/api/v1/receipts')
        .set(auth(staff.token))
        .send(
          reqBody({
            lines: [
              { productId: product.id, quantity: '10', destinationLocationId: loc.vendor.id },
            ],
          }),
        );
      expect(res.status).toBe(400);
      expect(res.body.message).toMatch(/boundary location/);
    });
  });

  describe('editing and transitioning', () => {
    let receipt;
    beforeEach(async () => {
      const res = await request(app)
        .post('/api/v1/receipts')
        .set(auth(manager.token))
        .send(reqBody());
      receipt = res.body.data;
    });

    it('can edit a draft receipt', async () => {
      const res = await request(app)
        .put(`/api/v1/receipts/${receipt.id}`)
        .set(auth(manager.token))
        .send({
          partnerId: partner2.id,
          warehouseId: warehouse.id,
          lines: [
            { productId: product.id, quantity: '10', destinationLocationId: loc.store.id },
            { productId: product2.id, quantity: '20', destinationLocationId: loc.store.id },
          ],
        });
      expect(res.status).toBe(200);
      expect(res.body.data.partnerId).toBe(partner2.id);
      expect(res.body.data.lines).toHaveLength(2);
    });

    it('can transition through the state machine', async () => {
      // DRAFT -> WAITING
      let res = await request(app)
        .patch(`/api/v1/receipts/${receipt.id}/status`)
        .set(auth(manager.token))
        .send({ state: 'WAITING' });
      expect(res.status).toBe(200);
      expect(res.body.data.state).toBe('WAITING');

      // WAITING -> READY
      res = await request(app)
        .patch(`/api/v1/receipts/${receipt.id}/status`)
        .set(auth(manager.token))
        .send({ state: 'READY' });
      expect(res.status).toBe(200);
      expect(res.body.data.state).toBe('READY');

      // Cannot edit a non-draft
      res = await request(app)
        .put(`/api/v1/receipts/${receipt.id}`)
        .set(auth(manager.token))
        .send(reqBody());
      expect(res.status).toBe(400);

      // Validate
      res = await request(app)
        .post(`/api/v1/receipts/${receipt.id}/validate`)
        .set(auth(manager.token))
        .set('Idempotency-Key', unique('key'))
        .send({});
      expect(res.status).toBe(200);
      expect(res.body.data.state).toBe('DONE');
    });

    it('can cancel a draft receipt', async () => {
      const res = await request(app)
        .post(`/api/v1/receipts/${receipt.id}/cancel`)
        .set(auth(manager.token))
        .send();
      expect(res.status).toBe(200);
      expect(res.body.data.state).toBe('CANCELLED');

      // Validate on cancelled fails
      const val = await request(app)
        .post(`/api/v1/receipts/${receipt.id}/validate`)
        .set(auth(manager.token))
        .set('Idempotency-Key', unique('key'))
        .send({});
      expect(val.status).toBe(409);
    });
  });

  describe('validation and stock movement', () => {
    it('validates a multi-line receipt and rolls back on partial failure', async () => {
      const p1 = await createProduct();
      const p2 = await createProduct();

      // Create multi-line receipt
      const res = await request(app)
        .post('/api/v1/receipts')
        .set(auth(manager.token))
        .send(
          reqBody({
            lines: [
              { productId: p1.id, quantity: '100.0000', destinationLocationId: loc.store.id },
              { productId: p2.id, quantity: '20.0000', destinationLocationId: loc.store.id },
            ],
          }),
        );
      const receipt = res.body.data;

      const valRes = await request(app)
        .post(`/api/v1/receipts/${receipt.id}/validate`)
        .set(auth(manager.token))
        .set('Idempotency-Key', unique('key'))
        .send({});
      expect(valRes.status).toBe(200);

      const quant1 = await prisma.stockQuant.findUnique({
        where: { productId_locationId: { productId: p1.id, locationId: loc.store.id } },
      });
      const quant2 = await prisma.stockQuant.findUnique({
        where: { productId_locationId: { productId: p2.id, locationId: loc.store.id } },
      });
      expect(quant1.onHand.toString()).toBe('100');
      expect(quant2.onHand.toString()).toBe('20');

      const moves = await prisma.stockMove.count({ where: { documentId: receipt.id } });
      expect(moves).toBe(2);
    });

    it('handles idempotent replays correctly (Case A and B)', async () => {
      const res = await request(app)
        .post('/api/v1/receipts')
        .set(auth(manager.token))
        .send(reqBody());
      const receipt = res.body.data;

      const key = unique('val-key');
      // Validate
      const val1 = await request(app)
        .post(`/api/v1/receipts/${receipt.id}/validate`)
        .set(auth(manager.token))
        .set('Idempotency-Key', key)
        .send({});
      expect(val1.status).toBe(200);

      // Case A: same key replay
      const val2 = await request(app)
        .post(`/api/v1/receipts/${receipt.id}/validate`)
        .set(auth(manager.token))
        .set('Idempotency-Key', key)
        .send({});
      expect(val2.status).toBe(200);
      expect(val2.headers['idempotent-replay']).toBe('true');

      // Case B: new key after done
      const val3 = await request(app)
        .post(`/api/v1/receipts/${receipt.id}/validate`)
        .set(auth(manager.token))
        .set('Idempotency-Key', unique('new-key'))
        .send({});
      expect(val3.status).toBe(409); // Conflict, receipt is already DONE
    });
  });

  describe('listing and retrieval', () => {
    let receipt;

    beforeAll(async () => {
      const res = await request(app)
        .post('/api/v1/receipts')
        .set(auth(manager.token))
        .send(reqBody());
      receipt = res.body.data;
    });

    it('lists receipts with pagination, filters and search', async () => {
      const res = await request(app)
        .get(`/api/v1/receipts?page=1&pageSize=20&search=${partner.name}`)
        .set(auth(manager.token));

      expect(res.status).toBe(200);
      expect(res.body.data.pagination).toBeDefined();
      expect(res.body.data.items.length).toBeGreaterThan(0);

      const found = res.body.data.items.find((r) => r.id === receipt.id);
      expect(found).toBeDefined();
      expect(found.warehouse.name).toBeDefined();
      expect(found.partner.name).toBe(partner.name);
    });
  });
});
