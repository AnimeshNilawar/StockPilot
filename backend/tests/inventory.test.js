const crypto = require('crypto');
const request = require('supertest');
const { Prisma } = require('@prisma/client');
const app = require('../src/app');
const { prisma } = require('../src/lib/prisma');
const inventoryService = require('../src/services/inventory.service');
const idempotencyService = require('../src/services/idempotency.service');
const {
  auth,
  unique,
  createUserWithToken,
  createWarehouseWithLocations,
  createProduct,
  removeUser,
  LOCATION_TYPES,
} = require('./helpers');
const { isStockHolding, isBoundary } = require('../src/domain/location');
const { DOCUMENT_TYPES } = require('../src/domain/documentType');

const ZERO = new Prisma.Decimal(0);
const dec = (v) => new Prisma.Decimal(v);

/** Decimal fields are serialised as strings, so responses must be parsed. */
const d = (value) => new Prisma.Decimal(value);

let manager;
let warehouse;
let loc;
let product;
let keySeq = 0;
const nextKey = (label) => `test-${label}-${unique()}-${keySeq++}`;

/** The engine's HTTP surface: a direct movement, idempotency key included. */
const move = (token, body, key = nextKey('move')) =>
  request(app).post('/api/v1/moves').set(auth(token)).set('Idempotency-Key', key).send(body);

/** Puts `qty` on hand at a location through a vendor receipt. */
const receive = (locationId, qty) => receiveInto(product.id, locationId, qty);

const receiveInto = (productId, locationId, qty) =>
  prisma.$transaction((tx) =>
    inventoryService.executeMove(tx, {
      productId,
      fromLocationId: loc.vendor,
      toLocationId: locationId,
      quantity: dec(qty),
      documentType: DOCUMENT_TYPES.RECEIPT,
      documentId: `seed:${unique()}`,
      reference: `SEED-${unique()}`,
    }),
  );

const quantOf = (productId, locationId) =>
  prisma.stockQuant
    .findUnique({ where: { productId_locationId: { productId, locationId } } })
    .then((q) => (q ? dec(q.onHand) : ZERO));

const reservedOf = (productId, locationId) =>
  prisma.stockQuant
    .findUnique({ where: { productId_locationId: { productId, locationId } } })
    .then((q) => (q ? dec(q.reservedQuantity) : ZERO));

const quantAt = (locationId) => quantOf(product.id, locationId);
const reservedAt = (locationId) => reservedOf(product.id, locationId);

const setQuant = (locationId, onHand, reservedQuantity = 0) =>
  prisma.stockQuant.upsert({
    where: { productId_locationId: { productId: product.id, locationId } },
    create: {
      productId: product.id,
      locationId,
      onHand: dec(onHand),
      reservedQuantity: dec(reservedQuantity),
    },
    update: { onHand: dec(onHand), reservedQuantity: dec(reservedQuantity) },
  });

const dropWarehouse = async (target) => {
  const locationIds = Object.values(target.locations).map((location) => location.id);
  await prisma.stockQuant.deleteMany({ where: { locationId: { in: locationIds } } });
  await prisma.stockMove.deleteMany({
    where: {
      OR: [{ fromLocationId: { in: locationIds } }, { toLocationId: { in: locationIds } }],
    },
  });
  await prisma.location.deleteMany({ where: { warehouseId: target.warehouse.id } });
  await prisma.warehouse.delete({ where: { id: target.warehouse.id } });
};

beforeAll(async () => {
  manager = await createUserWithToken('INVENTORY_MANAGER');
  warehouse = await createWarehouseWithLocations({ name: `InvTest-${unique()}` });
  // The suite works with bare location ids; `warehouse` keeps the full records
  // for teardown.
  loc = Object.fromEntries(Object.entries(warehouse.locations).map(([key, l]) => [key, l.id]));
  product = await createProduct({
    sku: `INV${unique('inv').replace(/-/g, '').toUpperCase()}`,
    name: 'Inventory Test Product',
    uomCode: 'KG',
    reorderMin: '5',
    reorderMax: '500',
  });
});

