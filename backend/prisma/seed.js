const { PrismaClient } = require('@prisma/client');
const authService = require('../src/services/auth.service');
const inventoryService = require('../src/services/inventory.service');
const { LOCATION_TYPES } = require('../src/domain/location');
const { DOCUMENT_TYPES } = require('../src/domain/documentType');
const { DOC_STATES } = require('../src/domain/documentState');
const { PARTNER_TYPES } = require('../src/domain/partner');
const crypto = require('crypto');

const prisma = new PrismaClient();

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

const DEMO_USERS = [
  {
    email: 'admin@stockpilot.local',
    name: 'Admin',
    password: 'Admin@12345',
    role: 'ADMIN',
    warehouses: ['PUNE-MAIN', 'MUM-DIST'],
  },
  {
    email: 'manager@stockpilot.local',
    name: 'Inventory Manager',
    password: 'Manager@12345',
    role: 'INVENTORY_MANAGER',
    warehouses: ['PUNE-MAIN', 'MUM-DIST'],
  },
  {
    email: 'staff@stockpilot.local',
    name: 'Warehouse Staff',
    password: 'Staff@12345',
    role: 'WAREHOUSE_STAFF',
    warehouses: ['PUNE-MAIN'],
  },
];

const WAREHOUSES = [
  { name: 'Pune Main Warehouse', shortCode: 'PUNE-MAIN', address: 'Pune Industrial Area' },
  {
    name: 'Mumbai Distribution Warehouse',
    shortCode: 'MUM-DIST',
    address: 'Mumbai Logistics Park',
  },
];

const LOCATIONS = {
  'PUNE-MAIN': [
    { name: 'Main Store', shortCode: 'P-STORE', type: LOCATION_TYPES.INTERNAL },
    { name: 'Production Rack', shortCode: 'P-PROD', type: LOCATION_TYPES.INTERNAL },
    { name: 'Packing Area', shortCode: 'P-PACK', type: LOCATION_TYPES.INTERNAL },
    { name: 'Damaged Goods', shortCode: 'P-DMG', type: LOCATION_TYPES.SCRAP },
    { name: 'Vendor Dock', shortCode: 'P-VEND', type: LOCATION_TYPES.VENDOR },
    { name: 'Customer Dock', shortCode: 'P-CUST', type: LOCATION_TYPES.CUSTOMER },
  ],
  'MUM-DIST': [
    { name: 'Main Store', shortCode: 'M-STORE', type: LOCATION_TYPES.INTERNAL },
    { name: 'Packing Area', shortCode: 'M-PACK', type: LOCATION_TYPES.INTERNAL },
    { name: 'Damaged Goods', shortCode: 'M-DMG', type: LOCATION_TYPES.SCRAP },
    { name: 'Vendor Dock', shortCode: 'M-VEND', type: LOCATION_TYPES.VENDOR },
    { name: 'Customer Dock', shortCode: 'M-CUST', type: LOCATION_TYPES.CUSTOMER },
  ],
};

const CATEGORIES = [
  { name: 'Raw Materials', code: 'RAW' },
  { name: 'Electronics', code: 'ELEC' },
  { name: 'Packaging', code: 'PKG' },
  { name: 'Office Supplies', code: 'OFF' },
  { name: 'Safety Equipment', code: 'SAFE' },
];

const UOMS = [
  { code: 'kg', name: 'Kilogram' },
  { code: 'units', name: 'Units' },
  { code: 'rolls', name: 'Rolls' },
  { code: 'packs', name: 'Packs' },
  { code: 'pairs', name: 'Pairs' },
];

