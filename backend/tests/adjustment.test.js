const { Prisma } = require('@prisma/client');
const request = require('supertest');
const app = require('../src/app');
const { prisma } = require('../src/lib/prisma');
const inventoryService = require('../src/services/inventory.service');
const {
  auth,
  unique,
  createUserWithToken,
  createWarehouseWithLocations,
  createProduct,
  trackFixture,
  cleanupFixtures,
} = require('./helpers');
const { DOC_STATES } = require('../src/domain/documentState');
const { DOCUMENT_TYPES } = require('../src/domain/documentType');
const { LOCATION_TYPES } = require('../src/domain/location');

const dec = (v) => new Prisma.Decimal(v);

describe('inventory adjustments & stock counts', () => {
  let manager, staff, otherStaff, admin, unprivileged;
  let warehouse, loc, otherWarehouse, otherLoc;
  let product, product2;

  beforeAll(async () => {
    manager = await createUserWithToken('INVENTORY_MANAGER');
    staff = await createUserWithToken('WAREHOUSE_STAFF');
    otherStaff = await createUserWithToken('WAREHOUSE_STAFF');
    admin = await createUserWithToken('ADMIN');

    await prisma.role.upsert({
      where: { name: 'TEST_NO_PERMS_ADJUSTMENT' },
      update: {},
      create: { name: 'TEST_NO_PERMS_ADJUSTMENT' },
    });
    unprivileged = await createUserWithToken('TEST_NO_PERMS_ADJUSTMENT');

    product = await createProduct();
    product2 = await createProduct();

    const wh1 = await createWarehouseWithLocations();
    warehouse = wh1.warehouse;
    loc = wh1.locations;

    const wh2 = await createWarehouseWithLocations();
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
    await prisma.role.delete({ where: { name: 'TEST_NO_PERMS_ADJUSTMENT' } }).catch(() => {});
    await prisma.$disconnect();
  });

  const stock = async (productId, locationId, onHand, reservedQuantity = '0.0000') => {
    await prisma.stockQuant.upsert({
      where: { productId_locationId: { productId, locationId } },
      update: { onHand: dec(onHand), reservedQuantity: dec(reservedQuantity) },
      create: { productId, locationId, onHand: dec(onHand), reservedQuantity: dec(reservedQuantity) },
    });
    return prisma.stockQuant.findUnique({
      where: { productId_locationId: { productId, locationId } },
    });
  };

  const quantOf = (productId, locationId) =>
    prisma.stockQuant.findUnique({ where: { productId_locationId: { productId, locationId } } });

  const body = (overrides = {}) => ({
    warehouseId: warehouse.id,
    reason: 'Routine Cycle Count',
    lines: [
      {
        productId: product.id,
        locationId: loc.store.id,
        countedQuantity: '85.0000',
      },
    ],
    ...overrides,
  });

  const createAdjustment = async (token, overrides = {}) => {
    const res = await request(app)
      .post('/api/v1/adjustments')
      .set(auth(token))
      .send(body(overrides));
    expect(res.status).toBe(201);
    return trackFixture('adjustments', res.body.data);
  };

  const validate = (token, id, key = unique('key')) =>
    request(app)
      .post(`/api/v1/adjustments/${id}/validate`)
      .set(auth(token))
      .set('Idempotency-Key', key);

  describe('creation & systemQuantity capture', () => {
    it('captures systemQuantity from current StockQuant and calculates difference', async () => {
      await stock(product.id, loc.store.id, '80.0000', '0.0000');

      const res = await request(app)
        .post('/api/v1/adjustments')
        .set(auth(manager.token))
        .send(
          body({
            lines: [
              {
                productId: product.id,
                locationId: loc.store.id,
                countedQuantity: '85.0000',
              },
            ],
          }),
        );

      expect(res.status).toBe(201);
      expect(res.body.data.reference).toMatch(/^ADJ-/);
      expect(res.body.data.state).toBe(DOC_STATES.DRAFT);
      expect(res.body.data.lines).toHaveLength(1);

      const line = res.body.data.lines[0];
      expect(line.systemQuantity.toString()).toBe('80');
      expect(line.countedQuantity.toString()).toBe('85');
      expect(line.difference.toString()).toBe('5');
      trackFixture('adjustments', res.body.data);
    });

    it('creates draft adjustment without immediately mutating stock', async () => {
      await stock(product.id, loc.store.id, '80.0000', '0.0000');
      const adj = await createAdjustment(manager.token);

      const quant = await quantOf(product.id, loc.store.id);
      expect(quant.onHand.toString()).toBe('80');
      expect(adj.state).toBe(DOC_STATES.DRAFT);
    });

    it('rejects count on non-INTERNAL location', async () => {
      const res = await request(app)
        .post('/api/v1/adjustments')
        .set(auth(manager.token))
        .send(
          body({
            lines: [
              {
                productId: product.id,
                locationId: loc.vendor.id,
                countedQuantity: '10.0000',
              },
            ],
          }),
        );

      expect(res.status).toBe(400);
      expect(res.body.code).toBe('INVALID_LOCATION_TYPES');
    });

    it('rejects location from another warehouse', async () => {
      const res = await request(app)
        .post('/api/v1/adjustments')
        .set(auth(manager.token))
        .send(
          body({
            lines: [
              {
                productId: product.id,
                locationId: otherLoc.store.id,
                countedQuantity: '10.0000',
              },
            ],
          }),
        );

      expect(res.status).toBe(400);
      expect(res.body.message).toMatch(/does not belong to warehouse/i);
    });
  });

  describe('validation & stock mutations', () => {
    it('applies positive adjustment (+5): final stock equals 85 and posts write-back from SCRAP', async () => {
      await stock(product.id, loc.store.id, '80.0000', '0.0000');

      const adj = await createAdjustment(manager.token, {
        lines: [
          {
            productId: product.id,
            locationId: loc.store.id,
            countedQuantity: '85.0000',
          },
        ],
      });

      const res = await validate(manager.token, adj.id);
      expect(res.status).toBe(200);
      expect(res.body.data.state).toBe(DOC_STATES.DONE);

      const quant = await quantOf(product.id, loc.store.id);
      expect(quant.onHand.toString()).toBe('85');

      // Verify StockMove: SCRAP -> STORE (+5)
      const move = await prisma.stockMove.findFirst({
        where: { documentType: 'ADJUSTMENT', documentId: adj.id },
      });
      expect(move).toBeDefined();
      expect(move.fromLocationId).toBe(loc.scrap.id);
      expect(move.toLocationId).toBe(loc.store.id);
      expect(move.quantity.toString()).toBe('5');
      expect(move.state).toBe(DOC_STATES.DONE);

      // Verify GET /adjustments/:id details status mapping
      const detailRes = await request(app)
        .get(`/api/v1/adjustments/${adj.id}`)
        .set(auth(manager.token));
      expect(detailRes.status).toBe(200);
      expect(detailRes.body.data.state).toBe(DOC_STATES.DONE);
      expect(detailRes.body.data.validatedById).toBe(manager.user.id);
      expect(detailRes.body.data.validator?.name).toBe(manager.user.name);
    });

    it('applies negative adjustment (-5): final stock equals 75 and posts write-off to SCRAP', async () => {
      await stock(product.id, loc.store.id, '80.0000', '0.0000');

      const adj = await createAdjustment(manager.token, {
        lines: [
          {
            productId: product.id,
            locationId: loc.store.id,
            countedQuantity: '75.0000',
          },
        ],
      });

      const res = await validate(manager.token, adj.id);
      expect(res.status).toBe(200);

      const quant = await quantOf(product.id, loc.store.id);
      expect(quant.onHand.toString()).toBe('75');

      // Verify StockMove: STORE -> SCRAP (5)
      const move = await prisma.stockMove.findFirst({
        where: { documentType: 'ADJUSTMENT', documentId: adj.id },
      });
      expect(move).toBeDefined();
      expect(move.fromLocationId).toBe(loc.store.id);
      expect(move.toLocationId).toBe(loc.scrap.id);
      expect(move.quantity.toString()).toBe('5');
      expect(move.state).toBe(DOC_STATES.DONE);
    });

    it('handles zero difference (80 -> 80): stock unchanged and no fake move posted', async () => {
      await stock(product.id, loc.store.id, '80.0000', '0.0000');

      const adj = await createAdjustment(manager.token, {
        lines: [
          {
            productId: product.id,
            locationId: loc.store.id,
            countedQuantity: '80.0000',
          },
        ],
      });

      const res = await validate(manager.token, adj.id);
      expect(res.status).toBe(200);
      expect(res.body.data.state).toBe(DOC_STATES.DONE);

      const quant = await quantOf(product.id, loc.store.id);
      expect(quant.onHand.toString()).toBe('80');

      const move = await prisma.stockMove.findFirst({
        where: { documentType: 'ADJUSTMENT', documentId: adj.id },
      });
      expect(move).toBeNull();
    });

    it('rejects stale adjustment if stock changed between count creation and validation', async () => {
      await stock(product.id, loc.store.id, '80.0000', '0.0000');

      const adj = await createAdjustment(manager.token, {
        lines: [
          {
            productId: product.id,
            locationId: loc.store.id,
            countedQuantity: '85.0000',
          },
        ],
      });

      // Simulating concurrent stock change
      await stock(product.id, loc.store.id, '82.0000', '0.0000');

      const res = await validate(manager.token, adj.id);
      expect(res.status).toBe(409);
      expect(res.body.code).toBe('STALE_ADJUSTMENT');

      const quant = await quantOf(product.id, loc.store.id);
      expect(quant.onHand.toString()).toBe('82');
    });

    it('rejects count when countedQuantity < active reservedQuantity', async () => {
      // 100 onHand, 30 reserved
      await stock(product.id, loc.store.id, '100.0000', '30.0000');

      // Attempting to adjust down to 20 (less than 30 reserved)
      const adj = await createAdjustment(manager.token, {
        lines: [
          {
            productId: product.id,
            locationId: loc.store.id,
            countedQuantity: '20.0000',
          },
        ],
      });

      const res = await validate(manager.token, adj.id);
      expect(res.status).toBe(422);
      expect(res.body.code).toBe('ADJUSTMENT_BELOW_RESERVED');
    });
  });

  describe('RBAC & approval separation', () => {
    it('allows staff to create adjustment counts', async () => {
      await stock(product.id, loc.store.id, '50.0000', '0.0000');
      const adj = await createAdjustment(staff.token, {
        lines: [
          {
            productId: product.id,
            locationId: loc.store.id,
            countedQuantity: '52.0000',
          },
        ],
      });
      expect(adj.state).toBe(DOC_STATES.DRAFT);
    });

    it('denies staff from validating / approving adjustments', async () => {
      await stock(product.id, loc.store.id, '50.0000', '0.0000');
      const adj = await createAdjustment(staff.token, {
        lines: [
          {
            productId: product.id,
            locationId: loc.store.id,
            countedQuantity: '52.0000',
          },
        ],
      });

      const res = await validate(staff.token, adj.id);
      expect(res.status).toBe(403);
    });

    it('allows inventory manager to approve/validate adjustments', async () => {
      await stock(product.id, loc.store.id, '50.0000', '0.0000');
      const adj = await createAdjustment(staff.token, {
        lines: [
          {
            productId: product.id,
            locationId: loc.store.id,
            countedQuantity: '52.0000',
          },
        ],
      });

      const res = await validate(manager.token, adj.id);
      expect(res.status).toBe(200);
      expect(res.body.data.state).toBe(DOC_STATES.DONE);
      expect(res.body.data.validatedById).toBe(manager.user.id);
    });
  });

  describe('multi-line atomicity & idempotency', () => {
    it('replays validation with Idempotent-Replay header without applying difference twice', async () => {
      await stock(product.id, loc.store.id, '60.0000', '0.0000');

      const adj = await createAdjustment(manager.token, {
        lines: [
          {
            productId: product.id,
            locationId: loc.store.id,
            countedQuantity: '65.0000',
          },
        ],
      });

      const key = unique('key');
      const first = await validate(manager.token, adj.id, key);
      const second = await validate(manager.token, adj.id, key);

      expect(first.status).toBe(200);
      expect(second.status).toBe(200);
      expect(second.headers['idempotent-replay']).toBe('true');
      expect((await quantOf(product.id, loc.store.id)).onHand.toString()).toBe('65');
    });

    it('rejects double validation with a new key', async () => {
      await stock(product.id, loc.store.id, '60.0000', '0.0000');

      const adj = await createAdjustment(manager.token, {
        lines: [
          {
            productId: product.id,
            locationId: loc.store.id,
            countedQuantity: '65.0000',
          },
        ],
      });

      expect((await validate(manager.token, adj.id)).status).toBe(200);
      const second = await validate(manager.token, adj.id);

      expect(second.status).toBe(409);
      expect(second.body.code).toBe('DOCUMENT_ALREADY_VALIDATED');
    });

    it('cancels adjustment without stock mutation', async () => {
      await stock(product.id, loc.store.id, '60.0000', '0.0000');
      const adj = await createAdjustment(manager.token);

      const res = await request(app)
        .post(`/api/v1/adjustments/${adj.id}/cancel`)
        .set(auth(manager.token));

      expect(res.status).toBe(200);
      expect(res.body.data.state).toBe(DOC_STATES.CANCELLED);

      expect((await quantOf(product.id, loc.store.id)).onHand.toString()).toBe('60');
    });

    it('rolls back multi-line adjustment atomically if one line fails', async () => {
      await stock(product.id, loc.store.id, '50.0000', '0.0000');
      await stock(product2.id, loc.store.id, '30.0000', '25.0000'); // 25 reserved

      const adj = await createAdjustment(manager.token, {
        lines: [
          {
            productId: product.id,
            locationId: loc.store.id,
            countedQuantity: '55.0000', // valid +5
          },
          {
            productId: product2.id,
            locationId: loc.store.id,
            countedQuantity: '20.0000', // invalid: < 25 reserved
          },
        ],
      });

      const res = await validate(manager.token, adj.id);
      expect(res.status).toBe(422);

      // Line 1 must be rolled back
      expect((await quantOf(product.id, loc.store.id)).onHand.toString()).toBe('50');
      expect((await quantOf(product2.id, loc.store.id)).onHand.toString()).toBe('30');

      const count = await prisma.stockMove.count({
        where: { documentType: 'ADJUSTMENT', documentId: adj.id },
      });
      expect(count).toBe(0);
    });
  });
});