afterAll(async () => {
  await prisma.stockMove.deleteMany({ where: { productId: product.id } });
  await prisma.stockQuant.deleteMany({ where: { productId: product.id } });
  await dropWarehouse(warehouse);
  await prisma.product.delete({ where: { id: product.id } }).catch(() => {});
  await removeUser(manager.user.id);
  await idempotencyService.purgeExpired();
  await prisma.$disconnect();
});

describe('inventory engine · core invariants', () => {
  it('starts with an empty ledger and no balance rows', async () => {
    expect(await prisma.stockQuant.count({ where: { productId: product.id } })).toBe(0);
    expect(await prisma.stockMove.count({ where: { productId: product.id } })).toBe(0);
  });

  it('credits a vendor receipt without needing a tracked vendor balance', async () => {
    const res = await move(manager.token, {
      productId: product.id,
      fromLocationId: loc.vendor,
      toLocationId: loc.store,
      quantity: '100.0000',
    });

    expect(res.status).toBe(201);
    expect(res.body.data.state).toBe('DONE');
    expect(res.body.data.documentType).toBe(DOCUMENT_TYPES.RECEIPT);
    expect(res.body.data.reference).toMatch(/^RCP-\d{6}$/);
    expect((await quantAt(loc.store)).toString()).toBe('100');
    expect(await prisma.stockQuant.count({ where: { locationId: loc.vendor } })).toBe(0);
  });

  it('preserves total stock across an internal move', async () => {
    const before = await inventoryService.totalOnHand(product.id);

    const res = await move(manager.token, {
      productId: product.id,
      fromLocationId: loc.store,
      toLocationId: loc.production,
      quantity: '25.5000',
    });

    expect(res.status).toBe(201);
    expect((await quantAt(loc.store)).toString()).toBe('74.5');
    expect((await quantAt(loc.production)).toString()).toBe('25.5');
    expect((await inventoryService.totalOnHand(product.id)).toString()).toBe(before.toString());
  });

  it('rejects a move that would take stock below zero', async () => {
    const res = await move(manager.token, {
      productId: product.id,
      fromLocationId: loc.production,
      toLocationId: loc.scrap,
      quantity: '9999.0000',
    });

    expect(res.status).toBe(422);
    expect(res.body.code).toBe('INSUFFICIENT_STOCK');
    // The failed transaction rolled back completely.
    expect((await quantAt(loc.production)).toString()).toBe('25.5');
  });

  it('rejects a cross-warehouse move', async () => {
    const other = await createWarehouseWithLocations({ name: `Other-${unique()}` });
    try {
      const res = await move(manager.token, {
        productId: product.id,
        fromLocationId: loc.store,
        toLocationId: other.locations.store.id,
        quantity: '1.0000',
      });

      expect(res.status).toBe(422);
      expect(res.body.code).toBe('CROSS_WAREHOUSE_MOVE');
    } finally {
      await dropWarehouse(other);
    }
  });

  it('rejects a move whose source and destination are the same', async () => {
    const res = await move(manager.token, {
      productId: product.id,
      fromLocationId: loc.store,
      toLocationId: loc.store,
      quantity: '1.0000',
    });

    expect(res.status).toBe(400);
  });

  it('rejects a non-positive quantity', async () => {
    for (const quantity of ['0.0000', '-5.0000']) {
      const res = await move(manager.token, {
        productId: product.id,
        fromLocationId: loc.store,
        toLocationId: loc.production,
        quantity,
      });
      expect(res.status).toBe(400);
    }
  });

  it('rejects an unknown product', async () => {
    const res = await move(manager.token, {
      productId: crypto.randomUUID(),
      fromLocationId: loc.vendor,
      toLocationId: loc.store,
      quantity: '1.0000',
    });

    expect(res.status).toBe(400);
    expect(res.body.code).toBe('PRODUCT_NOT_FOUND');
  });

  it('rejects an unknown location', async () => {
    const res = await move(manager.token, {
      productId: product.id,
      fromLocationId: loc.vendor,
      toLocationId: crypto.randomUUID(),
      quantity: '1.0000',
    });

    expect(res.status).toBe(400);
    expect(res.body.code).toBe('LOCATION_NOT_FOUND');
  });

  it('agrees with an independent replay of the ledger', async () => {
    const ledger = await inventoryService.ledgerBalances(product.id);
    const quants = await prisma.stockQuant.findMany({ where: { productId: product.id } });

    expect(quants.length).toBeGreaterThan(0);
    for (const quant of quants) {
      const expected = ledger.get(quant.locationId) || ZERO;
      expect(dec(quant.onHand).toString()).toBe(expected.toString());
    }
  });

  it('reports no ledger/cache mismatch through the API', async () => {
    const res = await request(app)
      .get(`/api/v1/stock/reconcile?productId=${product.id}`)
      .set(auth(manager.token));

    expect(res.status).toBe(200);
    expect(res.body.data.mismatches).toEqual([]);
  });
});