const PRODUCTS = [
  {
    sku: 'RM-STEEL-001',
    name: 'Stainless Steel Sheet',
    category: 'Raw Materials',
    uom: 'kg',
    reorderMin: 50,
  },
  {
    sku: 'RM-ALU-001',
    name: 'Aluminium Rod',
    category: 'Raw Materials',
    uom: 'kg',
    reorderMin: 30,
  },
  {
    sku: 'RM-COPPER-001',
    name: 'Copper Wire',
    category: 'Raw Materials',
    uom: 'kg',
    reorderMin: 20,
  },
  {
    sku: 'ELEC-SENSOR-001',
    name: 'Industrial Sensor',
    category: 'Electronics',
    uom: 'units',
    reorderMin: 10,
  },
  {
    sku: 'ELEC-RELAY-001',
    name: 'Control Relay',
    category: 'Electronics',
    uom: 'units',
    reorderMin: 20,
  },
  {
    sku: 'PKG-BOX-L',
    name: 'Cardboard Box Large',
    category: 'Packaging',
    uom: 'units',
    reorderMin: 100,
  },
  {
    sku: 'PKG-BUBBLE-001',
    name: 'Bubble Wrap Roll',
    category: 'Packaging',
    uom: 'rolls',
    reorderMin: 20,
  },
  {
    sku: 'PKG-TAPE-001',
    name: 'Packing Tape',
    category: 'Packaging',
    uom: 'rolls',
    reorderMin: 50,
  },
  {
    sku: 'OFF-PAPER-001',
    name: 'Thermal Printer Paper',
    category: 'Office Supplies',
    uom: 'packs',
    reorderMin: 10,
  },
  {
    sku: 'SAFE-GLOVE-001',
    name: 'Safety Gloves',
    category: 'Safety Equipment',
    uom: 'pairs',
    reorderMin: 15,
  },
];

const PARTNERS = [
  { name: 'Tata Steel Supplies', type: PARTNER_TYPES.SUPPLIER },
  { name: 'Electronics Components Pvt Ltd', type: PARTNER_TYPES.SUPPLIER },
  { name: 'Packaging Solutions Ltd', type: PARTNER_TYPES.SUPPLIER },
  { name: 'Office Supplies India', type: PARTNER_TYPES.SUPPLIER },
  { name: 'Acme Corp', type: PARTNER_TYPES.CUSTOMER },
  { name: 'Vertex Retail Pvt Ltd', type: PARTNER_TYPES.CUSTOMER },
  { name: 'Sunrise Foods Ltd', type: PARTNER_TYPES.BOTH },
];

async function seedRolesAndPermissions() {
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
  return roleByName;
}

async function seedWarehousesAndLocations() {
  const whByCode = {};
  for (const wh of WAREHOUSES) {
    whByCode[wh.shortCode] = await prisma.warehouse.upsert({
      where: { shortCode: wh.shortCode },
      update: { name: wh.name, address: wh.address },
      create: wh,
    });
  }

  const locByCode = {};
  for (const [whCode, locs] of Object.entries(LOCATIONS)) {
    const warehouse = whByCode[whCode];
    for (const loc of locs) {
      locByCode[loc.shortCode] = await prisma.location.upsert({
        where: { warehouseId_shortCode: { warehouseId: warehouse.id, shortCode: loc.shortCode } },
        update: { name: loc.name, type: loc.type },
        create: { ...loc, warehouseId: warehouse.id },
      });
    }
  }
  return { whByCode, locByCode };
}

async function seedUsers(roleByName, whByCode) {
  for (const u of DEMO_USERS) {
    const passwordHash = await authService.hashPassword(u.password);
    const user = await prisma.user.upsert({
      where: { email: u.email },
      update: { passwordHash, roleId: roleByName[u.role].id },
      create: {
        email: u.email,
        name: u.name,
        passwordHash,
        roleId: roleByName[u.role].id,
        status: 'ACTIVE',
      },
    });

    // Clear existing accesses
    await prisma.userWarehouseAccess.deleteMany({ where: { userId: user.id } });

    for (const whCode of u.warehouses) {
      await prisma.userWarehouseAccess.create({
        data: { userId: user.id, warehouseId: whByCode[whCode].id },
      });
    }
  }
}

