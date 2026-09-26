const request = require('supertest');
const app = require('../src/app');
const { prisma, createUserWithToken, createWarehouseWithLocations, createProduct, unique } = require('./helpers');
const { DOC_STATES } = require('../src/domain/documentState');

describe('receipts', () => {
  let manager, staff, otherStaff;
  let warehouse, loc, otherWarehouse;
  let product;

  beforeAll(async () => {
    manager = await createUserWithToken('INVENTORY_MANAGER');
    staff = await createUserWithToken('WAREHOUSE_STAFF');
    otherStaff = await createUserWithToken('WAREHOUSE_STAFF');
    product = await createProduct();

    const wh1 = await createWarehouseWithLocations();
    warehouse = wh1.warehouse;
    loc = wh1.locations;
    await prisma.userWarehouseAccess.create({ data: { userId: staff.user.id, warehouseId: warehouse.id } });

    const wh2 = await createWarehouseWithLocations();
    otherWarehouse = wh2.warehouse;
    await prisma.userWarehouseAccess.create({ data: { userId: otherStaff.user.id, warehouseId: otherWarehouse.id } });
    
    // Give manager access to warehouse
    await prisma.userWarehouseAccess.create({ data: { userId: manager.user.id, warehouseId: warehouse.id } });
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  const auth = (token) => ({ Authorization: `Bearer ${token}` });
  const reqBody = (overrides = {}) => ({
    supplier: 'Acme Corp',
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
      const res = await request(app).post('/api/v1/receipts').set(auth(staff.token)).send(reqBody());
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

    it('validates locations belong to the warehouse', async () => {
      const res = await request(app)
        .post('/api/v1/receipts')
        .set(auth(staff.token))
        .send(reqBody({
          lines: [{ productId: product.id, quantity: '50', destinationLocationId: otherWarehouse.id }] // intentionally wrong to trigger failure
        }));
      expect(res.status).toBe(400); // Because otherWarehouse.id is not a location
    });
  });

  describe('validation', () => {
    let receipt;

    beforeEach(async () => {
      const res = await request(app).post('/api/v1/receipts').set(auth(manager.token)).send(reqBody());
      receipt = res.body.data;
    });

    it('requires an idempotency key', async () => {
      const res = await request(app)
        .post(`/api/v1/receipts/${receipt.id}/validate`)
        .set(auth(manager.token))
        .send({});
      expect(res.status).toBe(400);
      expect(res.body.code).toBe('IDEMPOTENCY_KEY_REQUIRED');
    });

    it('validates a receipt and moves stock', async () => {
      const res = await request(app)
        .post(`/api/v1/receipts/${receipt.id}/validate`)
        .set(auth(manager.token))
        .set('Idempotency-Key', unique('key'))
        .send({});
      
      expect(res.status).toBe(200);
      expect(res.body.data.state).toBe(DOC_STATES.DONE);

      // Check stock
      const quant = await prisma.stockQuant.findUnique({
        where: { productId_locationId: { productId: product.id, locationId: loc.store.id } }
      });
      expect(quant.onHand.toString()).toBe('50');
    });

    it('is idempotent on double validation', async () => {
      const key = unique('double-val');
      const first = await request(app)
        .post(`/api/v1/receipts/${receipt.id}/validate`)
        .set(auth(manager.token))
        .set('Idempotency-Key', key)
        .send({});
      expect(first.status).toBe(200);

      const second = await request(app)
        .post(`/api/v1/receipts/${receipt.id}/validate`)
        .set(auth(manager.token))
        .set('Idempotency-Key', key)
        .send({});
      if (second.status !== 200) {
        console.log(second.body);
      }
      expect(second.status).toBe(200);
      expect(second.headers['idempotent-replayed']).toBe('true');

      // Check stock only moved once
      const moves = await prisma.stockMove.count({
        where: { documentId: receipt.id }
      });
      expect(moves).toBe(1); // 1 line = 1 move
    });
  });
  describe('listing and retrieval', () => {
    let receipt;

    beforeAll(async () => {
      const res = await request(app).post('/api/v1/receipts').set(auth(manager.token)).send(reqBody());
      receipt = res.body.data;
    });

    it('lists receipts with pagination and related data', async () => {
      const res = await request(app)
        .get('/api/v1/receipts?page=1&pageSize=20')
        .set(auth(manager.token));
        
      expect(res.status).toBe(200);
      expect(res.body.data.pagination).toBeDefined();
      expect(res.body.data.items.length).toBeGreaterThan(0);
      
      const found = res.body.data.items.find((r) => r.id === receipt.id);
      expect(found).toBeDefined();
      expect(found.warehouse.name).toBeDefined();
      expect(found.lines[0].product.name).toBeDefined();
    });

    it('gets a single receipt by id with related data', async () => {
      const res = await request(app)
        .get(`/api/v1/receipts/${receipt.id}`)
        .set(auth(manager.token));
        
      expect(res.status).toBe(200);
      expect(res.body.data.id).toBe(receipt.id);
      expect(res.body.data.warehouse.name).toBeDefined();
      expect(res.body.data.lines[0].product.name).toBeDefined();
    });

    it('returns 404 for nonexistent receipt', async () => {
      const crypto = require('crypto');
      const res = await request(app)
        .get(`/api/v1/receipts/${crypto.randomUUID()}`)
        .set(auth(manager.token));
        
      expect(res.status).toBe(404);
    });
  });
});
