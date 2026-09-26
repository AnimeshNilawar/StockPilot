const { PrismaClient } = require('@prisma/client');
const authService = require('../src/services/auth.service');
const { LOCATION_TYPES } = require('../src/domain/location');
const prisma = new PrismaClient();

/**
 * Permission catalogue. `rolePermissions` maps each action to the roles that
 * hold it; the ADMIN role receives everything (see `allPermissions`).
 */
const PERMISSIONS = [
  'user.manage',
  'warehouse.read',
  'warehouse.write',
  'location.read',
  'location.write',
  'product.read',
  'product.write',
  'receipt.create',
  'receipt.edit',
  'receipt.validate',
  'delivery.create',
  'delivery.edit',
  'delivery.pick',
  'delivery.validate',
  'internal_transfer.create',
  'internal_transfer.validate',
  'adjustment.create',
  'adjustment.validate',
  'dashboard.view_all',
  'move_history.view',
  'stock.read',
  'stock.move',
];

const ROLE_PERMISSIONS = {
  INVENTORY_MANAGER: [
    'warehouse.read',
    'warehouse.write',
    'location.read',
    'location.write',
    'product.read',
    'product.write',
    'receipt.create',
    'receipt.edit',
    'receipt.validate',
    'delivery.create',
    'delivery.edit',
    'delivery.pick',
    'delivery.validate',
    'internal_transfer.create',
    'internal_transfer.validate',
    'adjustment.create',
    'adjustment.validate',
    'dashboard.view_all',
    'move_history.view',
    'stock.read',
    'stock.move',
  ],
  // Staff execute operational work in their assigned warehouses only. They may
  // not edit master data, validate deliveries, or approve adjustments — those
  // stay with Admin / Inventory Manager.
  WAREHOUSE_STAFF: [
    'warehouse.read',
    'location.read',
    'product.read',
    'receipt.create',
    'receipt.edit',
    'receipt.validate',
    'delivery.create',
    'delivery.edit',
    'delivery.pick',
    'internal_transfer.create',
    'adjustment.create',
    'move_history.view',
    'stock.read',
  ],
};

const ROLES = ['ADMIN', 'INVENTORY_MANAGER', 'WAREHOUSE_STAFF'];

const UOMS = [
  { code: 'PCS', name: 'Pieces' },
  { code: 'KG', name: 'Kilogram' },
  { code: 'G', name: 'Gram' },
  { code: 'BOX', name: 'Box' },
  { code: 'LTR', name: 'Litre' },
  { code: 'MTR', name: 'Metre' },
  { code: 'PKT', name: 'Packet' },
  { code: 'SET', name: 'Set' },
];

const CATEGORIES = [
  { name: 'Raw Materials', code: 'RAW' },
  { name: 'Electronics', code: 'ELC' },
  { name: 'Components', code: 'CMP', parent: 'Electronics' },
  { name: 'Accessories', code: 'ACC', parent: 'Electronics' },
  { name: 'Consumables', code: 'CSM' },
  { name: 'Finished Goods', code: 'FIN' },
];

const DEMO_PRODUCTS = [
  {
    sku: 'STL-001',
    name: 'Steel Rod',
    category: 'Raw Materials',
    uom: 'KG',
    costPrice: '4.50',
    reorderMin: '25',
    reorderMax: '500',
  },
  {
    sku: 'CPR-002',
    name: 'Copper Wire',
    category: 'Raw Materials',
    uom: 'KG',
    costPrice: '12.00',
    reorderMin: '10',
    reorderMax: '250',
  },
  {
    sku: 'BRG-003',
    name: 'Bearing',
    category: 'Components',
    uom: 'PCS',
    costPrice: '180.00',
    reorderMin: '20',
    reorderMax: '400',
  },
];

const DEFAULT_WAREHOUSE = {
  name: 'Main Warehouse',
  shortCode: 'MAIN',
  address: 'Plant 1, Industrial Estate',
};

const DEFAULT_LOCATIONS = [
  { name: 'Main Store', shortCode: 'STORE', type: LOCATION_TYPES.INTERNAL },
  { name: 'Production Rack', shortCode: 'PROD', type: LOCATION_TYPES.PRODUCTION },
  { name: 'Scrap', shortCode: 'SCRAP', type: LOCATION_TYPES.SCRAP },
  { name: 'Transit', shortCode: 'TRANSIT', type: LOCATION_TYPES.TRANSIT },
  // Boundary nodes: they terminate movements but never hold a balance.
  { name: 'Vendor Dock', shortCode: 'VENDOR', type: LOCATION_TYPES.VENDOR },
  { name: 'Customer Dock', shortCode: 'CUSTOMER', type: LOCATION_TYPES.CUSTOMER },
];

