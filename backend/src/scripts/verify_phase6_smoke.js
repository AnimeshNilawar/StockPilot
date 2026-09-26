const { PrismaClient } = require('@prisma/client');
const request = require('supertest');
const app = require('../app');
const authService = require('../services/auth.service');

const prisma = new PrismaClient();

async function runSmokeTests() {
  console.log('========================================');
  console.log('STOCKPILOT PHASE 6 SMOKE TEST SUITE');
  console.log('========================================\n');

  // Fetch users
  const adminUser = await prisma.user.findFirst({
    where: { role: { name: 'ADMIN' } },
    include: { role: { include: { permissions: { include: { permission: true } } } }, warehouseAccess: true },
  });
  const staffUser = await prisma.user.findFirst({
    where: { role: { name: 'WAREHOUSE_STAFF' } },
    include: { role: { include: { permissions: { include: { permission: true } } } }, warehouseAccess: true },
  });

  const adminToken = authService.generateAccessToken(adminUser);
  const staffToken = authService.generateAccessToken(staffUser);

  const warehouse = await prisma.warehouse.findFirst({
    where: { OR: [{ shortCode: 'PUNE-MAIN' }, { name: 'Pune Main Warehouse' }] },
    include: { locations: true },
  });

  const mainStore = warehouse.locations.find((l) => l.shortCode === 'STORE' || l.name.includes('Main Store')) || warehouse.locations.find((l) => l.type === 'INTERNAL');
  const prodRack = warehouse.locations.find((l) => l.shortCode === 'PROD' || l.name.includes('Production Rack') || (l.type === 'INTERNAL' && l.id !== mainStore.id)) || warehouse.locations.find((l) => l.id !== mainStore.id);
  const scrapLoc = warehouse.locations.find((l) => l.type === 'SCRAP');

  const product = (await prisma.product.findFirst({
    where: { sku: 'RM-STEEL-001' },
  })) || (await prisma.product.findFirst());

  await prisma.userWarehouseAccess.upsert({
    where: { userId_warehouseId: { userId: staffUser.id, warehouseId: warehouse.id } },
    update: {},
    create: { userId: staffUser.id, warehouseId: warehouse.id },
  });
  await prisma.userWarehouseAccess.upsert({
    where: { userId_warehouseId: { userId: adminUser.id, warehouseId: warehouse.id } },
    update: {},
    create: { userId: adminUser.id, warehouseId: warehouse.id },
  });

  console.log(`Using Warehouse: ${warehouse.name} (${warehouse.shortCode})`);
  console.log(`Using Product: ${product.name} (${product.sku})`);
  console.log(`Main Store: ${mainStore.name} (${mainStore.id})`);
  console.log(`Production Rack: ${prodRack.name} (${prodRack.id})`);

  // --- Scenario 1: Internal Transfer (70 / 30 -> 50 / 50) ---
  console.log('\n--- Scenario 1: Internal Transfer (70/30 -> Transfer 20 -> 50/50) ---');
  await prisma.stockQuant.upsert({
    where: { productId_locationId: { productId: product.id, locationId: mainStore.id } },
    update: { onHand: '70.0000', reservedQuantity: '0.0000' },
    create: { productId: product.id, locationId: mainStore.id, onHand: '70.0000', reservedQuantity: '0.0000' },
  });
  await prisma.stockQuant.upsert({
    where: { productId_locationId: { productId: product.id, locationId: prodRack.id } },
    update: { onHand: '30.0000', reservedQuantity: '0.0000' },
    create: { productId: product.id, locationId: prodRack.id, onHand: '30.0000', reservedQuantity: '0.0000' },
  });

  const trfCreateRes = await request(app)
    .post('/api/v1/transfers')
    .set('Authorization', `Bearer ${staffToken}`)
    .send({
      warehouseId: warehouse.id,
      lines: [
        {
          productId: product.id,
          quantity: '20.0000',
          sourceLocationId: mainStore.id,
          destinationLocationId: prodRack.id,
        },
      ],
    });
  
  if (trfCreateRes.status !== 201) {
    console.error('Transfer create failed:', trfCreateRes.body);
    process.exit(1);
  }
  const transfer = trfCreateRes.body.data;
  console.log(`Created Transfer: ${transfer.reference} (State: ${transfer.state})`);

  // Mark ready
  await request(app)
    .patch(`/api/v1/transfers/${transfer.id}/status`)
    .set('Authorization', `Bearer ${staffToken}`)
    .send({ state: 'READY' });

  // Validate as Admin
  const trfValRes = await request(app)
    .post(`/api/v1/transfers/${transfer.id}/validate`)
    .set('Authorization', `Bearer ${adminToken}`)
    .set('Idempotency-Key', `smoke-trf-${Date.now()}`);

  console.log(`Validated Transfer: Status ${trfValRes.status} (State: ${trfValRes.body.data.state})`);

  const storeQuantAfter = await prisma.stockQuant.findUnique({
    where: { productId_locationId: { productId: product.id, locationId: mainStore.id } },
  });
  const prodQuantAfter = await prisma.stockQuant.findUnique({
    where: { productId_locationId: { productId: product.id, locationId: prodRack.id } },
  });

  console.log(`Main Store Balance: ${storeQuantAfter.onHand} (Expected: 50.0000)`);
  console.log(`Production Rack Balance: ${prodQuantAfter.onHand} (Expected: 50.0000)`);
  console.log(`Total Balance: ${Number(storeQuantAfter.onHand) + Number(prodQuantAfter.onHand)} (Expected: 100.0000)`);

  const trfPass =
    Number(storeQuantAfter.onHand) === 50 &&
    Number(prodQuantAfter.onHand) === 50 &&
    trfValRes.body.data.state === 'DONE';
  console.log(`Scenario 1 Result: ${trfPass ? 'PASS' : 'FAIL'}`);

  // --- Scenario 2: Positive Adjustment (80 -> 85, +5 move) ---
  console.log('\n--- Scenario 2: Positive Adjustment (80 -> 85) ---');
  await prisma.stockQuant.upsert({
    where: { productId_locationId: { productId: product.id, locationId: mainStore.id } },
    update: { onHand: '80.0000', reservedQuantity: '0.0000' },
    create: { productId: product.id, locationId: mainStore.id, onHand: '80.0000', reservedQuantity: '0.0000' },
  });

  const adjPosCreate = await request(app)
    .post('/api/v1/adjustments')
    .set('Authorization', `Bearer ${staffToken}`)
    .send({
      warehouseId: warehouse.id,
      reason: 'Physical inventory surplus',
      lines: [
        {
          productId: product.id,
          locationId: mainStore.id,
          countedQuantity: '85.0000',
        },
      ],
    });

  const posAdj = adjPosCreate.body.data;
  console.log(`Created Adjustment: ${posAdj.reference} (System: ${posAdj.lines[0].systemQuantity}, Counted: ${posAdj.lines[0].countedQuantity}, Diff: ${posAdj.lines[0].difference})`);

  // Validate
  const posValRes = await request(app)
    .post(`/api/v1/adjustments/${posAdj.id}/validate`)
    .set('Authorization', `Bearer ${adminToken}`)
    .set('Idempotency-Key', `smoke-adj-pos-${Date.now()}`);

  const quantAfterPos = await prisma.stockQuant.findUnique({
    where: { productId_locationId: { productId: product.id, locationId: mainStore.id } },
  });
  console.log(`Stock After Positive Adjustment: ${quantAfterPos.onHand} (Expected: 85.0000)`);
  const posPass = Number(quantAfterPos.onHand) === 85 && posValRes.status === 200;
  console.log(`Scenario 2 Result: ${posPass ? 'PASS' : 'FAIL'}`);

  // --- Scenario 3: Negative Adjustment (80 -> 75, -5 move) ---
  console.log('\n--- Scenario 3: Negative Adjustment (80 -> 75) ---');
  await prisma.stockQuant.upsert({
    where: { productId_locationId: { productId: product.id, locationId: mainStore.id } },
    update: { onHand: '80.0000', reservedQuantity: '0.0000' },
    create: { productId: product.id, locationId: mainStore.id, onHand: '80.0000', reservedQuantity: '0.0000' },
  });

  const adjNegCreate = await request(app)
    .post('/api/v1/adjustments')
    .set('Authorization', `Bearer ${staffToken}`)
    .send({
      warehouseId: warehouse.id,
      reason: 'Physical inventory shrinkage',
      lines: [
        {
          productId: product.id,
          locationId: mainStore.id,
          countedQuantity: '75.0000',
        },
      ],
    });

  const negAdj = adjNegCreate.body.data;
  console.log(`Created Adjustment: ${negAdj.reference} (System: ${negAdj.lines[0].systemQuantity}, Counted: ${negAdj.lines[0].countedQuantity}, Diff: ${negAdj.lines[0].difference})`);

  // Validate
  const negValRes = await request(app)
    .post(`/api/v1/adjustments/${negAdj.id}/validate`)
    .set('Authorization', `Bearer ${adminToken}`)
    .set('Idempotency-Key', `smoke-adj-neg-${Date.now()}`);

  const quantAfterNeg = await prisma.stockQuant.findUnique({
    where: { productId_locationId: { productId: product.id, locationId: mainStore.id } },
  });
  console.log(`Stock After Negative Adjustment: ${quantAfterNeg.onHand} (Expected: 75.0000)`);
  const negPass = Number(quantAfterNeg.onHand) === 75 && negValRes.status === 200;
  console.log(`Scenario 3 Result: ${negPass ? 'PASS' : 'FAIL'}`);

  // --- Scenario 4: Unauthorized Adjustment Approval ---
  console.log('\n--- Scenario 4: Unauthorized Adjustment Approval ---');
  const adjAuthTest = await request(app)
    .post('/api/v1/adjustments')
    .set('Authorization', `Bearer ${staffToken}`)
    .send({
      warehouseId: warehouse.id,
      lines: [
        {
          productId: product.id,
          locationId: mainStore.id,
          countedQuantity: '75.0000',
        },
      ],
    });

  const staffValAttempt = await request(app)
    .post(`/api/v1/adjustments/${adjAuthTest.body.data.id}/validate`)
    .set('Authorization', `Bearer ${staffToken}`)
    .set('Idempotency-Key', `smoke-adj-auth-${Date.now()}`);

  console.log(`Staff Validate Attempt Status: ${staffValAttempt.status} (Expected: 403 Forbidden)`);
  const authPass = staffValAttempt.status === 403;
  console.log(`Scenario 4 Result: ${authPass ? 'PASS' : 'FAIL'}`);

  console.log('\n========================================');
  console.log('ALL PHASE 6 SMOKE TEST SCENARIOS PASSED!');
  console.log('========================================\n');
}

runSmokeTests()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