describe('location type rules', () => {
  const fake = (over) => ({ id: 'x', warehouseId: 'w1', type: LOCATION_TYPES.INTERNAL, ...over });

  it('classifies holding and boundary locations', () => {
    [
      LOCATION_TYPES.INTERNAL,
      LOCATION_TYPES.PRODUCTION,
      LOCATION_TYPES.SCRAP,
      LOCATION_TYPES.TRANSIT,
    ].forEach((type) => expect(isStockHolding(type)).toBe(true));
    [LOCATION_TYPES.VENDOR, LOCATION_TYPES.CUSTOMER].forEach((type) => {
      expect(isStockHolding(type)).toBe(false);
      expect(isBoundary(type)).toBe(true);
    });
  });

  it('accepts a receipt only from a vendor into a holding location', () => {
    expect(() =>
      inventoryService.assertMoveAllowed({
        fromLocation: fake({ id: 'a', type: LOCATION_TYPES.VENDOR }),
        toLocation: fake({ id: 'b' }),
        documentType: DOCUMENT_TYPES.RECEIPT,
      }),
    ).not.toThrow();

    expect(() =>
      inventoryService.assertMoveAllowed({
        fromLocation: fake({ id: 'a' }),
        toLocation: fake({ id: 'b', type: LOCATION_TYPES.VENDOR }),
        documentType: DOCUMENT_TYPES.RECEIPT,
      }),
    ).toThrow(/receipt/i);
  });

  it('accepts a delivery only from a holding location into a customer', () => {
    expect(() =>
      inventoryService.assertMoveAllowed({
        fromLocation: fake({ id: 'a' }),
        toLocation: fake({ id: 'b', type: LOCATION_TYPES.CUSTOMER }),
        documentType: DOCUMENT_TYPES.DELIVERY,
      }),
    ).not.toThrow();

    expect(() =>
      inventoryService.assertMoveAllowed({
        fromLocation: fake({ id: 'a' }),
        toLocation: fake({ id: 'b', type: LOCATION_TYPES.PRODUCTION }),
        documentType: DOCUMENT_TYPES.DELIVERY,
      }),
    ).toThrow(/customer/i);
  });

  it('requires both sides to be holding for an internal move', () => {
    expect(() =>
      inventoryService.assertMoveAllowed({
        fromLocation: fake({ id: 'a' }),
        toLocation: fake({ id: 'b', type: LOCATION_TYPES.CUSTOMER }),
        documentType: DOCUMENT_TYPES.INTERNAL,
      }),
    ).toThrow(/internal/i);
  });

  it('rejects a movement between two boundary locations', () => {
    expect(() =>
      inventoryService.assertMoveAllowed({
        fromLocation: fake({ id: 'a', type: LOCATION_TYPES.VENDOR }),
        toLocation: fake({ id: 'b', type: LOCATION_TYPES.CUSTOMER }),
        documentType: DOCUMENT_TYPES.INTERNAL,
      }),
    ).toThrow(/stock-holding/i);
  });

  it('rejects an unknown document type', () => {
    expect(() =>
      inventoryService.assertMoveAllowed({
        fromLocation: fake({ id: 'a' }),
        toLocation: fake({ id: 'b' }),
        documentType: 'SHIPMENT',
      }),
    ).toThrow(/document type/i);
  });
});

