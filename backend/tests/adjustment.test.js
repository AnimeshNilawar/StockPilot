const { Prisma } = require('@prisma/client');
const request = require('supertest');
const app = require('../src/app');
const { prisma } = require('../src/lib/prisma');
const inventoryService = require('../src/services/inventory.service');
const {
  auth,
  unique,
  createUserWithToken,
  createTrackedProduct,
  createTrackedWarehouseWithLocations,
  cleanupFixtures,
} = require('./helpers');
const { DOCUMENT_TYPES } = require('../src/domain/documentType');
const { LOCATION_TYPES } = require('../src/domain/location');

const dec = (v) => new Prisma.Decimal(v);
const quantOnHand = (productId, locationId) =>
  prisma.stockQuant
    .findUnique({ where: { productId_locationId: { productId, locationId } } })
    .then((q) => (q ? dec(q.onHand).toString() : '0'));

/**
 * An adjustment is a stock *correction*, so it may only run between ordinary
 * stock and the scrap bin. These tests pin that rule down, because the looser
 * "must touch stock somehow" check let a transfer masquerade as a correction.
 */
describe('adjustment location rules', () => {
  let manager;
  let warehouse;
  let loc;
  let product;

  beforeAll(async () => {
    manager = await createUserWithToken('INVENTORY_MANAGER');

    const wh = await createTrackedWarehouseWithLocations();
    warehouse = wh.warehouse;
    // The engine works with identifiers, not location records.
    loc = Object.fromEntries(Object.entries(wh.locations).map(([key, record]) => [key, record.id]));

    // A second scrap bin, so scrap-to-scrap has a destination to move into.
    // It lives in the tracked warehouse, so cleanupFixtures takes it with it.
    const scrapYard = await prisma.location.create({
      data: {
        warehouseId: warehouse.id,
        name: 'Scrap Yard',
        shortCode: 'SCRAP-YARD',
        type: LOCATION_TYPES.SCRAP,
      },
    });
    loc.scrapYard = scrapYard.id;

    await prisma.userWarehouseAccess.create({
      data: { userId: manager.user.id, warehouseId: warehouse.id },
    });
  });

  afterAll(async () => {
    await cleanupFixtures();
    await prisma.$disconnect();
  });

  /** Puts stock on hand at a location through a vendor receipt. */
  const receive = (locationId, qty) =>
    prisma.$transaction((tx) =>
      inventoryService.executeMove(tx, {
        productId: product.id,
        fromLocationId: loc.vendor,
        toLocationId: locationId,
        quantity: dec(qty),
        documentType: DOCUMENT_TYPES.RECEIPT,
        documentId: `seed:${unique()}`,
        reference: `SEED-${unique()}`,
      }),
    );

  const postMove = (body) =>
    request(app)
      .post('/api/v1/moves')
      .set(auth(manager.token))
      .set('Idempotency-Key', unique('adj'))
      .send(body);

  /** A fresh product per test keeps stock balances independent. */
  beforeEach(async () => {
    product = await createTrackedProduct();
    await receive(loc.store, 100);
  });

  describe('allowed shapes', () => {
    it('posts a write-off from stock to scrap', async () => {
      const res = await postMove({
        productId: product.id,
        fromLocationId: loc.store,
        toLocationId: loc.scrap,
        quantity: '30',
        documentType: DOCUMENT_TYPES.ADJUSTMENT,
        reason: 'Damaged in transit',
      });

      expect(res.status).toBe(201);
      expect(await quantOnHand(product.id, loc.store)).toBe('70');
      expect(await quantOnHand(product.id, loc.scrap)).toBe('30');
    });

    it('posts a write-back from scrap to stock', async () => {
      await postMove({
        productId: product.id,
        fromLocationId: loc.store,
        toLocationId: loc.scrap,
        quantity: '20',
        documentType: DOCUMENT_TYPES.ADJUSTMENT,
      });

      const res = await postMove({
        productId: product.id,
        fromLocationId: loc.scrap,
        toLocationId: loc.store,
        quantity: '20',
        documentType: DOCUMENT_TYPES.ADJUSTMENT,
        reason: 'Scrap bin miscount corrected',
      });

      expect(res.status).toBe(201);
      expect(await quantOnHand(product.id, loc.store)).toBe('100');
      expect(await quantOnHand(product.id, loc.scrap)).toBe('0');
    });

    it('accepts production as the stock-holding side of a write-off', async () => {
      await receive(loc.production, 10);

      const res = await postMove({
        productId: product.id,
        fromLocationId: loc.production,
        toLocationId: loc.scrap,
        quantity: '4',
        documentType: DOCUMENT_TYPES.ADJUSTMENT,
      });

      expect(res.status).toBe(201);
      expect(await quantOnHand(product.id, loc.production)).toBe('6');
    });
  });

  describe('rejected shapes', () => {
    it('rejects a stock-to-stock move labelled as an adjustment', async () => {
      const res = await postMove({
        productId: product.id,
        fromLocationId: loc.store,
        toLocationId: loc.production,
        quantity: '10',
        documentType: DOCUMENT_TYPES.ADJUSTMENT,
      });

      expect(res.status).toBe(422);
      expect(res.body.code).toBe('INVALID_LOCATION_TYPES');
      expect(res.body.message).toMatch(/stock-holding location and SCRAP/);
      expect(await quantOnHand(product.id, loc.store)).toBe('100');
      expect(await quantOnHand(product.id, loc.production)).toBe('0');
    });

    it('rejects an adjustment into a boundary location', async () => {
      const res = await postMove({
        productId: product.id,
        fromLocationId: loc.store,
        toLocationId: loc.customer,
        quantity: '10',
        documentType: DOCUMENT_TYPES.ADJUSTMENT,
      });

      expect(res.status).toBe(422);
      expect(res.body.code).toBe('INVALID_LOCATION_TYPES');
    });

    it('rejects an adjustment out of a boundary location', async () => {
      const res = await postMove({
        productId: product.id,
        fromLocationId: loc.vendor,
        toLocationId: loc.store,
        quantity: '10',
        documentType: DOCUMENT_TYPES.ADJUSTMENT,
      });

      expect(res.status).toBe(422);
      expect(res.body.code).toBe('INVALID_LOCATION_TYPES');
    });

    it('rejects a scrap-to-scrap move labelled as an adjustment', async () => {
      // SCRAP holds stock, so a move between two scrap bins is stock-holding on
      // both sides. It is a transfer, and posting it as a correction would
      // launder a quantity discrepancy into a stock write-off.
      await receive(loc.scrap, 40);

      const res = await postMove({
        productId: product.id,
        fromLocationId: loc.scrap,
        toLocationId: loc.scrapYard,
        quantity: '10',
        documentType: DOCUMENT_TYPES.ADJUSTMENT,
      });

      expect(res.status).toBe(422);
      expect(res.body.code).toBe('INVALID_LOCATION_TYPES');
      expect(res.body.message).toMatch(/ordinary stock-holding location and SCRAP/);
      expect(await quantOnHand(product.id, loc.scrap)).toBe('40');
      expect(await quantOnHand(product.id, loc.scrapYard)).toBe('0');
    });

    it('leaves the ledger untouched when an adjustment is rejected', async () => {
      const before = await prisma.stockMove.count({ where: { productId: product.id } });

      await postMove({
        productId: product.id,
        fromLocationId: loc.store,
        toLocationId: loc.production,
        quantity: '10',
        documentType: DOCUMENT_TYPES.ADJUSTMENT,
      });

      expect(await prisma.stockMove.count({ where: { productId: product.id } })).toBe(before);
    });
  });

  describe('document type inference', () => {
    it('infers a write-off as an adjustment but treats a write-back as internal', async () => {
      // holding -> scrap: inferred as an adjustment, and it posts.
      const writeOff = await postMove({
        productId: product.id,
        fromLocationId: loc.store,
        toLocationId: loc.scrap,
        quantity: '5',
      });
      expect(writeOff.status).toBe(201);
      expect(writeOff.body.data.documentType).toBe(DOCUMENT_TYPES.ADJUSTMENT);

      // scrap -> holding: both sides hold stock, so it infers as an internal
      // move. Posting a write-back is a deliberate choice by the caller.
      const writeBack = await postMove({
        productId: product.id,
        fromLocationId: loc.scrap,
        toLocationId: loc.store,
        quantity: '5',
      });
      expect(writeBack.status).toBe(201);
      expect(writeBack.body.data.documentType).toBe(DOCUMENT_TYPES.INTERNAL);
    });

    it('infers a move between two scrap bins as an internal transfer', async () => {
      await receive(loc.scrap, 40);

      const res = await postMove({
        productId: product.id,
        fromLocationId: loc.scrap,
        toLocationId: loc.scrapYard,
        quantity: '5',
      });

      expect(res.status).toBe(201);
      expect(res.body.data.documentType).toBe(DOCUMENT_TYPES.INTERNAL);
    });

    it('still refuses a boundary-to-boundary move outright', async () => {
      const res = await postMove({
        productId: product.id,
        fromLocationId: loc.customer,
        toLocationId: loc.vendor,
        quantity: '5',
      });

      expect(res.status).toBe(400);
      expect(res.body.code).toBe('AMBIGUOUS_DOCUMENT_TYPE');
    });
  });
});
