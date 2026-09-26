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
const { LOCATION_TYPES } = require('../src/domain/location');

describe('dashboard & move history reporting', () => {
  let admin, manager, staff, otherStaff, unprivileged;
  let warehouse1, loc1, warehouse2, loc2;
  let category1, category2;
  let product1, product2, product3;

  beforeAll(async () => {
    admin = await createUserWithToken('ADMIN');
    manager = await createUserWithToken('INVENTORY_MANAGER');
    staff = await createUserWithToken('WAREHOUSE_STAFF');
    otherStaff = await createUserWithToken('WAREHOUSE_STAFF');

    await prisma.role.upsert({
      where: { name: 'TEST_NO_PERMS_DASHBOARD' },
      update: {},
      create: { name: 'TEST_NO_PERMS_DASHBOARD' },
    });
    unprivileged = await createUserWithToken('TEST_NO_PERMS_DASHBOARD');

    category1 = await prisma.category.create({
      data: { name: unique('Cat1') },
    });
    category2 = await prisma.category.create({
      data: { name: unique('Cat2') },
    });

    product1 = await createProduct({ categoryId: category1.id, reorderMin: 20 });
    product2 = await createProduct({ categoryId: category1.id, reorderMin: 50 });
    product3 = await createProduct({ categoryId: category2.id, reorderMin: 10 });

    const wh1 = await createWarehouseWithLocations({
      locations: [
        { key: 'store', name: 'Store 1', shortCode: 'ST1', type: LOCATION_TYPES.INTERNAL },
        { key: 'scrap', name: 'Scrap 1', shortCode: 'SC1', type: LOCATION_TYPES.SCRAP },
        { key: 'vendor', name: 'Vendor 1', shortCode: 'V1', type: LOCATION_TYPES.VENDOR },
        { key: 'customer', name: 'Customer 1', shortCode: 'C1', type: LOCATION_TYPES.CUSTOMER },
      ],
    });
    warehouse1 = wh1.warehouse;
    loc1 = wh1.locations;

    const wh2 = await createWarehouseWithLocations({
      locations: [
        { key: 'store', name: 'Store 2', shortCode: 'ST2', type: LOCATION_TYPES.INTERNAL },
        { key: 'scrap', name: 'Scrap 2', shortCode: 'SC2', type: LOCATION_TYPES.SCRAP },
        { key: 'vendor', name: 'Vendor 2', shortCode: 'V2', type: LOCATION_TYPES.VENDOR },
        { key: 'customer', name: 'Customer 2', shortCode: 'C2', type: LOCATION_TYPES.CUSTOMER },
      ],
    });
    warehouse2 = wh2.warehouse;
    loc2 = wh2.locations;

    await prisma.userWarehouseAccess.create({
      data: { userId: staff.user.id, warehouseId: warehouse1.id },
    });
    await prisma.userWarehouseAccess.create({
      data: { userId: otherStaff.user.id, warehouseId: warehouse2.id },
    });

    // Seed stock:
    // Product 1: in WH1, onHand = 15 (0 < 15 <= 20 => Low Stock)
    await prisma.stockQuant.upsert({
      where: { productId_locationId: { productId: product1.id, locationId: loc1.store.id } },
      update: { onHand: '15.0000', reservedQuantity: '0.0000' },
      create: { productId: product1.id, locationId: loc1.store.id, onHand: '15.0000', reservedQuantity: '0.0000' },
    });

    // Product 2: in WH1, onHand = 0 (Out of Stock)
    await prisma.stockQuant.upsert({
      where: { productId_locationId: { productId: product2.id, locationId: loc1.store.id } },
      update: { onHand: '0.0000', reservedQuantity: '0.0000' },
      create: { productId: product2.id, locationId: loc1.store.id, onHand: '0.0000', reservedQuantity: '0.0000' },
    });

    // Product 3: in WH2, onHand = 100 (> 10 => Normal in stock)
    await prisma.stockQuant.upsert({
      where: { productId_locationId: { productId: product3.id, locationId: loc2.store.id } },
      update: { onHand: '100.0000', reservedQuantity: '0.0000' },
      create: { productId: product3.id, locationId: loc2.store.id, onHand: '100.0000', reservedQuantity: '0.0000' },
    });
  });

  afterAll(async () => {
    await cleanupFixtures();
    for (const u of [admin, manager, staff, otherStaff, unprivileged]) {
      if (u?.user?.id) await prisma.user.delete({ where: { id: u.user.id } });
    }
    await prisma.role.delete({ where: { name: 'TEST_NO_PERMS_DASHBOARD' } }).catch(() => {});
    await prisma.$disconnect();
  });

  describe('GET /api/v1/dashboard', () => {
    it('returns structured KPIs and supporting lists', async () => {
      const res = await request(app)
        .get('/api/v1/dashboard')
        .set(auth(admin.token));

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.kpis).toBeDefined();
      expect(typeof res.body.data.kpis.totalProductsInStock).toBe('number');
      expect(typeof res.body.data.kpis.lowStockCount).toBe('number');
      expect(typeof res.body.data.kpis.outOfStockCount).toBe('number');
      expect(typeof res.body.data.kpis.pendingReceipts).toBe('number');
      expect(typeof res.body.data.kpis.pendingDeliveries).toBe('number');
      expect(Array.isArray(res.body.data.lowStockItems)).toBe(true);
      expect(Array.isArray(res.body.data.recentReceipts)).toBe(true);
      expect(Array.isArray(res.body.data.recentDeliveries)).toBe(true);
      expect(Array.isArray(res.body.data.recentMoves)).toBe(true);
    });

    it('enforces warehouse isolation for warehouse-scoped staff', async () => {
      const staffRes = await request(app)
        .get('/api/v1/dashboard')
        .set(auth(staff.token));

      expect(staffRes.status).toBe(200);
      // Staff only sees warehouse 1, where product 1 has onHand=15 (low) and product 2 has onHand=0 (out of stock)
      // product 3 is in warehouse 2, so in WH1 product 3 has onHand=0 (out of stock)
      const kpis = staffRes.body.data.kpis;
      expect(kpis.totalProductsInStock).toBe(1); // only Product 1 has stock in WH1
    });

    it('rejects staff requests for unassigned warehouses with 403', async () => {
      const res = await request(app)
        .get(`/api/v1/dashboard?warehouseId=${warehouse2.id}`)
        .set(auth(staff.token));

      expect(res.status).toBe(403);
    });

    it('allows manager to filter by specific warehouse', async () => {
      const res = await request(app)
        .get(`/api/v1/dashboard?warehouseId=${warehouse2.id}`)
        .set(auth(manager.token));

      expect(res.status).toBe(200);
      const kpis = res.body.data.kpis;
      // In WH2, only product 3 has stock (100)
      expect(kpis.totalProductsInStock).toBe(1);
    });

    it('composes category and warehouse filters', async () => {
      const res = await request(app)
        .get(`/api/v1/dashboard?warehouseId=${warehouse1.id}&categoryId=${category1.id}`)
        .set(auth(admin.token));

      expect(res.status).toBe(200);
      expect(res.body.data.kpis.totalProductsInStock).toBe(1);
      const lowStockItems = res.body.data.lowStockItems;
      expect(lowStockItems.every((item) => item.category === category1.name)).toBe(true);
    });
  });

  describe('GET /api/v1/moves', () => {
    it('returns paginated immutable ledger', async () => {
      const res = await request(app)
        .get('/api/v1/moves')
        .set(auth(admin.token));

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(Array.isArray(res.body.data.items)).toBe(true);
      expect(res.body.data.pagination).toBeDefined();
    });

    it('supports composable filters on documentType, warehouseId, and state', async () => {
      const res = await request(app)
        .get(`/api/v1/moves?warehouseId=${warehouse1.id}&state=DONE&documentType=INTERNAL`)
        .set(auth(admin.token));

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
    });

    it('denies staff access to moves outside their assigned warehouse', async () => {
      const res = await request(app)
        .get(`/api/v1/moves?warehouseId=${warehouse2.id}`)
        .set(auth(staff.token));

      expect(res.status).toBe(403);
    });
  });
});