describe('reservations', () => {
  const reserve = (locationId, quantity) =>
    prisma.$transaction((tx) =>
      inventoryService.reserve(tx, { productId: product.id, locationId, quantity }),
    );

  beforeEach(async () => {
    await receive(loc.store, '50.0000');
    await setQuant(loc.store, '50.0000', 0);
  });

  it('reserves against free-to-use without changing on-hand', async () => {
    const before = await quantAt(loc.store);
    await reserve(loc.store, '20.0000');

    expect((await quantAt(loc.store)).toString()).toBe(before.toString());
    expect((await reservedAt(loc.store)).toString()).toBe('20');
  });

  it('rejects a reservation larger than free-to-use', async () => {
    await expect(reserve(loc.store, '51.0000')).rejects.toMatchObject({
      code: 'INSUFFICIENT_STOCK',
      status: 422,
    });
  });

  it('rejects a second reservation that would exceed free-to-use', async () => {
    await reserve(loc.store, '20.0000'); // 30 free remain
    await expect(reserve(loc.store, '31.0000')).rejects.toMatchObject({
      code: 'INSUFFICIENT_STOCK',
    });
  });

  it('allows a second reservation up to the remaining free amount', async () => {
    await reserve(loc.store, '20.0000');
    await reserve(loc.store, '30.0000');
    expect((await reservedAt(loc.store)).toString()).toBe('50');
  });

  it('blocks a delivery that would consume stock another document reserved', async () => {
    await setQuant(loc.store, '10.0000', '8.0000');

    const res = await move(manager.token, {
      productId: product.id,
      fromLocationId: loc.store,
      toLocationId: loc.customer,
      quantity: '5.0000',
    });

    expect(res.status).toBe(422);
    expect(res.body.code).toBe('INSUFFICIENT_STOCK');
    expect((await quantAt(loc.store)).toString()).toBe('10');
  });

  it('releases a reservation without touching on-hand', async () => {
    await reserve(loc.store, '20.0000');
    const onHandBefore = await quantAt(loc.store);

    await prisma.$transaction((tx) =>
      inventoryService.releaseReservation(tx, {
        productId: product.id,
        locationId: loc.store,
        quantity: '5.0000',
      }),
    );

    expect((await quantAt(loc.store)).toString()).toBe(onHandBefore.toString());
    expect((await reservedAt(loc.store)).toString()).toBe('15');
  });

  it('clamps a release at zero instead of going negative', async () => {
    await reserve(loc.store, '5.0000');
    await prisma.$transaction((tx) =>
      inventoryService.releaseReservation(tx, {
        productId: product.id,
        locationId: loc.store,
        quantity: '99.0000',
      }),
    );

    expect((await reservedAt(loc.store)).toString()).toBe('0');
  });

  it('consumes reserved and physical stock in one transaction', async () => {
    await setQuant(loc.store, '10.0000', '4.0000');

    await prisma.$transaction((tx) =>
      inventoryService.consumeReservation(tx, {
        productId: product.id,
        locationId: loc.store,
        quantity: '4.0000',
      }),
    );

    expect((await quantAt(loc.store)).toString()).toBe('6');
    expect((await reservedAt(loc.store)).toString()).toBe('0');
  });
});

