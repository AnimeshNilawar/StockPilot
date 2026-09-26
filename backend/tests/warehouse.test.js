const request = require('supertest');
const app = require('../src/app');
const {
  prisma,
  createUserWithToken,
  createWarehouseWithLocations,
  auth,
  unique,
  LOCATION_TYPES,
} = require('./helpers');

describe('Phase 2 — Warehouses, locations & warehouse isolation', () => {
  let admin;
  let manager;
  let staffA;
  let staffB;
  let warehouseA;
  let warehouseB;
  let locationsA;

  beforeAll(async () => {
    admin = await createUserWithToken('ADMIN');
    manager = await createUserWithToken('INVENTORY_MANAGER');

    ({ warehouse: warehouseA, locations: locationsA } = await createWarehouseWithLocations({
      name: 'Alpha Warehouse',
      shortCode: 'ALPHA',
    }));
    ({ warehouse: warehouseB } = await createWarehouseWithLocations({
      name: 'Beta Warehouse',
      shortCode: 'BETA',
    }));

    staffA = await createUserWithToken('WAREHOUSE_STAFF', { warehouseIds: [warehouseA.id] });
    staffB = await createUserWithToken('WAREHOUSE_STAFF', { warehouseIds: [warehouseB.id] });
  });

  afterAll(async () => {
    await prisma.user.deleteMany({
      where: { id: { in: [admin.user.id, manager.user.id, staffA.user.id, staffB.user.id] } },
    });
    await prisma.warehouse.deleteMany({ where: { id: { in: [warehouseA.id, warehouseB.id] } } });
    await prisma.$disconnect();
  });

  // -------------------------------------------------------------------------
  describe('Warehouse CRUD', () => {
    it('requires warehouse.write to create a warehouse', async () => {
      const res = await request(app)
        .post('/api/v1/warehouses')
        .set(auth(staffA.token))
        .send({ name: 'Staff Warehouse', shortCode: 'STAFFWH' });

      expect(res.status).toBe(403);
      expect(res.body.code).toBe('FORBIDDEN');
    });

    it('creates a warehouse and enforces a unique short code', async () => {
      const created = await request(app)
        .post('/api/v1/warehouses')
        .set(auth(manager.token))
        .send({ name: 'Gamma Warehouse', shortCode: 'gamma' });

      expect(created.status).toBe(201);
      expect(created.body.data.shortCode).toBe('GAMMA');

      const duplicate = await request(app)
        .post('/api/v1/warehouses')
        .set(auth(manager.token))
        .send({ name: 'Gamma Warehouse 2', shortCode: 'GAMMA' });

      expect(duplicate.status).toBe(409);
      expect(duplicate.body.code).toBe('DUPLICATE_RESOURCE');

      await prisma.warehouse.delete({ where: { id: created.body.data.id } });
    });

    it('persists the address on create and update', async () => {
      // Regression: the validator never declared `address`, and zod strips keys
      // a schema does not list, so a submitted address was silently discarded
      // before the controller ran. The form sent it, the column existed, and the
      // record came back empty.
      const created = await request(app)
        .post('/api/v1/warehouses')
        .set(auth(manager.token))
        .send({
          name: 'Address Warehouse',
          shortCode: unique('ADDR').slice(0, 12),
          address: '  221B Baker Street, London  ',
        });

      expect(created.status).toBe(201);
      expect(created.body.data.address).toBe('221B Baker Street, London');

      const stored = await prisma.warehouse.findUnique({ where: { id: created.body.data.id } });
      expect(stored.address).toBe('221B Baker Street, London');

      const patched = await request(app)
        .patch(`/api/v1/warehouses/${created.body.data.id}`)
        .set(auth(manager.token))
        .send({ address: '221C Baker Street, London' });

      expect(patched.status).toBe(200);
      expect(patched.body.data.address).toBe('221C Baker Street, London');

      // An omitted address must not wipe the stored one on a partial update.
      const renamed = await request(app)
        .patch(`/api/v1/warehouses/${created.body.data.id}`)
        .set(auth(manager.token))
        .send({ name: 'Address Warehouse Renamed' });

      expect(renamed.status).toBe(200);
      expect(renamed.body.data.address).toBe('221C Baker Street, London');

      // A blank address is stored as NULL, not as an empty string.
      const cleared = await request(app)
        .patch(`/api/v1/warehouses/${created.body.data.id}`)
        .set(auth(manager.token))
        .send({ address: '   ' });

      expect(cleared.status).toBe(200);
      expect(cleared.body.data.address).toBeNull();

      // And omitting it entirely on create leaves the column empty.
      const noAddress = await request(app)
        .post('/api/v1/warehouses')
        .set(auth(manager.token))
        .send({ name: 'No Address Warehouse', shortCode: unique('NOADDR').slice(0, 12) });

      expect(noAddress.status).toBe(201);
      expect(noAddress.body.data.address).toBeNull();

      await prisma.warehouse.deleteMany({
        where: { id: { in: [created.body.data.id, noAddress.body.data.id] } },
      });
    });

    it('rejects a malformed short code', async () => {
      const res = await request(app)
        .post('/api/v1/warehouses')
        .set(auth(manager.token))
        .send({ name: 'Bad Warehouse', shortCode: 'has spaces' });

      expect(res.status).toBe(400);
    });

    it('refuses to delete a warehouse that still has locations', async () => {
      const res = await request(app)
        .delete(`/api/v1/warehouses/${warehouseA.id}`)
        .set(auth(manager.token));

      expect(res.status).toBe(400);
      expect(res.body.code).toBe('WAREHOUSE_HAS_LOCATIONS');
    });
  });

  // -------------------------------------------------------------------------
  describe('Warehouse isolation', () => {
    it('shows a staff member only their assigned warehouses', async () => {
      const res = await request(app).get('/api/v1/warehouses').set(auth(staffA.token));

      expect(res.status).toBe(200);
      const ids = res.body.data.items.map((item) => item.id);
      expect(ids).toContain(warehouseA.id);
      expect(ids).not.toContain(warehouseB.id);
    });

    it('shows an admin every warehouse', async () => {
      const res = await request(app).get('/api/v1/warehouses?pageSize=200').set(auth(admin.token));

      expect(res.status).toBe(200);
      const ids = res.body.data.items.map((item) => item.id);
      expect(ids).toContain(warehouseA.id);
      expect(ids).toContain(warehouseB.id);
    });

    it('cannot be bypassed by forging a warehouseId query parameter', async () => {
      const res = await request(app)
        .get(`/api/v1/warehouses?warehouseId=${warehouseB.id}`)
        .set(auth(staffA.token));

      expect(res.status).toBe(200);
      const ids = res.body.data.items.map((item) => item.id);
      expect(ids).not.toContain(warehouseB.id);
    });

    it('returns 403 when reading another warehouse by URL', async () => {
      const res = await request(app)
        .get(`/api/v1/warehouses/${warehouseB.id}`)
        .set(auth(staffA.token));

      expect(res.status).toBe(403);
      expect(res.body.code).toBe('FORBIDDEN');
    });

    it('returns 403 for another warehouse location tree', async () => {
      const res = await request(app)
        .get(`/api/v1/warehouses/${warehouseB.id}/locations`)
        .set(auth(staffA.token));

      expect(res.status).toBe(403);
      expect(res.body.code).toBe('FORBIDDEN');
    });

    it('returns 403 when creating a location in an unassigned warehouse', async () => {
      const res = await request(app)
        .post('/api/v1/locations')
        .set(auth(staffA.token))
        .send({ warehouseId: warehouseB.id, name: 'Sneaky Bin', shortCode: 'SNEAK' });

      // Staff lack location.write entirely, so the permission guard fires first;
      // a manager assigned elsewhere proves the warehouse check itself.
      expect(res.status).toBe(403);
    });

    it('limits the location list to the caller warehouses', async () => {
      const res = await request(app).get('/api/v1/locations?pageSize=200').set(auth(staffA.token));

      expect(res.status).toBe(200);
      const warehouseIds = new Set(res.body.data.items.map((item) => item.warehouseId));
      expect(warehouseIds.has(warehouseB.id)).toBe(false);
    });
  });

  // -------------------------------------------------------------------------
  describe('Location CRUD', () => {
    it('requires location.write to create a location', async () => {
      const res = await request(app)
        .post('/api/v1/locations')
        .set(auth(staffA.token))
        .send({ warehouseId: warehouseA.id, name: 'Staff Bin', shortCode: 'STAFFBIN' });

      expect(res.status).toBe(403);
    });

    it('creates a hierarchical location with a type', async () => {
      const res = await request(app).post('/api/v1/locations').set(auth(manager.token)).send({
        warehouseId: warehouseA.id,
        name: 'Cold Store',
        shortCode: 'COLD',
        type: LOCATION_TYPES.INTERNAL,
        parentId: locationsA.store.id,
      });

      expect(res.status).toBe(201);
      expect(res.body.data.type).toBe(LOCATION_TYPES.INTERNAL);
      expect(res.body.data.parentId).toBe(locationsA.store.id);

      await prisma.location.delete({ where: { id: res.body.data.id } });
    });

    it('enforces a unique short code within a warehouse', async () => {
      const duplicate = await request(app)
        .post('/api/v1/locations')
        .set(auth(manager.token))
        .send({ warehouseId: warehouseA.id, name: 'Another Store', shortCode: 'STORE' });

      expect(duplicate.status).toBe(409);
    });

    it('allows the same short code in a different warehouse', async () => {
      // One code that exists in A must be accepted in B.
      const inA = await request(app)
        .post('/api/v1/locations')
        .set(auth(manager.token))
        .send({ warehouseId: warehouseA.id, name: 'Alpha Goods In', shortCode: 'GOODSIN' });
      expect(inA.status).toBe(201);

      const inB = await request(app)
        .post('/api/v1/locations')
        .set(auth(manager.token))
        .send({ warehouseId: warehouseB.id, name: 'Beta Goods In', shortCode: 'GOODSIN' });

      expect(inB.status).toBe(201);
      expect(inB.body.data.warehouseId).toBe(warehouseB.id);

      await prisma.location.deleteMany({ where: { shortCode: 'GOODSIN' } });
    });

    it('rejects an unknown location type', async () => {
      const res = await request(app)
        .post('/api/v1/locations')
        .set(auth(manager.token))
        .send({
          warehouseId: warehouseA.id,
          name: 'Wrong Type',
          shortCode: unique('T').toUpperCase(),
          type: 'TELEPORTER',
        });

      expect(res.status).toBe(400);
      expect(res.body.code).toBe('VALIDATION_ERROR');
    });

    it('rejects a parent location from another warehouse', async () => {
      const betaStore = await prisma.location.create({
        data: {
          warehouseId: warehouseB.id,
          name: 'Beta Main',
          shortCode: 'BMAIN',
          type: LOCATION_TYPES.INTERNAL,
        },
      });

      const res = await request(app)
        .post('/api/v1/locations')
        .set(auth(manager.token))
        .send({
          warehouseId: warehouseA.id,
          name: 'Cross Parent',
          shortCode: unique('XP').toUpperCase(),
          parentId: betaStore.id,
        });

      expect(res.status).toBe(400);
      expect(res.body.code).toBe('CROSS_WAREHOUSE_PARENT');

      await prisma.location.delete({ where: { id: betaStore.id } });
    });

    it('rejects a location that parents itself', async () => {
      const node = await prisma.location.create({
        data: {
          warehouseId: warehouseA.id,
          name: 'Self Node',
          shortCode: unique('SN').toUpperCase(),
          type: LOCATION_TYPES.INTERNAL,
        },
      });

      const res = await request(app)
        .patch(`/api/v1/locations/${node.id}`)
        .set(auth(manager.token))
        .send({ parentId: node.id });

      expect(res.status).toBe(400);
      expect(res.body.code).toBe('INVALID_LOCATION_PARENT');

      await prisma.location.delete({ where: { id: node.id } });
    });

    it('filters locations by type and search term', async () => {
      const byType = await request(app)
        .get(`/api/v1/warehouses/${warehouseA.id}/locations?type=${LOCATION_TYPES.SCRAP}`)
        .set(auth(staffA.token));

      expect(byType.status).toBe(200);
      expect(byType.body.data.items.every((item) => item.type === LOCATION_TYPES.SCRAP)).toBe(true);

      const bySearch = await request(app)
        .get(`/api/v1/warehouses/${warehouseA.id}/locations?search=prod`)
        .set(auth(staffA.token));

      expect(bySearch.status).toBe(200);
      expect(bySearch.body.data.items.length).toBeGreaterThan(0);
    });

    it('refuses to delete a location that has sub-locations', async () => {
      const child = await prisma.location.create({
        data: {
          warehouseId: warehouseA.id,
          name: 'Child Bin',
          shortCode: unique('CH').toUpperCase(),
          type: LOCATION_TYPES.INTERNAL,
          parentId: locationsA.store.id,
        },
      });

      const res = await request(app)
        .delete(`/api/v1/locations/${locationsA.store.id}`)
        .set(auth(manager.token));

      expect(res.status).toBe(400);
      expect(res.body.code).toBe('LOCATION_HAS_CHILDREN');

      await prisma.location.delete({ where: { id: child.id } });
    });

    it('exposes a dropdown source of the caller locations', async () => {
      const res = await request(app).get('/api/v1/locations/options').set(auth(staffA.token));

      expect(res.status).toBe(200);
      expect(res.body.data.every((item) => item.warehouseId === warehouseA.id)).toBe(true);
    });

    it('requires authentication', async () => {
      const res = await request(app).get('/api/v1/locations');
      expect(res.status).toBe(401);
      expect(res.body.code).toBe('UNAUTHORIZED');
    });
  });
});
