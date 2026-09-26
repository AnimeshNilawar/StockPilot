const { PrismaClient } = require('@prisma/client');
const authService = require('../src/services/auth.service');
const { LOCATION_TYPES } = require('../src/domain/location');

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
      email: email || unique(`${roleName.toLowerCase()}@test.local`),
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

const auth = (token) => ({ Authorization: `Bearer ${token}` });

/** Wipes only the fixtures a suite created; the seeded demo data is left alone. */
async function removeUser(userId) {
  await prisma.user.deleteMany({ where: { id: userId } });
}

module.exports = {
  prisma,
  unique,
  createUserWithToken,
  createWarehouseWithLocations,
  createProduct,
  auth,
  removeUser,
  LOCATION_TYPES,
};