describe('idempotency', () => {
  const body = () => ({
    productId: product.id,
    fromLocationId: loc.vendor,
    toLocationId: loc.store,
    quantity: '5.0000',
  });

  it('requires the header', async () => {
    const res = await request(app).post('/api/v1/moves').set(auth(manager.token)).send(body());
    expect(res.status).toBe(400);
    expect(res.body.code).toBe('IDEMPOTENCY_KEY_REQUIRED');
  });

  it('rejects a key too short to be unique', async () => {
    const res = await request(app)
      .post('/api/v1/moves')
      .set(auth(manager.token))
      .set('Idempotency-Key', 'abc')
      .send(body());

    expect(res.status).toBe(400);
    expect(res.body.code).toBe('IDEMPOTENCY_KEY_INVALID');
  });

  it('moves stock once and replays the stored response on retry', async () => {
    const key = nextKey('replay');
    const before = await quantAt(loc.store);

    const first = await move(manager.token, body(), key);
    expect(first.status).toBe(201);
    expect(first.headers['idempotent-replay']).toBeUndefined();

    const second = await move(manager.token, body(), key);
    expect(second.status).toBe(200);
    expect(second.headers['idempotent-replay']).toBe('true');
    expect(second.body.data.id).toBe(first.body.data.id);
    expect((await quantAt(loc.store)).minus(before).toString()).toBe('5');
  });

  it('rejects a key reused with a different payload', async () => {
    const key = nextKey('mismatch');
    expect((await move(manager.token, body(), key)).status).toBe(201);

    const res = await move(manager.token, { ...body(), quantity: '6.0000' }, key);
    expect(res.status).toBe(409);
    expect(res.body.code).toBe('IDEMPOTENCY_KEY_REUSE');
  });

  it('does not burn the key when the business transaction fails', async () => {
    const key = nextKey('retryable');

    const failed = await move(
      manager.token,
      {
        ...body(),
        fromLocationId: loc.store,
        toLocationId: loc.production,
        quantity: '999999.0000',
      },
      key,
    );
    expect(failed.status).toBe(422);
    expect(failed.body.code).toBe('INSUFFICIENT_STOCK');

    // The failed attempt rolled the key back, so the same key may be retried.
    const retried = await move(manager.token, body(), key);
    expect(retried.status).toBe(201);
  });

  it('refuses to replay an expired key', async () => {
    const key = nextKey('expired');
    expect((await move(manager.token, body(), key)).status).toBe(201);

    await prisma.idempotencyKey.update({
      where: { key },
      data: { expiresAt: new Date(Date.now() - 1000) },
    });

    const res = await move(manager.token, body(), key);
    expect(res.status).toBe(409);
    expect(res.body.code).toBe('IDEMPOTENCY_KEY_EXPIRED');
  });

  it('purges expired keys', async () => {
    const key = nextKey('purge');
    expect((await move(manager.token, body(), key)).status).toBe(201);
    await prisma.idempotencyKey.update({
      where: { key },
      data: { expiresAt: new Date(Date.now() - 1000) },
    });

    expect(await idempotencyService.purgeExpired()).toBeGreaterThanOrEqual(1);
    expect(await prisma.idempotencyKey.findUnique({ where: { key } })).toBeNull();
  });
});

describe('concurrency', () => {
  // This block seeds its own product through real receipts, so its reconciliation
  // assertion proves the engine rather than a hand-written balance.
  let race;

  beforeAll(async () => {
    race = await createProduct({
      sku: `RACE${unique('race').replace(/-/g, '').toUpperCase()}`,
      name: 'Concurrency Test Product',
      uomCode: 'PCS',
    });
    await receiveInto(race.id, loc.production, '10.0000');
    await receiveInto(race.id, loc.store, '100.0000');
  });

  afterAll(async () => {
    await prisma.stockMove.deleteMany({ where: { productId: race.id } });
    await prisma.stockQuant.deleteMany({ where: { productId: race.id } });
    await prisma.product.delete({ where: { id: race.id } }).catch(() => {});
  });

  it('never oversells under parallel deliveries', async () => {
    // 12 parallel attempts to ship 1 unit each against a balance of 10.
    const attempts = await Promise.all(
      Array.from({ length: 12 }, () =>
        move(manager.token, {
          productId: race.id,
          fromLocationId: loc.production,
          toLocationId: loc.customer,
          quantity: '1.0000',
        }),
      ),
    );

    const accepted = attempts.filter((res) => res.status === 201);
    const rejected = attempts.filter((res) => res.status === 422);

    expect(accepted).toHaveLength(10);
    expect(rejected).toHaveLength(2);
    expect((await quantOf(race.id, loc.production)).toString()).toBe('0');
    // The customer's goods left the building: a CUSTOMER node never holds a
    // balance, and the ledger records all ten shipments.
    expect(
      await prisma.stockQuant.count({ where: { productId: race.id, locationId: loc.customer } }),
    ).toBe(0);
    expect(
      await prisma.stockMove.count({
        where: {
          productId: race.id,
          fromLocationId: loc.production,
          toLocationId: loc.customer,
          documentType: DOCUMENT_TYPES.DELIVERY,
        },
      }),
    ).toBe(10);
  }, 30000);

  it('never loses an update under parallel opposing internal moves', async () => {
    // 10 moves of 2 units each way, interleaved: conservation must hold exactly.
    const pending = [];
    for (let i = 0; i < 10; i += 1) {
      pending.push(
        move(manager.token, {
          productId: race.id,
          fromLocationId: loc.store,
          toLocationId: loc.production,
          quantity: '2.0000',
        }),
        move(manager.token, {
          productId: race.id,
          fromLocationId: loc.production,
          toLocationId: loc.store,
          quantity: '1.0000',
        }),
      );
    }
    const storeBefore = await quantOf(race.id, loc.store);
    const productionBefore = await quantOf(race.id, loc.production);
    const totalBefore = storeBefore.plus(productionBefore);

    const results = await Promise.all(pending);

    const store = await quantOf(race.id, loc.store);
    const production = await quantOf(race.id, loc.production);

    // Every request must be honoured: 10 moves of 2 out, 10 moves of 1 back.
    expect(results.every((res) => res.status === 201)).toBe(true);
    // Whatever the interleaving, the total must be preserved exactly: this is
    // the assertion that fails if a quant update is lost or applied twice.
    expect(store.plus(production).toString()).toBe(totalBefore.toString());
    expect(store.minus(storeBefore).toString()).toBe('-10');
  }, 30000);

  it('keeps the ledger consistent with the cache after the contention', async () => {
    const res = await request(app)
      .get(`/api/v1/stock/reconcile?productId=${race.id}`)
      .set(auth(manager.token));

    expect(res.status).toBe(200);
    expect(res.body.data.mismatches).toEqual([]);
  });
});

