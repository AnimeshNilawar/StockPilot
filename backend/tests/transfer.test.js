const request = require('supertest');
const app = require('../src/app');
const {
  prisma,
  createUserWithToken,
  createWarehouseWithLocations,
  createProduct,
  unique,
  auth,
  trackFixture,
  cleanupFixtures,
} = require('./helpers');
const { DOC_STATES } = require('../src/domain/documentState');
const { LOCATION_TYPES } = require('../src/domain/location');

describe('internal transfers', () => {
  let manager, staff, otherStaff, admin, unprivileged;
  let warehouse, loc, otherWarehouse, otherLoc;
  let product, product2;

  beforeAll(async () => {
    manager = await createUserWithToken('INVENTORY_MANAGER');
    staff = await createUserWithToken('WAREHOUSE_STAFF');
    otherStaff = await createUserWithToken('WAREHOUSE_STAFF');
    admin = await createUserWithToken('ADMIN');

    await prisma.role.upsert({
      where: { name: 'TEST_NO_PERMS_TRANSFER' },
      update: {},
      create: { name: 'TEST_NO_PERMS_TRANSFER' },
    });
    unprivileged = await createUserWithToken('TEST_NO_PERMS_TRANSFER');

    product = await createProduct();
    product2 = await createProduct();

    const locationSpecs = [
      { key: 'store', name: 'Main Store', shortCode: 'STORE', type: LOCATION_TYPES.INTERNAL },
      { key: 'production', name: 'Production Rack', shortCode: 'PROD', type: LOCATION_TYPES.INTERNAL },
      { key: 'scrap', name: 'Scrap', shortCode: 'SCRAP', type: LOCATION_TYPES.SCRAP },
      { key: 'vendor', name: 'Vendor Dock', shortCode: 'VENDOR', type: LOCATION_TYPES.VENDOR },
      { key: 'customer', name: 'Customer Out', shortCode: 'CUST', type: LOCATION_TYPES.CUSTOMER },
    ];

    const wh1 = await createWarehouseWithLocations({ locations: locationSpecs });
    warehouse = wh1.warehouse;
    loc = wh1.locations;

    const wh2 = await createWarehouseWithLocations({ locations: locationSpecs });
    otherWarehouse = wh2.warehouse;
    otherLoc = wh2.locations;

    for (const [user, wh] of [
      [staff, warehouse],
      [otherStaff, otherWarehouse],
      [manager, warehouse],
    ]) {
      await prisma.userWarehouseAccess.create({
        data: { userId: user.user.id, warehouseId: wh.id },
      });
    }
  });

  afterAll(async () => {
    await cleanupFixtures();
    for (const user of [unprivileged, manager, staff, otherStaff, admin]) {
      if (user?.user?.id) await prisma.user.delete({ where: { id: user.user.id } });
    }
    await prisma.role.delete({ where: { name: 'TEST_NO_PERMS_TRANSFER' } }).catch(() => {});
    await prisma.$disconnect();
  });

  const stock = async (productId, locationId, onHand, reservedQuantity = '0.0000') => {
    await prisma.stockQuant.upsert({
      where: { productId_locationId: { productId, locationId } },
      update: { onHand, reservedQuantity },
      create: { productId, locationId, onHand, reservedQuantity },
    });
    return prisma.stockQuant.findUnique({
      where: { productId_locationId: { productId, locationId } },
    });
  };

  const quantOf = (productId, locationId) =>
    prisma.stockQuant.findUnique({ where: { productId_locationId: { productId, locationId } } });

  const body = (overrides = {}) => ({
    warehouseId: warehouse.id,
    lines: [
      {
        productId: product.id,
        quantity: '10.0000',
        sourceLocationId: loc.store.id,
        destinationLocationId: loc.production.id,
      },
    ],
    ...overrides,
  });

  const createTransfer = async (token, overrides = {}) => {
    const res = await request(app)
      .post('/api/v1/internal-transfers')
      .set(auth(token))
      .send(body(overrides));
    expect(res.status).toBe(201);
    return trackFixture('transfers', res.body.data);
  };

  const validate = (token, id, key = unique('key')) =>
    request(app)
      .post(`/api/v1/internal-transfers/${id}/validate`)
      .set(auth(token))
      .set('Idempotency-Key', key);

  describe('creation & validation rules', () => {
    it('creates a DRAFT transfer with a TRF- reference', async () => {
      const res = await request(app)
        .post('/api/v1/internal-transfers')
        .set(auth(manager.token))
        .send(body());

      expect(res.status).toBe(201);
      expect(res.body.data.state).toBe(DOC_STATES.DRAFT);
      expect(res.body.data.reference).toMatch(/^TRF-/);
      expect(res.body.data.lines).toHaveLength(1);
      trackFixture('transfers', res.body.data);
    });

    it('rejects transfer where source equals destination location', async () => {
      const res = await request(app)
        .post('/api/v1/internal-transfers')
        .set(auth(manager.token))
        .send(
          body({
            lines: [
              {
                productId: product.id,
                quantity: '5.0000',
                sourceLocationId: loc.store.id,
                destinationLocationId: loc.store.id,
              },
            ],
          }),
        );

      expect(res.status).toBe(400);
      expect(res.body.code).toBe('INVALID_LOCATIONS');
    });

    it('rejects boundary locations (VENDOR, CUSTOMER, SCRAP) as endpoints', async () => {
      // VENDOR source
      const res1 = await request(app)
        .post('/api/v1/internal-transfers')
        .set(auth(manager.token))
        .send(
          body({
            lines: [
              {
                productId: product.id,
                quantity: '5.0000',
                sourceLocationId: loc.vendor.id,
                destinationLocationId: loc.store.id,
              },
            ],
          }),
        );
      expect(res1.status).toBe(400);
      expect(res1.body.code).toBe('INVALID_LOCATION_TYPES');

      // CUSTOMER destination
      const res2 = await request(app)
        .post('/api/v1/internal-transfers')
        .set(auth(manager.token))
        .send(
          body({
            lines: [
              {
                productId: product.id,
                quantity: '5.0000',
                sourceLocationId: loc.store.id,
                destinationLocationId: loc.customer.id,
              },
            ],
          }),
        );
      expect(res2.status).toBe(400);
      expect(res2.body.code).toBe('INVALID_LOCATION_TYPES');

      // SCRAP destination
      const res3 = await request(app)
        .post('/api/v1/internal-transfers')
        .set(auth(manager.token))
        .send(
          body({
            lines: [
              {
                productId: product.id,
                quantity: '5.0000',
                sourceLocationId: loc.store.id,
                destinationLocationId: loc.scrap.id,
              },
            ],
          }),
        );
      expect(res3.status).toBe(400);
      expect(res3.body.code).toBe('INVALID_LOCATION_TYPES');
    });

    it('rejects locations from another warehouse', async () => {
      const res = await request(app)
        .post('/api/v1/internal-transfers')
        .set(auth(manager.token))
        .send(
          body({
            lines: [
              {
                productId: product.id,
                quantity: '5.0000',
                sourceLocationId: loc.store.id,
                destinationLocationId: otherLoc.store.id,
              },
            ],
          }),
        );

      expect(res.status).toBe(400);
      expect(res.body.message).toMatch(/does not belong to warehouse/i);
    });

    it('validates transfer: source decreases, destination increases, total inventory unchanged', async () => {
      await stock(product.id, loc.store.id, '70.0000', '0.0000');
      await stock(product.id, loc.production.id, '30.0000', '0.0000');

      const transfer = await createTransfer(manager.token, {
        lines: [
          {
            productId: product.id,
            quantity: '20.0000',
            sourceLocationId: loc.store.id,
            destinationLocationId: loc.production.id,
          },
        ],
      });

      const res = await validate(manager.token, transfer.id);
      expect(res.status).toBe(200);
      expect(res.body.data.state).toBe(DOC_STATES.DONE);

      const sourceQuant = await quantOf(product.id, loc.store.id);
      const destQuant = await quantOf(product.id, loc.production.id);

      expect(sourceQuant.onHand.toString()).toBe('50');
      expect(destQuant.onHand.toString()).toBe('50');

      // Verify StockMove record
      const move = await prisma.stockMove.findFirst({
        where: { documentType: 'INTERNAL', documentId: transfer.id },
      });
      expect(move).toBeDefined();
      expect(move.fromLocationId).toBe(loc.store.id);
      expect(move.toLocationId).toBe(loc.production.id);
      expect(move.quantity.toString()).toBe('20');
      expect(move.state).toBe(DOC_STATES.DONE);
    });

    it('rejects transfer validation when source has insufficient free-to-use stock', async () => {
      // 10 onHand, 4 reserved => 6 freeToUse
      await stock(product.id, loc.store.id, '10.0000', '4.0000');
      await stock(product.id, loc.production.id, '0.0000', '0.0000');

      const transfer = await createTransfer(manager.token, {
        lines: [
          {
            productId: product.id,
            quantity: '7.0000',
            sourceLocationId: loc.store.id,
            destinationLocationId: loc.production.id,
          },
        ],
      });

      const res = await validate(manager.token, transfer.id);
      expect(res.status).toBe(422);
      expect(res.body.code).toBe('INSUFFICIENT_STOCK');

      // State and stock remained unchanged
      const sourceQuant = await quantOf(product.id, loc.store.id);
      const destQuant = await quantOf(product.id, loc.production.id);
      expect(sourceQuant.onHand.toString()).toBe('10');
      expect(destQuant.onHand.toString()).toBe('0');

      const checkTransfer = await prisma.internalTransfer.findUnique({ where: { id: transfer.id } });
      expect(checkTransfer.state).toBe(DOC_STATES.DRAFT);
    });

    it('allows transfer validation up to exact freeToUse quantity', async () => {
      // 10 onHand, 4 reserved => 6 freeToUse
      await stock(product.id, loc.store.id, '10.0000', '4.0000');
      await stock(product.id, loc.production.id, '0.0000', '0.0000');

      const transfer = await createTransfer(manager.token, {
        lines: [
          {
            productId: product.id,
            quantity: '6.0000',
            sourceLocationId: loc.store.id,
            destinationLocationId: loc.production.id,
          },
        ],
      });

      const res = await validate(manager.token, transfer.id);
      expect(res.status).toBe(200);

      const sourceQuant = await quantOf(product.id, loc.store.id);
      const destQuant = await quantOf(product.id, loc.production.id);
      expect(sourceQuant.onHand.toString()).toBe('4');
      expect(sourceQuant.reservedQuantity.toString()).toBe('4');
      expect(destQuant.onHand.toString()).toBe('6');
    });
  });

  describe('idempotency & lifecycle', () => {
    it('requires Idempotency-Key on validation', async () => {
      await stock(product.id, loc.store.id, '20.0000', '0.0000');
      const transfer = await createTransfer(manager.token);

      const res = await request(app)
        .post(`/api/v1/internal-transfers/${transfer.id}/validate`)
        .set(auth(manager.token));

      expect(res.status).toBe(400);
      expect(res.body.code).toBe('IDEMPOTENCY_KEY_REQUIRED');
    });

    it('replays response with Idempotent-Replay header without mutating stock again', async () => {
      await stock(product.id, loc.store.id, '40.0000', '0.0000');
      await stock(product.id, loc.production.id, '0.0000', '0.0000');

      const transfer = await createTransfer(manager.token, {
        lines: [
          {
            productId: product.id,
            quantity: '10.0000',
            sourceLocationId: loc.store.id,
            destinationLocationId: loc.production.id,
          },
        ],
      });

      const key = unique('key');
      const first = await validate(manager.token, transfer.id, key);
      const second = await validate(manager.token, transfer.id, key);

      expect(first.status).toBe(200);
      expect(second.status).toBe(200);
      expect(second.headers['idempotent-replay']).toBe('true');
      expect(second.body.data).toEqual(first.body.data);

      const sourceQuant = await quantOf(product.id, loc.store.id);
      const destQuant = await quantOf(product.id, loc.production.id);
      expect(sourceQuant.onHand.toString()).toBe('30');
      expect(destQuant.onHand.toString()).toBe('10');

      const count = await prisma.stockMove.count({
        where: { documentType: 'INTERNAL', documentId: transfer.id },
      });
      expect(count).toBe(1);
    });

    it('rejects double validation with a new key', async () => {
      await stock(product.id, loc.store.id, '30.0000', '0.0000');
      const transfer = await createTransfer(manager.token, {
        lines: [
          {
            productId: product.id,
            quantity: '5.0000',
            sourceLocationId: loc.store.id,
            destinationLocationId: loc.production.id,
          },
        ],
      });

      expect((await validate(manager.token, transfer.id)).status).toBe(200);
      const second = await validate(manager.token, transfer.id);

      expect(second.status).toBe(409);
      expect(second.body.code).toBe('DOCUMENT_ALREADY_VALIDATED');
    });

    it('cancelling a DRAFT/READY transfer moves to CANCELLED without stock mutation', async () => {
      await stock(product.id, loc.store.id, '30.0000', '0.0000');
      const transfer = await createTransfer(manager.token);

      const res = await request(app)
        .post(`/api/v1/internal-transfers/${transfer.id}/cancel`)
        .set(auth(manager.token));

      expect(res.status).toBe(200);
      expect(res.body.data.state).toBe(DOC_STATES.CANCELLED);

      // Cannot validate cancelled transfer
      const valRes = await validate(manager.token, transfer.id);
      expect(valRes.status).toBe(409);
      expect(valRes.body.code).toBe('DOCUMENT_CANCELLED');
    });
  });

  describe('permissions & warehouse isolation', () => {
    it('allows staff to create and edit transfers', async () => {
      const transfer = await createTransfer(staff.token);
      expect(transfer.state).toBe(DOC_STATES.DRAFT);

      const updateRes = await request(app)
        .put(`/api/v1/internal-transfers/${transfer.id}`)
        .set(auth(staff.token))
        .send(
          body({
            lines: [
              {
                productId: product.id,
                quantity: '8.0000',
                sourceLocationId: loc.store.id,
                destinationLocationId: loc.production.id,
              },
            ],
          }),
        );
      expect(updateRes.status).toBe(200);
      expect(updateRes.body.data.lines[0].quantity.toString()).toBe('8');
    });

    it('denies staff from validating transfers (requires manager/admin)', async () => {
      await stock(product.id, loc.store.id, '20.0000', '0.0000');
      const transfer = await createTransfer(staff.token);

      const res = await validate(staff.token, transfer.id);
      expect(res.status).toBe(403);
    });

    it('denies unprivileged user without internal_transfer.create', async () => {
      const res = await request(app)
        .post('/api/v1/internal-transfers')
        .set(auth(unprivileged.token))
        .send(body());

      expect(res.status).toBe(403);
    });

    it('enforces warehouse isolation: 403 when accessing unassigned warehouse', async () => {
      const res = await request(app)
        .post('/api/v1/internal-transfers')
        .set(auth(staff.token))
        .send(body({ warehouseId: otherWarehouse.id }));

      expect(res.status).toBe(403);
    });
  });

  describe('concurrency & multi-line rollback', () => {
    it('serializes concurrent transfers and prevents negative stock', async () => {
      await stock(product2.id, loc.store.id, '100.0000', '0.0000');
      await stock(product2.id, loc.production.id, '0.0000', '0.0000');

      const transferA = await createTransfer(manager.token, {
        lines: [
          {
            productId: product2.id,
            quantity: '70.0000',
            sourceLocationId: loc.store.id,
            destinationLocationId: loc.production.id,
          },
        ],
      });

      const transferB = await createTransfer(manager.token, {
        lines: [
          {
            productId: product2.id,
            quantity: '50.0000',
            sourceLocationId: loc.store.id,
            destinationLocationId: loc.production.id,
          },
        ],
      });

      const [resA, resB] = await Promise.all([
        validate(manager.token, transferA.id, unique('con-a')),
        validate(manager.token, transferB.id, unique('con-b')),
      ]);

      const statuses = [resA.status, resB.status].sort();
      expect(statuses).toEqual([200, 422]);

      const sourceQuant = await quantOf(product2.id, loc.store.id);
      const destQuant = await quantOf(product2.id, loc.production.id);

      // Exactly 70 or 50 transferred; never 120 or negative
      if (resA.status === 200) {
        expect(sourceQuant.onHand.toString()).toBe('30');
        expect(destQuant.onHand.toString()).toBe('70');
      } else {
        expect(sourceQuant.onHand.toString()).toBe('50');
        expect(destQuant.onHand.toString()).toBe('50');
      }
    });

    it('rolls back multi-line transfer atomically if any line fails', async () => {
      await stock(product.id, loc.store.id, '50.0000', '0.0000');
      await stock(product.id, loc.production.id, '0.0000', '0.0000');
      await stock(product2.id, loc.store.id, '5.0000', '0.0000'); // Short stock for line 2
      await stock(product2.id, loc.production.id, '0.0000', '0.0000');

      const transfer = await createTransfer(manager.token, {
        lines: [
          {
            productId: product.id,
            quantity: '20.0000',
            sourceLocationId: loc.store.id,
            destinationLocationId: loc.production.id,
          },
          {
            productId: product2.id,
            quantity: '10.0000', // exceeds 5
            sourceLocationId: loc.store.id,
            destinationLocationId: loc.production.id,
          },
        ],
      });

      const res = await validate(manager.token, transfer.id);
      expect(res.status).toBe(422);
      expect(res.body.code).toBe('INSUFFICIENT_STOCK');

      // Product 1 must be rolled back completely
      const p1Store = await quantOf(product.id, loc.store.id);
      const p1Prod = await quantOf(product.id, loc.production.id);
      expect(p1Store.onHand.toString()).toBe('50');
      expect(p1Prod ? p1Prod.onHand.toString() : '0').toBe('0');

      const count = await prisma.stockMove.count({
        where: { documentType: 'INTERNAL', documentId: transfer.id },
      });
      expect(count).toBe(0);
    });
  });
});