async function main() {
  console.log('Seeding database...');

  // ----- Roles & permissions -------------------------------------------------
  const roleByName = {};
  for (const roleName of ROLES) {
    roleByName[roleName] = await prisma.role.upsert({
      where: { name: roleName },
      update: {},
      create: { name: roleName },
    });
  }

  const permissionByAction = {};
  for (const action of PERMISSIONS) {
    permissionByAction[action] = await prisma.permission.upsert({
      where: { action },
      update: {},
      create: { action },
    });
  }

  // ADMIN holds every permission. Other roles follow ROLE_PERMISSIONS.
  const grant = async (roleName, actions) => {
    for (const action of actions) {
      await prisma.rolePermission.upsert({
        where: {
          roleId_permissionId: {
            roleId: roleByName[roleName].id,
            permissionId: permissionByAction[action].id,
          },
        },
        update: {},
        create: { roleId: roleByName[roleName].id, permissionId: permissionByAction[action].id },
      });
    }
  };

  await grant('ADMIN', PERMISSIONS);
  await grant('INVENTORY_MANAGER', ROLE_PERMISSIONS.INVENTORY_MANAGER);
  await grant('WAREHOUSE_STAFF', ROLE_PERMISSIONS.WAREHOUSE_STAFF);

  // ----- Admin user ---------------------------------------------------------
  const adminEmail = process.env.SEED_ADMIN_EMAIL || 'admin@stockpilot.local';
  const adminPassword = process.env.SEED_ADMIN_PASSWORD || 'Admin@1234';
  const adminHash = await authService.hashPassword(adminPassword);

  const adminUser = await prisma.user.upsert({
    where: { email: adminEmail },
    update: {},
    create: {
      email: adminEmail,
      name: 'System Admin',
      passwordHash: adminHash,
      roleId: roleByName.ADMIN.id,
      status: 'ACTIVE',
    },
  });

  // ----- Units of measure ----------------------------------------------------
  const uomByCode = {};
  for (const uom of UOMS) {
    uomByCode[uom.code] = await prisma.uom.upsert({
      where: { code: uom.code },
      update: { name: uom.name },
      create: uom,
    });
  }

  // ----- Categories (hierarchical) -----------------------------------------
  const categoryByName = {};
  for (const entry of CATEGORIES) {
    categoryByName[entry.name] = await prisma.category.upsert({
      where: { name: entry.name },
      update: {},
      create: {
        name: entry.name,
        parentId: entry.parent ? categoryByName[entry.parent].id : null,
      },
    });
  }

  // ----- Default warehouse & locations -------------------------------------
  const warehouse = await prisma.warehouse.upsert({
    where: { shortCode: DEFAULT_WAREHOUSE.shortCode },
    update: { name: DEFAULT_WAREHOUSE.name, address: DEFAULT_WAREHOUSE.address },
    create: DEFAULT_WAREHOUSE,
  });

  for (const location of DEFAULT_LOCATIONS) {
    await prisma.location.upsert({
      where: {
        warehouseId_shortCode: { warehouseId: warehouse.id, shortCode: location.shortCode },
      },
      update: { name: location.name, type: location.type },
      create: { ...location, warehouseId: warehouse.id },
    });
  }

  // The admin sees every warehouse through the role bypass, but an explicit
  // assignment keeps the data self-describing for non-privileged tooling.
  await prisma.userWarehouseAccess.upsert({
    where: { userId_warehouseId: { userId: adminUser.id, warehouseId: warehouse.id } },
    update: {},
    create: { userId: adminUser.id, warehouseId: warehouse.id },
  });

  // ----- Demo products ------------------------------------------------------
  for (const product of DEMO_PRODUCTS) {
    await prisma.product.upsert({
      where: { sku: product.sku },
      update: {},
      create: {
        sku: product.sku,
        name: product.name,
        categoryId: categoryByName[product.category].id,
        uomId: uomByCode[product.uom].id,
        costPrice: product.costPrice,
        reorderMin: product.reorderMin,
        reorderMax: product.reorderMax,
      },
    });
  }

  console.log(`Seeding finished. Admin user: ${adminUser.email}`);
  console.log(`  roles       : ${ROLES.join(', ')}`);
  console.log(`  permissions : ${PERMISSIONS.length}`);
  console.log(`  uom         : ${UOMS.length}`);
  console.log(`  warehouse   : ${warehouse.name} (${DEFAULT_LOCATIONS.length} locations)`);
  console.log(`  products    : ${DEMO_PRODUCTS.length}`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