describe('ledger immutability is enforced by the database', () => {
  it('refuses to rewrite a completed move', async () => {
    const row = await prisma.stockMove.findFirst({
      where: { productId: product.id, state: 'DONE' },
      orderBy: { doneDate: 'desc' },
    });

    await expect(
      prisma.stockMove.update({ where: { id: row.id }, data: { quantity: dec('9999.0000') } }),
    ).rejects.toThrow(/immutable/i);
  });

  it('refuses a state outside the vocabulary', async () => {
    const row = await prisma.stockMove.findFirst({
      where: { productId: product.id, state: 'DONE' },
    });

    await expect(
      prisma.stockMove
        .create({
          data: {
            reference: `BAD-${unique()}`,
            productId: product.id,
            fromLocationId: loc.store,
            toLocationId: loc.production,
            quantity: dec('1.0000'),
            state: 'shipped',
            documentType: DOCUMENT_TYPES.INTERNAL,
            documentId: 'bad',
          },
        })
        .catch((error) => {
          expect(row).toBeDefined();
          throw error;
        }),
    ).rejects.toThrow(/stock_moves_state_check/i);
  });

  it('refuses to take a quant below zero', async () => {
    await setQuant(loc.production, '1.0000', 0);

    await expect(
      prisma.stockQuant.update({
        where: { productId_locationId: { productId: product.id, locationId: loc.production } },
        data: { onHand: dec('-1.0000') },
      }),
    ).rejects.toThrow(/negative on_hand/i);
  });

  it('detects a balance that was tampered with outside the engine', async () => {
    // The reservations block writes quants directly to set up its state, so the
    // checker must notice that the cache has drifted from the ledger.
    const res = await request(app)
      .get(`/api/v1/stock/reconcile?productId=${product.id}`)
      .set(auth(manager.token));

    expect(res.status).toBe(200);
    expect(res.body.data.mismatches.length).toBeGreaterThan(0);
    for (const row of res.body.data.mismatches) {
      expect(row).toMatchObject({ productId: product.id });
      expect(row.ledgerOnHand).not.toBe(row.quantOnHand);
    }
  });

  it('refuses a reservation larger than on-hand', async () => {
    const quant = await prisma.stockQuant.findUnique({
      where: { productId_locationId: { productId: product.id, locationId: loc.production } },
    });

    await expect(
      prisma.stockQuant.update({
        where: { productId_locationId: { productId: product.id, locationId: loc.production } },
        data: { reservedQuantity: dec(quant.onHand).plus(1) },
      }),
    ).rejects.toThrow(/exceeds on_hand/i);
  });
});

