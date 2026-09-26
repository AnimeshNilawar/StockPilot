const request = require('supertest');
const app = require('../src/app');
const {
  prisma,
  createUserWithToken,
  createWarehouseWithLocations,
  createProduct,
  createPartner,
  unique,
  auth,
  trackFixture,
  cleanupFixtures,
} = require('./helpers');
const { DOC_STATES } = require('../src/domain/documentState');
const { PARTNER_TYPES } = require('../src/domain/partner');

/**
 * Deliveries — outbound stock with a reservation step.
 *
 * The suite exercises the workflow end to end against a real database, because
 * the behaviour that matters here (row locks, compare-and-set state writes,
 * NUMERIC arithmetic) only exists in PostgreSQL.
 */
describe('deliveries', () => {
  let manager, staff, otherStaff, admin, unprivileged;
  let warehouse, loc, otherWarehouse, otherLoc;
  let product, product2, product3;
  let customer, supplier, inactiveCustomer;

  beforeAll(async () => {
    manager = await createUserWithToken('INVENTORY_MANAGER');
    staff = await createUserWithToken('WAREHOUSE_STAFF');
    otherStaff = await createUserWithToken('WAREHOUSE_STAFF');
    admin = await createUserWithToken('ADMIN');

    // Every seeded role holds at least one delivery permission, so a role with
    // none is the only way to exercise the permission boundary itself.
    await prisma.role.create({ data: { name: 'TEST_NO_PERMS' } });
    unprivileged = await createUserWithToken('TEST_NO_PERMS');

    product = await createProduct();
    product2 = await createProduct();
    product3 = await createProduct();

    customer = await createPartner({ type: PARTNER_TYPES.CUSTOMER });
    supplier = await createPartner({ type: PARTNER_TYPES.SUPPLIER });
    inactiveCustomer = await createPartner({
      type: PARTNER_TYPES.CUSTOMER,
      isActive: false,
    });

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
      await prisma.userWarehouseAccess.create({ data: { userId: user.user.id, warehouseId: wh.id } });
    }
  });

  afterAll(async () => {
    await cleanupFixtures();
    // cleanupFixtures only owns master data; these users were created here, so
    // they are removed here too, or every run leaves four more behind.
    for (const user of [unprivileged, manager, staff, otherStaff, admin]) {
      await prisma.user.delete({ where: { id: user.user.id } });
    }
    await prisma.role.delete({ where: { name: 'TEST_NO_PERMS' } });
    await prisma.$disconnect();
  });

  const body = (overrides = {}) => ({
    partnerId: customer.id,
    warehouseId: warehouse.id,
    lines: [{ productId: product.id, quantity: '10.0000', sourceLocationId: loc.store.id }],
    ...overrides,
  });

  /**
   * A body whose source line sits in `otherWarehouse` — the two must agree, or
   * creation is correctly refused for a cross-warehouse source.
   */
  const otherWarehouseBody = () => ({
    partnerId: customer.id,
    warehouseId: otherWarehouse.id,
    lines: [
      { productId: product.id, quantity: '10.0000', sourceLocationId: otherLoc.store.id },
    ],
  });

  /** Creates a delivery through the API and registers it for teardown. */
  const createDelivery = async (token, overrides = {}) => {
    const res = await request(app).post('/api/v1/deliveries').set(auth(token)).send(body(overrides));
    expect(res.status).toBe(201);
    return trackFixture('deliveries', res.body.data);
  };

  /** Same, but entirely inside the second warehouse. */
  const createInOtherWarehouse = async () => {
    const res = await request(app)
      .post('/api/v1/deliveries')
      .set(auth(manager.token))
      .send(otherWarehouseBody());
    expect(res.status).toBe(201);
    return trackFixture('deliveries', res.body.data);
  };

  const pick = (token, id) =>
    request(app).post(`/api/v1/deliveries/${id}/pick`).set(auth(token));

  const validate = (token, id, key = unique('key')) =>
    request(app)
      .post(`/api/v1/deliveries/${id}/validate`)
      .set(auth(token))
      .set('Idempotency-Key', key);

  /** Seeds a balance and returns its quant. */
  const stock = async (productId, locationId, onHand, reservedQuantity = '0.0000') => {
    await prisma.stockQuant.upsert({
      where: { productId_locationId: { productId, locationId } },
      update: { onHand, reservedQuantity },
      create: { productId, locationId, onHand, reservedQuantity },
    });
    return prisma.stockQuant.findUnique({
      where: { productId_locationId: { productId, locationId } },
    });
  };

  const quantOf = (productId, locationId) =>
    prisma.stockQuant.findUnique({ where: { productId_locationId: { productId, locationId } } });

  // -------------------------------------------------------------------------

  describe('creation', () => {
    it('creates a DRAFT delivery with a generated reference', async () => {
      const res = await request(app)
        .post('/api/v1/deliveries')
        .set(auth(manager.token))
        .send(body());

      expect(res.status).toBe(201);
      expect(res.body.data.state).toBe(DOC_STATES.DRAFT);
      expect(res.body.data.reference).toMatch(/^DLV-/);
      expect(res.body.data.lines).toHaveLength(1);
      trackFixture('deliveries', res.body.data);
    });

    it('creates the document without touching stock, leaving the reservation for picking', async () => {
      await stock(product.id, loc.store.id, '40.0000', '0.0000');
      const delivery = await createDelivery(manager.token, {
        lines: [{ productId: product.id, quantity: '5.0000', sourceLocationId: loc.store.id }],
      });

      const quant = await quantOf(product.id, loc.store.id);
      expect(delivery.state).toBe(DOC_STATES.DRAFT);
      expect(quant.onHand.toString()).toBe('40');
      expect(quant.reservedQuantity.toString()).toBe('0');
    });

    it('rejects a supplier-only partner, which cannot receive goods', async () => {
      const res = await request(app)
        .post('/api/v1/deliveries')
        .set(auth(manager.token))
        .send(body({ partnerId: supplier.id }));

      expect(res.status).toBe(400);
      expect(res.body.code).toBe('INVALID_PARTNER_TYPE');
    });

    it('rejects an inactive partner', async () => {
      const res = await request(app)
        .post('/api/v1/deliveries')
        .set(auth(manager.token))
        .send(body({ partnerId: inactiveCustomer.id }));

      expect(res.status).toBe(400);
    });

    it('rejects a source location from another warehouse', async () => {
      const res = await request(app)
        .post('/api/v1/deliveries')
        .set(auth(manager.token))
        .send(
          body({
            lines: [
              { productId: product.id, quantity: '1.0000', sourceLocationId: otherLoc.store.id },
            ],
          }),
        );

      expect(res.status).toBe(400);
      expect(res.body.message).toMatch(/does not belong to warehouse/i);
    });

    it('rejects a boundary location as a source, since it never holds a balance', async () => {
      for (const key of ['customer', 'vendor']) {
        const res = await request(app)
          .post('/api/v1/deliveries')
          .set(auth(manager.token))
          .send(
            body({
              lines: [
                { productId: product.id, quantity: '1.0000', sourceLocationId: loc[key].id },
              ],
            }),
          );

        expect(res.status).toBe(400);
        expect(res.body.message).toMatch(/boundary location/i);
      }
    });

    it('rejects a non-positive quantity', async () => {
      for (const quantity of ['0', '-3', 'abc']) {
        const res = await request(app)
          .post('/api/v1/deliveries')
          .set(auth(manager.token))
          .send(
            body({
              lines: [
                { productId: product.id, quantity, sourceLocationId: loc.store.id },
              ],
            }),
          );

        expect(res.status).toBe(400);
      }
    });

    it('rejects a warehouse the caller cannot reach', async () => {
      const res = await request(app)
        .post('/api/v1/deliveries')
        .set(auth(staff.token))
        .send(body({ warehouseId: otherWarehouse.id }));

      expect(res.status).toBe(403);
    });

    it('requires the delivery.create permission', async () => {
      const res = await request(app)
        .post('/api/v1/deliveries')
        .set(auth(unprivileged.token))
        .send(body());

      expect(res.status).toBe(403);
    });
  });

  // -------------------------------------------------------------------------

  describe('lifecycle', () => {
    it('DRAFT -> WAITING via the status endpoint', async () => {
      const delivery = await createDelivery(manager.token);

      const res = await request(app)
        .patch(`/api/v1/deliveries/${delivery.id}/status`)
        .set(auth(manager.token))
        .send({ state: 'WAITING' });

      expect(res.status).toBe(200);
      expect(res.body.data.state).toBe(DOC_STATES.WAITING);
    });

    it('refuses to let a caller set READY directly — picking is the only route there', async () => {
      const delivery = await createDelivery(manager.token);

      const res = await request(app)
        .patch(`/api/v1/deliveries/${delivery.id}/status`)
        .set(auth(manager.token))
        .send({ state: 'READY' });

      expect(res.status).toBe(400);
      expect((await prisma.delivery.findUnique({ where: { id: delivery.id } })).state).toBe(
        DOC_STATES.DRAFT,
      );
    });

    it('edits only while DRAFT, and never after a pick', async () => {
      const delivery = await createDelivery(manager.token);
      await stock(product.id, loc.store.id, '100.0000');

      const edited = await request(app)
        .put(`/api/v1/deliveries/${delivery.id}`)
        .set(auth(manager.token))
        .send(
          body({
            lines: [
              { productId: product.id, quantity: '7.0000', sourceLocationId: loc.store.id },
            ],
          }),
        );
      expect(edited.status).toBe(200);
      expect(edited.body.data.lines[0].quantity.toString()).toBe('7');

      await request(app)
        .patch(`/api/v1/deliveries/${delivery.id}/status`)
        .set(auth(manager.token))
        .send({ state: 'WAITING' });
      expect((await pick(manager.token, delivery.id)).status).toBe(200);

      // Frozen: the quantities now describe a live claim on real stock.
      const after = await request(app)
        .put(`/api/v1/deliveries/${delivery.id}`)
        .set(auth(manager.token))
        .send(
          body({
            lines: [
              { productId: product.id, quantity: '1.0000', sourceLocationId: loc.store.id },
            ],
          }),
        );
      expect(after.status).toBe(400);
      expect(after.body.message).toMatch(/only draft/i);
    });
  });

  // -------------------------------------------------------------------------

  describe('picking', () => {
    it('reserves the quantity and moves the document to READY', async () => {
      await stock(product2.id, loc.store.id, '100.0000', '0.0000');
      const delivery = await createDelivery(manager.token, {
        lines: [{ productId: product2.id, quantity: '40.0000', sourceLocationId: loc.store.id }],
      });
      await request(app)
        .patch(`/api/v1/deliveries/${delivery.id}/status`)
        .set(auth(manager.token))
        .send({ state: 'WAITING' });

      const res = await pick(manager.token, delivery.id);

      expect(res.status).toBe(200);
      expect(res.body.data.state).toBe(DOC_STATES.READY);

      const quant = await quantOf(product2.id, loc.store.id);
      expect(quant.onHand.toString()).toBe('100');
      expect(quant.reservedQuantity.toString()).toBe('40');
    });

    it('picks straight from DRAFT without a WAITING step', async () => {
      await stock(product2.id, loc.production.id, '50.0000', '0.0000');
      const delivery = await createDelivery(manager.token, {
        lines: [
          { productId: product2.id, quantity: '10.0000', sourceLocationId: loc.production.id },
        ],
      });

      const res = await pick(manager.token, delivery.id);

      expect(res.status).toBe(200);
      expect(res.body.data.state).toBe(DOC_STATES.READY);
    });

    it('refuses when free-to-use stock is short, and leaves no partial reservation', async () => {
      await stock(product2.id, loc.scrap.id, '10.0000', '0.0000');
      const delivery = await createDelivery(manager.token, {
        lines: [{ productId: product2.id, quantity: '25.0000', sourceLocationId: loc.scrap.id }],
      });

      const res = await pick(manager.token, delivery.id);

      expect(res.status).toBe(422);
      expect(res.body.code).toBe('INSUFFICIENT_STOCK');
      const quant = await quantOf(product2.id, loc.scrap.id);
      expect(quant.reservedQuantity.toString()).toBe('0');
      expect((await prisma.delivery.findUnique({ where: { id: delivery.id } })).state).toBe(
        DOC_STATES.DRAFT,
      );
    });

    it('is refused twice rather than reserving twice', async () => {
      await stock(product3.id, loc.store.id, '60.0000', '0.0000');
      const delivery = await createDelivery(manager.token, {
        lines: [{ productId: product3.id, quantity: '20.0000', sourceLocationId: loc.store.id }],
      });

      expect((await pick(manager.token, delivery.id)).status).toBe(200);
      const res = await pick(manager.token, delivery.id);

      expect(res.status).toBe(409);
      expect(res.body.code).toBe('DELIVERY_ALREADY_PICKED');
      expect((await quantOf(product3.id, loc.store.id)).reservedQuantity.toString()).toBe('20');
    });

    it('sums duplicate product/location lines so the claim matches the total', async () => {
      await stock(product3.id, loc.production.id, '50.0000', '0.0000');
      const delivery = await createDelivery(manager.token, {
        lines: [
          { productId: product3.id, quantity: '10.0000', sourceLocationId: loc.production.id },
          { productId: product3.id, quantity: '15.0000', sourceLocationId: loc.production.id },
        ],
      });

      expect((await pick(manager.token, delivery.id)).status).toBe(200);
      expect((await quantOf(product3.id, loc.production.id)).reservedQuantity.toString()).toBe('25');
    });

    it('lets a second delivery take the remainder, then stops at zero free-to-use', async () => {
      await stock(product2.id, loc.store.id, '50.0000', '0.0000');
      const first = await createDelivery(manager.token, {
        lines: [{ productId: product2.id, quantity: '30.0000', sourceLocationId: loc.store.id }],
      });
      const second = await createDelivery(manager.token, {
        lines: [{ productId: product2.id, quantity: '20.0000', sourceLocationId: loc.store.id }],
      });
      const third = await createDelivery(manager.token, {
        lines: [{ productId: product2.id, quantity: '1.0000', sourceLocationId: loc.store.id }],
      });

      expect((await pick(manager.token, first.id)).status).toBe(200);
      expect((await pick(manager.token, second.id)).status).toBe(200);

      // Nothing left unclaimed, even though on-hand is still 50.
      const res = await pick(manager.token, third.id);
      expect(res.status).toBe(422);
      expect(res.body.message).toMatch(/available 0/);
    });

    it('requires the delivery.pick permission', async () => {
      const delivery = await createDelivery(manager.token);

      const res = await pick(unprivileged.token, delivery.id);

      expect(res.status).toBe(403);
    });
  });

  // -------------------------------------------------------------------------

  describe('validation', () => {
    it('posts the movement, consumes the reservation and finishes as DONE', async () => {
      await stock(product3.id, loc.store.id, '80.0000', '0.0000');
      const delivery = await createDelivery(manager.token, {
        lines: [{ productId: product3.id, quantity: '30.0000', sourceLocationId: loc.store.id }],
      });
      await pick(manager.token, delivery.id);

      const res = await validate(manager.token, delivery.id);

      expect(res.status).toBe(200);
      expect(res.body.data.state).toBe(DOC_STATES.DONE);

      const quant = await quantOf(product3.id, loc.store.id);
      // Reserved stock is *not* free-to-use, so the shipping case is the one
      // that would break on a naive availability check.
      expect(quant.onHand.toString()).toBe('50');
      expect(quant.reservedQuantity.toString()).toBe('0');

      const move = await prisma.stockMove.findFirst({
        where: { documentType: 'DELIVERY', documentId: delivery.id },
      });
      expect(move.fromLocationId).toBe(loc.store.id);
      expect(move.toLocationId).toBe(loc.customer.id);
      expect(move.quantity.toString()).toBe('30');
      expect(move.state).toBe(DOC_STATES.DONE);
    });

    it('is refused before a pick, so unreserved stock is never shipped', async () => {
      await stock(product3.id, loc.production.id, '50.0000', '0.0000');
      const delivery = await createDelivery(manager.token, {
        lines: [
          { productId: product3.id, quantity: '5.0000', sourceLocationId: loc.production.id },
        ],
      });

      const res = await validate(manager.token, delivery.id);

      expect(res.status).toBe(409);
      expect(res.body.code).toBe('DELIVERY_NOT_PICKED');
      expect((await quantOf(product3.id, loc.production.id)).onHand.toString()).toBe('50');
    });

    it('requires an Idempotency-Key', async () => {
      await stock(product3.id, loc.store.id, '20.0000', '0.0000');
      const delivery = await createDelivery(manager.token, {
        lines: [{ productId: product3.id, quantity: '5.0000', sourceLocationId: loc.store.id }],
      });
      await pick(manager.token, delivery.id);

      const res = await request(app)
        .post(`/api/v1/deliveries/${delivery.id}/validate`)
        .set(auth(manager.token));

      expect(res.status).toBe(400);
      // Rejected before anything was posted.
      expect((await quantOf(product3.id, loc.store.id)).onHand.toString()).toBe('20');
    });

    it('replays a repeated key instead of consuming stock twice', async () => {
      await stock(product3.id, loc.store.id, '40.0000', '0.0000');
      const delivery = await createDelivery(manager.token, {
        lines: [{ productId: product3.id, quantity: '10.0000', sourceLocationId: loc.store.id }],
      });
      await pick(manager.token, delivery.id);

      const key = unique('key');
      const first = await validate(manager.token, delivery.id, key);
      const second = await validate(manager.token, delivery.id, key);

      expect(first.status).toBe(200);
      expect(second.status).toBe(200);
      expect(second.headers['idempotent-replay']).toBe('true');
      expect(second.body.data).toEqual(first.body.data);
      expect((await quantOf(product3.id, loc.store.id)).onHand.toString()).toBe('30');
    });

    it('cannot be validated twice, even with a fresh key', async () => {
      await stock(product2.id, loc.scrap.id, '30.0000', '0.0000');
      const delivery = await createDelivery(manager.token, {
        lines: [{ productId: product2.id, quantity: '10.0000', sourceLocationId: loc.scrap.id }],
      });
      await pick(manager.token, delivery.id);

      expect((await validate(manager.token, delivery.id)).status).toBe(200);
      const second = await validate(manager.token, delivery.id);

      expect(second.status).toBe(409);
      expect(second.body.code).toBe('DOCUMENT_ALREADY_VALIDATED');
      expect((await quantOf(product2.id, loc.scrap.id)).onHand.toString()).toBe('20');
    });

    it('writes one ledger row per line, in lock order', async () => {
      await stock(product.id, loc.store.id, '30.0000', '0.0000');
      await stock(product2.id, loc.store.id, '30.0000', '0.0000');
      const delivery = await createDelivery(manager.token, {
        lines: [
          { productId: product2.id, quantity: '4.0000', sourceLocationId: loc.store.id },
          { productId: product.id, quantity: '6.0000', sourceLocationId: loc.store.id },
        ],
      });
      await pick(manager.token, delivery.id);

      expect((await validate(manager.token, delivery.id)).status).toBe(200);

      const moves = await prisma.stockMove.findMany({
        where: { documentType: 'DELIVERY', documentId: delivery.id },
        orderBy: { createdAt: 'asc' },
      });
      expect(moves).toHaveLength(2);
      const ids = moves.map((m) => m.productId);
      expect(ids).toEqual([...ids].sort());
      expect((await quantOf(product.id, loc.store.id)).onHand.toString()).toBe('24');
      expect((await quantOf(product2.id, loc.store.id)).onHand.toString()).toBe('26');
    });

    it('denies the validate permission to warehouse staff, who may only pick', async () => {
      await stock(product2.id, loc.store.id, '20.0000', '0.0000');
      const delivery = await createDelivery(manager.token, {
        lines: [{ productId: product2.id, quantity: '5.0000', sourceLocationId: loc.store.id }],
      });
      await pick(manager.token, delivery.id);

      const res = await validate(staff.token, delivery.id);

      expect(res.status).toBe(403);
    });
  });

  // -------------------------------------------------------------------------

  describe('cancellation', () => {
    it('returns a picked delivery’s reservation to free stock', async () => {
      await stock(product3.id, loc.store.id, '100.0000', '0.0000');
      const delivery = await createDelivery(manager.token, {
        lines: [{ productId: product3.id, quantity: '45.0000', sourceLocationId: loc.store.id }],
      });
      await pick(manager.token, delivery.id);

      const res = await request(app)
        .post(`/api/v1/deliveries/${delivery.id}/cancel`)
        .set(auth(manager.token));

      expect(res.status).toBe(200);
      expect(res.body.data.state).toBe(DOC_STATES.CANCELLED);

      const quant = await quantOf(product3.id, loc.store.id);
      expect(quant.onHand.toString()).toBe('100');
      expect(quant.reservedQuantity.toString()).toBe('0');
    });

    it('frees the units for another delivery', async () => {
      await stock(product2.id, loc.production.id, '20.0000', '0.0000');
      const first = await createDelivery(manager.token, {
        lines: [
          { productId: product2.id, quantity: '20.0000', sourceLocationId: loc.production.id },
        ],
      });
      const second = await createDelivery(manager.token, {
        lines: [
          { productId: product2.id, quantity: '20.0000', sourceLocationId: loc.production.id },
        ],
      });

      expect((await pick(manager.token, first.id)).status).toBe(200);
      expect((await pick(manager.token, second.id)).status).toBe(422);

      await request(app).post(`/api/v1/deliveries/${first.id}/cancel`).set(auth(manager.token));
      expect((await pick(manager.token, second.id)).status).toBe(200);
    });

    it('cannot be validated after cancellation', async () => {
      await stock(product.id, loc.store.id, '50.0000', '0.0000');
      const delivery = await createDelivery(manager.token, {
        lines: [{ productId: product.id, quantity: '5.0000', sourceLocationId: loc.store.id }],
      });
      await pick(manager.token, delivery.id);
      await request(app)
        .post(`/api/v1/deliveries/${delivery.id}/cancel`)
        .set(auth(manager.token));

      const res = await validate(manager.token, delivery.id);

      expect(res.status).toBe(409);
      expect((await quantOf(product.id, loc.store.id)).onHand.toString()).toBe('50');
    });

    it('refuses to cancel a DONE delivery, which has already shipped', async () => {
      await stock(product2.id, loc.store.id, '20.0000', '0.0000');
      const delivery = await createDelivery(manager.token, {
        lines: [{ productId: product2.id, quantity: '5.0000', sourceLocationId: loc.store.id }],
      });
      await pick(manager.token, delivery.id);
      await validate(manager.token, delivery.id);

      const res = await request(app)
        .post(`/api/v1/deliveries/${delivery.id}/cancel`)
        .set(auth(manager.token));

      expect(res.status).toBe(409);
      expect(res.body.code).toBe('DOCUMENT_ALREADY_FINAL');
    });
  });

  // -------------------------------------------------------------------------

  describe('availability', () => {
    it('reports free-to-use per line and whether the delivery can be picked', async () => {
      await stock(product3.id, loc.store.id, '12.0000', '4.0000');
      const delivery = await createDelivery(manager.token, {
        lines: [{ productId: product3.id, quantity: '8.0000', sourceLocationId: loc.store.id }],
      });

      const res = await request(app)
        .get(`/api/v1/deliveries/${delivery.id}/availability`)
        .set(auth(manager.token));

      expect(res.status).toBe(200);
      expect(res.body.data.canPick).toBe(true);
      expect(res.body.data.isPicked).toBe(false);
      expect(res.body.data.lines[0].onHand.toString()).toBe('12');
      expect(res.body.data.lines[0].reservedQuantity.toString()).toBe('4');
      expect(res.body.data.lines[0].freeToUse.toString()).toBe('8');
    });

    it('reports a short line as unpickable', async () => {
      await stock(product2.id, loc.store.id, '5.0000', '0.0000');
      const delivery = await createDelivery(manager.token, {
        lines: [{ productId: product2.id, quantity: '9.0000', sourceLocationId: loc.store.id }],
      });

      const res = await request(app)
        .get(`/api/v1/deliveries/${delivery.id}/availability`)
        .set(auth(manager.token));

      expect(res.body.data.canPick).toBe(false);
      expect(res.body.data.lines[0].isAvailable).toBe(false);
    });

    it('counts a picked delivery’s own claim, so a READY line still reads as available', async () => {
      await stock(product3.id, loc.store.id, '12.0000', '0.0000');
      const delivery = await createDelivery(manager.token, {
        lines: [{ productId: product3.id, quantity: '12.0000', sourceLocationId: loc.store.id }],
      });
      await pick(manager.token, delivery.id);

      const res = await request(app)
        .get(`/api/v1/deliveries/${delivery.id}/availability`)
        .set(auth(manager.token));

      // Nothing is free-to-use left, yet the delivery is already picked and must
      // not report itself as broken.
      expect(res.body.data.isPicked).toBe(true);
      expect(res.body.data.canPick).toBe(true);
    });
  });

  // -------------------------------------------------------------------------

  describe('listing, reading and isolation', () => {
    it('lists deliveries newest first with pagination metadata', async () => {
      const res = await request(app)
        .get('/api/v1/deliveries')
        .set(auth(manager.token))
        .query({ page: 1, pageSize: 5 });

      expect(res.status).toBe(200);
      expect(res.body.data).toHaveProperty('items');
      expect(res.body.data.pagination).toMatchObject({ page: 1, pageSize: 5 });
      expect(res.body.data.pagination.total).toBeGreaterThanOrEqual(
        res.body.data.items.length,
      );
      expect(res.body.data.items.length).toBeLessThanOrEqual(5);
      // Newest first.
      const times = res.body.data.items.map((d) => new Date(d.createdAt).getTime());
      expect(times).toEqual([...times].sort((a, b) => b - a));
    });

    it('filters by state', async () => {
      const res = await request(app)
        .get('/api/v1/deliveries')
        .set(auth(manager.token))
        .query({ state: 'DONE' });

      expect(res.status).toBe(200);
      expect(res.body.data.items.every((d) => d.state === 'DONE')).toBe(true);
    });

    it('finds a delivery by reference', async () => {
      const delivery = await createDelivery(manager.token);
      const res = await request(app)
        .get('/api/v1/deliveries')
        .set(auth(manager.token))
        .query({ search: delivery.reference });

      expect(res.body.data.items.some((d) => d.id === delivery.id)).toBe(true);
    });

    it('excludes another warehouse’s deliveries from a warehouse-scoped list', async () => {
      const elsewhere = await createInOtherWarehouse();
      const res = await request(app).get('/api/v1/deliveries').set(auth(staff.token));

      expect(res.status).toBe(200);
      expect(res.body.data.items.some((d) => d.id === elsewhere.id)).toBe(false);
    });

    it('shows a system-wide role every warehouse', async () => {
      const elsewhere = await createInOtherWarehouse();
      const res = await request(app).get('/api/v1/deliveries').set(auth(manager.token));

      // An INVENTORY_MANAGER is not warehouse-scoped, so the list is not pinned
      // to the one warehouse they happen to be assigned to.
      expect(res.body.data.items.some((d) => d.id === elsewhere.id)).toBe(true);
    });

    it('403s when reading a delivery in an unassigned warehouse', async () => {
      const other = await createInOtherWarehouse();
      const res = await request(app)
        .get(`/api/v1/deliveries/${other.id}`)
        .set(auth(staff.token));

      expect(res.status).toBe(403);
    });

    it('lets an admin read any delivery', async () => {
      const other = await createInOtherWarehouse();
      const res = await request(app)
        .get(`/api/v1/deliveries/${other.id}`)
        .set(auth(admin.token));

      expect(res.status).toBe(200);
    });

    it('404s an unknown id and 400s a malformed one', async () => {
      const missing = await request(app)
        .get('/api/v1/deliveries/00000000-0000-4000-8000-000000000000')
        .set(auth(manager.token));
      const malformed = await request(app)
        .get('/api/v1/deliveries/not-a-uuid')
        .set(auth(manager.token));

      expect(missing.status).toBe(404);
      expect(malformed.status).toBe(400);
    });

    it('requires authentication', async () => {
      const res = await request(app).get('/api/v1/deliveries');
      expect(res.status).toBe(401);
    });
  });
});