async function seedCatalog() {
  const uomByCode = {};
  for (const u of UOMS) {
    uomByCode[u.code] = await prisma.uom.upsert({
      where: { code: u.code },
      update: { name: u.name },
      create: u,
    });
  }

  const catByName = {};
  for (const c of CATEGORIES) {
    catByName[c.name] = await prisma.category.upsert({
      where: { name: c.name },
      update: {},
      create: { name: c.name },
    });
  }

  const prodBySku = {};
  for (const p of PRODUCTS) {
    prodBySku[p.sku] = await prisma.product.upsert({
      where: { sku: p.sku },
      update: {
        name: p.name,
        categoryId: catByName[p.category].id,
        uomId: uomByCode[p.uom].id,
        reorderMin: p.reorderMin,
      },
      create: {
        sku: p.sku,
        name: p.name,
        categoryId: catByName[p.category].id,
        uomId: uomByCode[p.uom].id,
        costPrice: 0,
        reorderMin: p.reorderMin,
      },
    });
  }
  return prodBySku;
}

async function seedPartners() {
  const partnerByName = {};
  for (const p of PARTNERS) {
    partnerByName[p.name] = await prisma.partner.upsert({
      where: { name: p.name },
      update: { type: p.type },
      create: p,
    });
  }
  return partnerByName;
}

async function createReceipt(
  reference,
  partner,
  warehouse,
  linesData,
  prodBySku,
  locByCode,
  state = DOC_STATES.DONE,
) {
  const existing = await prisma.receipt.findUnique({ where: { reference } });
  if (existing) return existing; // Idempotency check for receipt creation

  const receipt = await prisma.receipt.create({
    data: {
      reference,
      partnerId: partner.id,
      warehouseId: warehouse.id,
      state: DOC_STATES.DRAFT,
      lines: {
        create: linesData.map((l) => ({
          productId: prodBySku[l.sku].id,
          quantity: l.quantity,
          destinationLocationId: locByCode[l.dest].id,
        })),
      },
    },
    include: { lines: true },
  });

  if (state === DOC_STATES.DONE) {
    await prisma.$transaction(async (tx) => {
      // Find the VENDOR location for this warehouse
      const vendorLoc = await tx.location.findFirst({
        where: { warehouseId: warehouse.id, type: LOCATION_TYPES.VENDOR },
      });

      for (const line of receipt.lines) {
        await inventoryService.executeMove(tx, {
          productId: line.productId,
          fromLocationId: vendorLoc.id,
          toLocationId: line.destinationLocationId,
          quantity: line.quantity,
          documentType: DOCUMENT_TYPES.RECEIPT,
          documentId: receipt.id,
          reference: receipt.reference,
        });
      }
      await tx.receipt.update({
        where: { id: receipt.id },
        data: { state: DOC_STATES.DONE },
      });
    });
  }
  return receipt;
}

async function seedReceipts(whByCode, prodBySku, locByCode, partnerByName) {
  // Receipt 1 (DONE) - Pune
  await createReceipt(
    'RCP-DEMO-001',
    partnerByName['Tata Steel Supplies'],
    whByCode['PUNE-MAIN'],
    [
      { sku: 'RM-STEEL-001', quantity: 100, dest: 'P-STORE' },
      { sku: 'RM-ALU-001', quantity: 60, dest: 'P-STORE' },
    ],
    prodBySku,
    locByCode,
    DOC_STATES.DONE,
  );

  // Receipt 2 (DONE) - Pune
  await createReceipt(
    'RCP-DEMO-002',
    partnerByName['Electronics Components Pvt Ltd'],
    whByCode['PUNE-MAIN'],
    [
      { sku: 'ELEC-SENSOR-001', quantity: 25, dest: 'P-STORE' },
      { sku: 'ELEC-RELAY-001', quantity: 50, dest: 'P-STORE' },
    ],
    prodBySku,
    locByCode,
    DOC_STATES.DONE,
  );

  // Receipt 3 (DONE) - Pune
  await createReceipt(
    'RCP-DEMO-003',
    partnerByName['Packaging Solutions Ltd'],
    whByCode['PUNE-MAIN'],
    [
      { sku: 'PKG-BOX-L', quantity: 200, dest: 'P-STORE' },
      { sku: 'PKG-BUBBLE-001', quantity: 40, dest: 'P-STORE' },
      { sku: 'PKG-TAPE-001', quantity: 100, dest: 'P-STORE' },
    ],
    prodBySku,
    locByCode,
    DOC_STATES.DONE,
  );

  // Receipt 4 (DONE) - Mumbai
  await createReceipt(
    'RCP-DEMO-004',
    partnerByName['Office Supplies India'],
    whByCode['MUM-DIST'],
    [
      { sku: 'OFF-PAPER-001', quantity: 50, dest: 'M-STORE' },
      { sku: 'SAFE-GLOVE-001', quantity: 80, dest: 'M-STORE' },
    ],
    prodBySku,
    locByCode,
    DOC_STATES.DONE,
  );

  // Receipt 5 (DRAFT) - Pune
  await createReceipt(
    'RCP-DEMO-005',
    partnerByName['Tata Steel Supplies'],
    whByCode['PUNE-MAIN'],
    [{ sku: 'RM-COPPER-001', quantity: 20, dest: 'P-STORE' }],
    prodBySku,
    locByCode,
    DOC_STATES.DRAFT,
  );
}

