const request = require('supertest');
const app = require('../src/app');
const {
  prisma,
  createUserWithToken,
  createTrackedProduct,
  createTrackedWarehouseWithLocations,
  createTrackedPartner,
  trackFixture,
  unique,
  cleanupFixtures,
} = require('./helpers');
const { DOC_STATES } = require('../src/domain/documentState');
const { PARTNER_TYPES } = require('../src/domain/partner');

/**
 * The shared state spine. Every document type routes through `documentService`,
 * so these tests exercise the rules once, on receipts, and Delivery / Internal
 * Transfer / Adjustment inherit them.
 */
describe('document state spine', () => {
  let manager;
  let warehouse;
  let loc;
  let product;
  let partner;

  beforeAll(async () => {
    manager = await createUserWithToken('INVENTORY_MANAGER');
    product = await createTrackedProduct();
    partner = await createTrackedPartner();

    const wh = await createTrackedWarehouseWithLocations();
    warehouse = wh.warehouse;
    loc = wh.locations;

    await prisma.userWarehouseAccess.create({
      data: { userId: manager.user.id, warehouseId: warehouse.id },
    });
  });

  afterAll(async () => {
    await cleanupFixtures();
    await prisma.$disconnect();
  });

  const auth = (token) => ({ Authorization: `Bearer ${token}` });

  /** Receipts go through the API, so they are registered for cleanup by hand. */
  const createReceipt = async (quantity = '50') => {
    const res = await request(app)
      .post('/api/v1/receipts')
      .set(auth(manager.token))
      .send({
        partnerId: partner.id,
        warehouseId: warehouse.id,
        lines: [{ productId: product.id, quantity, destinationLocationId: loc.store.id }],
      });
    trackFixture('receipts', res.body.data);
    return res;
  };

  const validate = (id, key = unique('key')) =>
    request(app)
      .post(`/api/v1/receipts/${id}/validate`)
      .set(auth(manager.token))
      .set('Idempotency-Key', key)
      .send({});

  const setState = (id, state) =>
    request(app).patch(`/api/v1/receipts/${id}/status`).set(auth(manager.token)).send({ state });

  const cancel = (id) =>
    request(app).post(`/api/v1/receipts/${id}/cancel`).set(auth(manager.token)).send();

  const onHandAtStore = async () => {
    const quant = await prisma.stockQuant.findUnique({
      where: { productId_locationId: { productId: product.id, locationId: loc.store.id } },
    });
    return quant ? Number(quant.onHand) : 0;
  };

  describe('validation is reachable from every validatable state', () => {
    it('validates straight from DRAFT', async () => {
      const { body } = await createReceipt('10');
      const res = await validate(body.data.id);

      expect(res.status).toBe(200);
      expect(res.body.data.state).toBe(DOC_STATES.DONE);
    });

    it('validates from WAITING', async () => {
      const { body } = await createReceipt('10');
      await setState(body.data.id, 'WAITING');
      const res = await validate(body.data.id);

      expect(res.status).toBe(200);
      expect(res.body.data.state).toBe(DOC_STATES.DONE);
    });

    it('validates from READY', async () => {
      const { body } = await createReceipt('10');
      await setState(body.data.id, 'READY');
      const res = await validate(body.data.id);

      expect(res.status).toBe(200);
      expect(res.body.data.state).toBe(DOC_STATES.DONE);
    });
  });

  describe('terminal states are final', () => {
    it('refuses a second validation of a DONE document', async () => {
      const { body } = await createReceipt('10');
      await validate(body.data.id);

      const res = await validate(body.data.id);
      expect(res.status).toBe(409);
      expect(res.body.code).toBe('DOCUMENT_ALREADY_VALIDATED');
    });

    it('refuses any transition out of DONE', async () => {
      const { body } = await createReceipt('10');
      await validate(body.data.id);

      const res = await setState(body.data.id, 'WAITING');
      expect(res.status).toBe(409);
      expect(res.body.code).toBe('DOCUMENT_ALREADY_FINAL');
    });

    it('refuses to cancel a DONE document', async () => {
      const { body } = await createReceipt('10');
      await validate(body.data.id);

      const res = await cancel(body.data.id);
      expect(res.status).toBe(409);
    });

    it('refuses to validate a CANCELLED document', async () => {
      const { body } = await createReceipt('10');
      await cancel(body.data.id);

      const res = await validate(body.data.id);
      expect(res.status).toBe(409);
      expect(res.body.code).toBe('DOCUMENT_CANCELLED');
    });

    it('posts no stock when validation is refused', async () => {
      const { body } = await createReceipt('10');
      await cancel(body.data.id);
      const before = await onHandAtStore();

      await validate(body.data.id);

      expect(await onHandAtStore()).toBe(before);
    });
  });

  describe('illegal transitions', () => {
    it('refuses to skip backwards from READY to WAITING', async () => {
      const { body } = await createReceipt('10');
      await setState(body.data.id, 'READY');

      const res = await setState(body.data.id, 'WAITING');
      expect(res.status).toBe(409);
      expect(res.body.code).toBe('INVALID_STATE_TRANSITION');
    });

    it('rejects a state outside the allowed vocabulary', async () => {
      const { body } = await createReceipt('10');

      const res = await request(app)
        .patch(`/api/v1/receipts/${body.data.id}/status`)
        .set(auth(manager.token))
        .send({ state: 'SHIPPED' });
      expect(res.status).toBe(400);
      expect(res.body.code).toBe('VALIDATION_ERROR');
    });
  });

  describe('concurrent writes are serialised', () => {
    it('lets only one of two racing validations post stock', async () => {
      const { body } = await createReceipt('40');
      const before = await onHandAtStore();

      // Distinct keys, so idempotency does not mask the race: the state
      // compare-and-set is the only thing preventing a double posting.
      const [first, second] = await Promise.all([
        validate(body.data.id, unique('race-a')),
        validate(body.data.id, unique('race-b')),
      ]);

      const statuses = [first.status, second.status].sort();
      expect(statuses).toEqual([200, 409]);

      expect(await onHandAtStore()).toBe(before + 40);
      expect(await prisma.stockMove.count({ where: { documentId: body.data.id } })).toBe(1);
    });

    it('lets only one of two racing state changes win', async () => {
      const { body } = await createReceipt('10');

      const [first, second] = await Promise.all([
        setState(body.data.id, 'WAITING'),
        setState(body.data.id, 'WAITING'),
      ]);

      const statuses = [first.status, second.status].sort();
      expect(statuses).toEqual([200, 409]);

      const stored = await prisma.receipt.findUnique({ where: { id: body.data.id } });
      expect(stored.state).toBe(DOC_STATES.WAITING);
    });

    it('keeps the ledger consistent when a racing validation loses', async () => {
      const { body } = await createReceipt('25');
      const before = await onHandAtStore();

      const results = await Promise.all([
        validate(body.data.id, unique('race-c')),
        validate(body.data.id, unique('race-d')),
        validate(body.data.id, unique('race-e')),
      ]);

      expect(results.filter((r) => r.status === 200)).toHaveLength(1);
      expect(await onHandAtStore()).toBe(before + 25);
    });
  });

  describe('partner roles', () => {
    let customer;

    beforeAll(async () => {
      customer = await createTrackedPartner({ type: PARTNER_TYPES.CUSTOMER });
    });

    it('rejects a receipt from a customer-only partner', async () => {
      const res = await request(app)
        .post('/api/v1/receipts')
        .set(auth(manager.token))
        .send({
          partnerId: customer.id,
          warehouseId: warehouse.id,
          lines: [{ productId: product.id, quantity: '5', destinationLocationId: loc.store.id }],
        });

      expect(res.status).toBe(400);
      expect(res.body.code).toBe('INVALID_PARTNER_TYPE');
    });

    it('rejects a receipt edited to a customer-only partner', async () => {
      const { body } = await createReceipt('5');

      const res = await request(app)
        .put(`/api/v1/receipts/${body.data.id}`)
        .set(auth(manager.token))
        .send({
          partnerId: customer.id,
          warehouseId: warehouse.id,
          lines: [{ productId: product.id, quantity: '5', destinationLocationId: loc.store.id }],
        });

      expect(res.status).toBe(400);
      expect(res.body.code).toBe('INVALID_PARTNER_TYPE');
    });

    it('accepts a BOTH partner on a receipt', async () => {
      const both = await createTrackedPartner({ type: PARTNER_TYPES.BOTH });

      const res = await request(app)
        .post('/api/v1/receipts')
        .set(auth(manager.token))
        .send({
          partnerId: both.id,
          warehouseId: warehouse.id,
          lines: [{ productId: product.id, quantity: '5', destinationLocationId: loc.store.id }],
        });

      expect(res.status).toBe(201);
    });
  });
});