describe('stock read endpoints', () => {
  it('requires authentication', async () => {
    expect((await request(app).get('/api/v1/stock')).status).toBe(401);
    expect((await request(app).get('/api/v1/moves')).status).toBe(401);
  });

  it('returns balances with derived free-to-use and low-stock flags', async () => {
    const res = await request(app)
      .get(`/api/v1/stock?productId=${product.id}&pageSize=100`)
      .set(auth(manager.token));

    expect(res.status).toBe(200);
    const row = res.body.data.items.find((item) => item.locationId === loc.store);
    expect(row).toBeDefined();
    expect(d(row.freeToUse).toString()).toBe(
      d(row.onHand).minus(d(row.reservedQuantity)).toString(),
    );
    expect(typeof row.isLowStock).toBe('boolean');
    expect(res.body.data.pagination).toMatchObject({ page: 1, pageSize: 100 });
  });

  it('hides empty rows when nonZero is requested', async () => {
    const res = await request(app)
      .get(`/api/v1/stock?productId=${product.id}&nonZero=true&pageSize=100`)
      .set(auth(manager.token));

    expect(res.status).toBe(200);
    expect(res.body.data.items.every((item) => d(item.onHand).gt(0))).toBe(true);
  });

  it('summarises balances per product', async () => {
    const res = await request(app)
      .get(`/api/v1/stock/summary?productIds=${product.id}`)
      .set(auth(manager.token));

    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(1);
    expect(res.body.data[0].product.sku).toBe(product.sku);
  });

  it('lists products at or below their reorder minimum', async () => {
    const res = await request(app)
      .get('/api/v1/stock/low-stock?pageSize=200')
      .set(auth(manager.token));

    expect(res.status).toBe(200);
    for (const row of res.body.data.items) {
      expect(d(row.onHand).lte(d(row.reorderMin || 0))).toBe(true);
      expect(d(row.shortfall).gte(0)).toBe(true);
    }
  });

  it('rejects a malformed productIds filter', async () => {
    const res = await request(app)
      .get('/api/v1/stock/summary?productIds=not-a-uuid')
      .set(auth(manager.token));

    expect(res.status).toBe(400);
  });

  it('lists the ledger with the product and locations attached', async () => {
    const res = await request(app)
      .get(`/api/v1/moves?productId=${product.id}&pageSize=5`)
      .set(auth(manager.token));

    expect(res.status).toBe(200);
    expect(res.body.data.items.length).toBeGreaterThan(0);
    expect(res.body.data.items[0].product.sku).toBe(product.sku);
    expect(res.body.data.items[0].state).toBe('DONE');
    expect(res.body.data.items[0].toLocation.shortCode).toBeDefined();
  });

  it('filters the ledger by state and rejects an unknown state', async () => {
    const done = await request(app)
      .get(`/api/v1/moves?productId=${product.id}&state=done`)
      .set(auth(manager.token));
    expect(done.status).toBe(200);
    expect(done.body.data.items.every((item) => item.state === 'DONE')).toBe(true);

    const bad = await request(app).get('/api/v1/moves?state=shipped').set(auth(manager.token));
    expect(bad.status).toBe(400);
  });

  it('filters the ledger by document type and reference', async () => {
    const byType = await request(app)
      .get(`/api/v1/moves?productId=${product.id}&documentType=receipt`)
      .set(auth(manager.token));
    expect(byType.status).toBe(200);
    expect(byType.body.data.items.every((item) => item.documentType === 'RECEIPT')).toBe(true);

    const byRef = await request(app)
      .get(`/api/v1/moves?productId=${product.id}&reference=RCP-000001`)
      .set(auth(manager.token));
    expect(byRef.status).toBe(200);
  });

  it('searches the ledger by product SKU', async () => {
    const res = await request(app)
      .get(`/api/v1/moves?search=${encodeURIComponent(product.sku)}`)
      .set(auth(manager.token));

    expect(res.status).toBe(200);
    expect(res.body.data.items.every((item) => item.product.sku === product.sku)).toBe(true);
  });

  it('404s an unknown move id', async () => {
    const res = await request(app)
      .get(`/api/v1/moves/${crypto.randomUUID()}`)
      .set(auth(manager.token));

    expect(res.status).toBe(404);
  });
});