/**
 * Creates one delivery and drives it to `state` through the same engine calls
 * the API uses, rather than writing the final state directly. That matters for
 * the demo data: a DONE delivery has to have been picked, and its reservation
 * consumed, or the stock figures in the UI would not add up.
 */
async function createDelivery(
  reference,
  partner,
  warehouse,
  linesData,
  prodBySku,
  locByCode,
  state = DOC_STATES.DONE,
) {
  const existing = await prisma.delivery.findUnique({ where: { reference } });
  if (existing) return existing; // Idempotency check, same as receipts

  const delivery = await prisma.delivery.create({
    data: {
      reference,
      partnerId: partner.id,
      warehouseId: warehouse.id,
      state: DOC_STATES.DRAFT,
      lines: {
        create: linesData.map((l) => ({
          productId: prodBySku[l.sku].id,
          quantity: l.quantity,
          sourceLocationId: locByCode[l.src].id,
        })),
      },
    },
    include: { lines: true },
  });

  // DRAFT and WAITING are document states only — no claim on stock is made until
  // the delivery is picked — so they need nothing beyond the record above.
  if (state === DOC_STATES.DRAFT) return delivery;
  if (state === DOC_STATES.WAITING) {
    return prisma.delivery.update({
      where: { id: delivery.id },
      data: { state: DOC_STATES.WAITING },
    });
  }

  // From here the delivery holds a real claim on stock, so it is reserved first
  // and then either left claimed (READY), unwound (CANCELLED), or shipped (DONE).
  await prisma.$transaction(async (tx) => {
    const customerLoc = await tx.location.findFirst({
      where: { warehouseId: warehouse.id, type: LOCATION_TYPES.CUSTOMER },
    });

    for (const line of delivery.lines) {
      await inventoryService.reserve(tx, {
        productId: line.productId,
        locationId: line.sourceLocationId,
        quantity: line.quantity,
      });
    }
    await tx.delivery.update({
      where: { id: delivery.id },
      data: { state: DOC_STATES.READY },
    });

    if (state === DOC_STATES.READY) return; // Left holding its reservation

    if (state === DOC_STATES.CANCELLED) {
      // Cancelling a picked delivery returns the claim, so net stock is unchanged.
      for (const line of delivery.lines) {
        await inventoryService.releaseReservation(tx, {
          productId: line.productId,
          locationId: line.sourceLocationId,
          quantity: line.quantity,
        });
      }
      await tx.delivery.update({
        where: { id: delivery.id },
        data: { state: DOC_STATES.CANCELLED },
      });
      return;
    }

    for (const line of delivery.lines) {
      await inventoryService.executeMove(tx, {
        productId: line.productId,
        fromLocationId: line.sourceLocationId,
        toLocationId: customerLoc.id,
        quantity: line.quantity,
        documentType: DOCUMENT_TYPES.DELIVERY,
        documentId: delivery.id,
        reference: delivery.reference,
        consumeOwnReservation: true,
      });
    }
    // The database refuses a DONE delivery that was not READY first, so the
    // state can only be advanced now that the movement is posted.
    await tx.delivery.update({
      where: { id: delivery.id },
      data: { state: DOC_STATES.DONE },
    });
  });

  return delivery;
}

