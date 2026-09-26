const { PrismaClient } = require('@prisma/client');
const authService = require('../src/services/auth.service');
const { LOCATION_TYPES } = require('../src/domain/location');
const { PARTNER_TYPES } = require('../src/domain/partner');

const prisma = new PrismaClient();

/**
 * Shared fixtures for the integration tests. Every suite talks to a real
 * PostgreSQL database: there are no ORM mocks, because the behaviour under test
 * (row locks, transactions, unique/foreign-key constraints, NUMERIC arithmetic)
 * only exists in the database.
 */
const unique = (prefix) => `${prefix}-${Math.random().toString(36).slice(2, 10)}`;

/** Creates a user with the given role and mints a matching access token. */
async function createUserWithToken(
  roleName,
  { email, password = 'Test@1234', warehouseIds = [] } = {},
) {
  const role = await prisma.role.findUnique({ where: { name: roleName } });
  if (!role) throw new Error(`Seed role missing: ${roleName}`);

  const user = await prisma.user.create({
    data: {
      email: email || `${unique(roleName.toLowerCase()).replace(/[^a-z0-9]/gi, '')}@test.local`,
      name: `${roleName} test user`,
      passwordHash: await authService.hashPassword(password),
      roleId: role.id,
      status: 'ACTIVE',
    },
    include: {
      role: { include: { permissions: { include: { permission: true } } } },
      warehouseAccess: true,
    },
  });

  if (warehouseIds.length > 0) {
    await prisma.userWarehouseAccess.createMany({
      data: warehouseIds.map((warehouseId) => ({ userId: user.id, warehouseId })),
    });
  }

  const hydrated = await prisma.user.findUnique({
    where: { id: user.id },
    include: {
      role: { include: { permissions: { include: { permission: true } } } },
      warehouseAccess: true,
    },
  });

  return { user: hydrated, token: authService.generateAccessToken(hydrated), password };
}

async function createWarehouseWithLocations(overrides = {}) {
  const warehouse = await prisma.warehouse.create({
    data: {
      name: overrides.name || unique('Warehouse'),
      shortCode: overrides.shortCode || unique('WH').toUpperCase().replace(/-/g, ''),
      address: overrides.address ?? null,
    },
  });

  const locations = {};
  const specs = overrides.locations || [
    { key: 'store', name: 'Main Store', shortCode: 'STORE', type: LOCATION_TYPES.INTERNAL },
    {
      key: 'production',
      name: 'Production Rack',
      shortCode: 'PROD',
      type: LOCATION_TYPES.PRODUCTION,
    },
    { key: 'scrap', name: 'Scrap', shortCode: 'SCRAP', type: LOCATION_TYPES.SCRAP },
    { key: 'vendor', name: 'Vendor Dock', shortCode: 'VENDOR', type: LOCATION_TYPES.VENDOR },
    {
      key: 'customer',
      name: 'Customer Dock',
      shortCode: 'CUSTOMER',
      type: LOCATION_TYPES.CUSTOMER,
    },
  ];

  for (const spec of specs) {
    locations[spec.key] = await prisma.location.create({
      data: {
        warehouseId: warehouse.id,
        name: spec.name,
        shortCode: spec.shortCode,
        type: spec.type,
      },
    });
  }

  return { warehouse, locations };
}

async function createProduct(overrides = {}) {
  const uom = await prisma.uom.upsert({
    where: { code: overrides.uomCode || 'PCS' },
    update: {},
    create: { code: overrides.uomCode || 'PCS', name: 'Pieces' },
  });

  const category = overrides.categoryId
    ? { id: overrides.categoryId }
    : await prisma.category.create({ data: { name: unique('Category') } });

  return prisma.product.create({
    data: {
      sku: overrides.sku || unique('SKU').toUpperCase().replace(/-/g, ''),
      name: overrides.name || 'Test Product',
      uomId: uom.id,
      categoryId: category.id,
      costPrice: overrides.costPrice ?? '10.00',
      reorderMin: overrides.reorderMin ?? '5',
      reorderMax: overrides.reorderMax ?? '100',
    },
  });
}

async function createPartner(overrides = {}) {
  return prisma.partner.create({
    data: {
      name: overrides.name || unique('Partner'),
      // Receipts require a partner allowed to supply; override for customer cases.
      type: overrides.type ?? PARTNER_TYPES.SUPPLIER,
      isActive: overrides.isActive ?? true,
    },
  });
}

const auth = (token) => ({ Authorization: `Bearer ${token}` });

/** Wipes only the fixtures a suite created; the seeded demo data is left alone. */
async function removeUser(userId) {
  await prisma.user.deleteMany({ where: { id: userId } });
}

/**
 * Per-suite fixture registry. Jest gives each test file its own module registry,
 * so this only ever holds rows the calling suite created — which is what makes
 * it safe to delete by id while other suites run in parallel.
 */
const tracked = {
  partners: [],
  warehouses: [],
  products: [],
  receipts: [],
  deliveries: [],
  transfers: [],
  adjustments: [],
};

const track = (kind, record) => {
  tracked[kind].push(record.id);
  return record;
};

const createTrackedPartner = async (overrides = {}) =>
  track('partners', await createPartner(overrides));

const createTrackedProduct = async (overrides = {}) =>
  track('products', await createProduct(overrides));