describe('warehouse scoping and permissions', () => {
  it('pins a warehouse-scoped role to its assignments', async () => {
    const other = await createWarehouseWithLocations({ name: `Hidden-${unique()}` });
    const staff = await createUserWithToken('WAREHOUSE_STAFF', {
      warehouseIds: [warehouse.warehouse.id],
    });

    try {
      const mine = await request(app)
        .get(`/api/v1/stock?warehouseId=${warehouse.warehouse.id}&pageSize=200`)
        .set(auth(staff.token));
      expect(mine.status).toBe(200);
      expect(
        mine.body.data.items.every((item) => item.location.warehouseId === warehouse.warehouse.id),
      ).toBe(true);

      // Naming an unassigned warehouse is refused outright, so the filter can
      // never be used to probe another warehouse's balances.
      const theirs = await request(app)
        .get(`/api/v1/stock?warehouseId=${other.warehouse.id}&pageSize=200`)
        .set(auth(staff.token));
      expect(theirs.status).toBe(403);

      const moves = await request(app).get(`/api/v1/moves?pageSize=200`).set(auth(staff.token));
      expect(moves.status).toBe(200);
      expect(
        moves.body.data.items.every(
          (item) =>
            item.fromLocation.warehouseId === warehouse.warehouse.id ||
            item.toLocation.warehouseId === warehouse.warehouse.id,
        ),
      ).toBe(true);
    } finally {
      await dropWarehouse(other);
      await removeUser(staff.user.id);
    }
  });

  it('forbids a move into a warehouse the caller is not assigned to', async () => {
    const other = await createWarehouseWithLocations({ name: `StaffMove-${unique()}` });
    const staff = await createUserWithToken('WAREHOUSE_STAFF', {
      warehouseIds: [warehouse.warehouse.id],
    });

    try {
      const res = await move(staff.token, {
        productId: product.id,
        fromLocationId: other.locations.vendor,
        toLocationId: other.locations.store,
        quantity: '1.0000',
      });

      expect(res.status).toBe(403);
    } finally {
      await dropWarehouse(other);
      await removeUser(staff.user.id);
    }
  });

  it('denies the move when the role lacks stock.move', async () => {
    const role = await prisma.role.findUnique({
      where: { name: 'WAREHOUSE_STAFF' },
      include: { permissions: true },
    });
    const original = role.permissions.map((row) => row.permissionId);
    const staff = await createUserWithToken('WAREHOUSE_STAFF', {
      warehouseIds: [warehouse.warehouse.id],
    });

    try {
      // Swap the role's grant for a single read permission, then restore it.
      await prisma.rolePermission.deleteMany({ where: { roleId: role.id } });
      const onlyRead = await prisma.permission.findUnique({ where: { action: 'stock.read' } });
      await prisma.rolePermission.create({
        data: { roleId: role.id, permissionId: onlyRead.id },
      });

      const res = await move(staff.token, {
        productId: product.id,
        fromLocationId: loc.vendor,
        toLocationId: loc.store,
        quantity: '1.0000',
      });

      expect(res.status).toBe(403);
    } finally {
      await prisma.rolePermission.createMany({
        data: original.map((permissionId) => ({ roleId: role.id, permissionId })),
        skipDuplicates: true,
      });
      await removeUser(staff.user.id);
    }
  });

  it('lets an admin bypass the warehouse restriction', async () => {
    const other = await createWarehouseWithLocations({ name: `AdminScope-${unique()}` });
    const admin = await createUserWithToken('ADMIN');

    try {
      const res = await request(app)
        .get(`/api/v1/stock?warehouseId=${other.warehouse.id}&pageSize=200`)
        .set(auth(admin.token));

      expect(res.status).toBe(200);
      expect(Array.isArray(res.body.data.items)).toBe(true);
    } finally {
      await dropWarehouse(other);
      await removeUser(admin.user.id);
    }
  });
});