async function seedDeliveries(whByCode, prodBySku, locByCode, partnerByName) {
  // Shipped. P-STORE RM-ALU-001 goes 60 -> 40.
  await createDelivery(
    'DLV-DEMO-001',
    partnerByName['Acme Corp'],
    whByCode['PUNE-MAIN'],
    [{ sku: 'RM-ALU-001', quantity: 20, src: 'P-STORE' }],
    prodBySku,
    locByCode,
    DOC_STATES.DONE,
  );

  // Picked and waiting to ship: holds a live reservation of 60 boxes, which is
  // what makes the difference between on-hand and free-to-use visible in the UI.
  await createDelivery(
    'DLV-DEMO-002',
    partnerByName['Acme Corp'],
    whByCode['PUNE-MAIN'],
    [{ sku: 'PKG-BOX-L', quantity: 60, src: 'P-STORE' }],
    prodBySku,
    locByCode,
    DOC_STATES.READY,
  );

  // Released for picking, not yet claimed.
  await createDelivery(
    'DLV-DEMO-003',
    partnerByName['Vertex Retail Pvt Ltd'],
    whByCode['PUNE-MAIN'],
    [{ sku: 'PKG-TAPE-001', quantity: 30, src: 'P-STORE' }],
    prodBySku,
    locByCode,
    DOC_STATES.WAITING,
  );

  // Mumbai draft, untouched.
  await createDelivery(
    'DLV-DEMO-004',
    partnerByName['Sunrise Foods Ltd'],
    whByCode['MUM-DIST'],
    [{ sku: 'OFF-PAPER-001', quantity: 10, src: 'M-STORE' }],
    prodBySku,
    locByCode,
    DOC_STATES.DRAFT,
  );

  // Cancelled after being picked, so it demonstrates a released reservation.
  await createDelivery(
    'DLV-DEMO-005',
    partnerByName['Acme Corp'],
    whByCode['PUNE-MAIN'],
    [{ sku: 'RM-STEEL-001', quantity: 10, src: 'P-STORE' }],
    prodBySku,
    locByCode,
    DOC_STATES.CANCELLED,
  );
}

async function seedInternalMovements(prodBySku, locByCode) {
  const createMove = async (ref, sku, fromCode, toCode, qty) => {
    const existing = await prisma.stockMove.findFirst({ where: { reference: ref } });
    if (existing) return;

    await prisma.$transaction(async (tx) => {
      await inventoryService.executeMove(tx, {
        productId: prodBySku[sku].id,
        fromLocationId: locByCode[fromCode].id,
        toLocationId: locByCode[toCode].id,
        quantity: qty,
        documentType: DOCUMENT_TYPES.INTERNAL,
        documentId: crypto.randomUUID(),
        reference: ref,
      });
    });
  };

  await createMove('INT-DEMO-001', 'RM-STEEL-001', 'P-STORE', 'P-PROD', 30);
  await createMove('INT-DEMO-002', 'PKG-BOX-L', 'P-STORE', 'P-PACK', 50);
  await createMove('INT-DEMO-003', 'PKG-BOX-L', 'P-PACK', 'P-STORE', 10);
  await createMove('INT-DEMO-004', 'PKG-BUBBLE-001', 'P-STORE', 'P-PACK', 10);

  // Create low stock situation for sensors & relays by moving them to SCRAP or just using them in Production
  await createMove('INT-DEMO-005', 'ELEC-SENSOR-001', 'P-STORE', 'P-PROD', 20); // 25 - 20 = 5 left in STORE
  await createMove('INT-DEMO-006', 'ELEC-RELAY-001', 'P-STORE', 'P-PROD', 42); // 50 - 42 = 8 left in STORE
}

async function main() {
  console.log('Seeding StockPilot Demo Data...');

  const roleByName = await seedRolesAndPermissions();
  const { whByCode, locByCode } = await seedWarehousesAndLocations();
  await seedUsers(roleByName, whByCode);
  const prodBySku = await seedCatalog();
  const partnerByName = await seedPartners();

  await seedReceipts(whByCode, prodBySku, locByCode, partnerByName);
  await seedInternalMovements(prodBySku, locByCode);
  await seedDeliveries(whByCode, prodBySku, locByCode, partnerByName);

  console.log('Demo Data Seeding Complete.');
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