const createTrackedWarehouseWithLocations = async (overrides = {}) => {
  const created = await createWarehouseWithLocations(overrides);
  track('warehouses', created.warehouse);
  return created;
};

const createTrackedReceipt = async (data) =>
  track('receipts', await prisma.receipt.create({ data }));

/**
 * Deliveries are normally created through the HTTP API; register one so the
 * teardown can remove it.
 */
const createTrackedDelivery = async (data) =>
  track('deliveries', await prisma.delivery.create({ data }));

const createTrackedTransfer = async (data) =>
  track('transfers', await prisma.internalTransfer.create({ data }));

const createTrackedAdjustment = async (data) =>
  track('adjustments', await prisma.adjustment.create({ data }));

/**
 * Registers a row a suite created indirectly — through the HTTP API, say — so
 * `cleanupFixtures` still removes it. Only the id is needed.
 */
const trackFixture = (kind, record) => {
  if (record && record.id) {
    if (!tracked[kind]) tracked[kind] = [];
    track(kind, record);
  }
  return record;
};

/**
 * Removes tracked fixtures in foreign-key order. Rows that other rows already
 * reference are deleted first so the teardown cannot fail; anything genuinely
 * still in use is reported rather than silently left behind.
 */
async function cleanupFixtures() {
  const warehouseIds = tracked.warehouses;
  const locationIds = warehouseIds.length
    ? (
        await prisma.location.findMany({
          where: { warehouseId: { in: warehouseIds } },
          select: { id: true },
        })
      ).map((l) => l.id)
    : [];
  const productIds = tracked.products;

  // Foreign-key order. Rows a suite created through the API are not tracked, so
  // the steps below also clear anything hanging off the tracked warehouses and
  // products — a receipt line pointing into a tracked location would otherwise
  // block its deletion.
  const steps = [
    () => prisma.receiptLine.deleteMany({ where: { receiptId: { in: tracked.receipts } } }),
    () => prisma.receipt.deleteMany({ where: { id: { in: tracked.receipts } } }),
    () => prisma.receiptLine.deleteMany({ where: { destinationLocationId: { in: locationIds } } }),
    () => prisma.receipt.deleteMany({ where: { warehouseId: { in: warehouseIds } } }),
    () => prisma.deliveryLine.deleteMany({ where: { deliveryId: { in: tracked.deliveries } } }),
    () => prisma.delivery.deleteMany({ where: { id: { in: tracked.deliveries } } }),
    () => prisma.deliveryLine.deleteMany({ where: { sourceLocationId: { in: locationIds } } }),
    () => prisma.delivery.deleteMany({ where: { warehouseId: { in: warehouseIds } } }),
    () => prisma.internalTransferLine.deleteMany({ where: { transferId: { in: tracked.transfers } } }),
    () => prisma.internalTransfer.deleteMany({ where: { id: { in: tracked.transfers } } }),
    () =>
      prisma.internalTransferLine.deleteMany({
        where: {
          OR: [
            { sourceLocationId: { in: locationIds } },
            { destinationLocationId: { in: locationIds } },
          ],
        },
      }),
    () => prisma.internalTransfer.deleteMany({ where: { warehouseId: { in: warehouseIds } } }),
    () => prisma.adjustmentLine.deleteMany({ where: { adjustmentId: { in: tracked.adjustments } } }),
    () => prisma.adjustment.deleteMany({ where: { id: { in: tracked.adjustments } } }),
    () => prisma.adjustmentLine.deleteMany({ where: { locationId: { in: locationIds } } }),
    () => prisma.adjustment.deleteMany({ where: { warehouseId: { in: warehouseIds } } }),
    () =>
      prisma.stockMove.deleteMany({
        where: {
          OR: [{ fromLocationId: { in: locationIds } }, { toLocationId: { in: locationIds } }],
        },
      }),
    () => prisma.stockMove.deleteMany({ where: { productId: { in: productIds } } }),
    () => prisma.stockQuant.deleteMany({ where: { locationId: { in: locationIds } } }),
    () => prisma.stockQuant.deleteMany({ where: { productId: { in: productIds } } }),
    () => prisma.location.deleteMany({ where: { id: { in: locationIds } } }),
    () => prisma.userWarehouseAccess.deleteMany({ where: { warehouseId: { in: warehouseIds } } }),
    () => prisma.warehouse.deleteMany({ where: { id: { in: warehouseIds } } }),
    () => prisma.product.deleteMany({ where: { id: { in: productIds } } }),
    () => prisma.partner.deleteMany({ where: { id: { in: tracked.partners } } }),
  ];

  for (const run of steps) {
    try {
      await run();
    } catch (error) {
      // Teardown must never mask a real test failure, but a silent skip would
      // leave fixtures behind, so the cause is reported.
      console.warn('cleanupFixtures: step failed:', error.code || error.name);
    }
  }

  for (const ids of Object.values(tracked)) ids.length = 0;
}

module.exports = {
  prisma,
  unique,
  createUserWithToken,
  createWarehouseWithLocations,
  createProduct,
  createPartner,
  createTrackedPartner,
  createTrackedProduct,
  createTrackedWarehouseWithLocations,
  createTrackedReceipt,
  createTrackedDelivery,
  createTrackedTransfer,
  createTrackedAdjustment,
  trackFixture,
  auth,
  removeUser,
  cleanupFixtures,
  LOCATION_TYPES,
};

