const request = require('supertest');
const app = require('../src/app');
const {
  prisma,
  createUserWithToken,
  createTrackedPartner,
  createTrackedWarehouseWithLocations,
  createTrackedReceipt,
  trackFixture,
  unique,
  cleanupFixtures,
} = require('./helpers');
const { PARTNER_TYPES } = require('../src/domain/partner');

describe('partners', () => {
  let admin, staff;

  beforeAll(async () => {
    admin = await createUserWithToken('ADMIN');
    staff = await createUserWithToken('WAREHOUSE_STAFF');
  });

  afterAll(async () => {
    await cleanupFixtures();
    await prisma.$disconnect();
  });

  const auth = (token) => ({ Authorization: `Bearer ${token}` });

  const create = async (overrides = {}) => {
    const res = await request(app)
      .post('/api/v1/partners')
      .set(auth(admin.token))
      .send({
        name: unique('Supplier'),
        ...overrides,
      });
    // Registered by hand because the row is created through the API.
    trackFixture('partners', res.body.data);
    return res;
  };

  describe('creation', () => {
    it('defaults a new partner to BOTH so it can serve either document type', async () => {
      const res = await create();

      expect(res.status).toBe(201);
      expect(res.body.data.type).toBe(PARTNER_TYPES.BOTH);
      expect(res.body.data.isActive).toBe(true);
    });

    it('accepts an explicit type', async () => {
      const res = await create({ type: PARTNER_TYPES.SUPPLIER });
      expect(res.status).toBe(201);
      expect(res.body.data.type).toBe(PARTNER_TYPES.SUPPLIER);
    });

    it('rejects an unknown type', async () => {
      const res = await create({ type: 'DROPSHIPPER' });
      expect(res.status).toBe(400);
      expect(res.body.code).toBe('VALIDATION_ERROR');
    });

    it('rejects a blank name', async () => {
      const res = await create({ name: '   ' });
      expect(res.status).toBe(400);
    });

    it('rejects a duplicate name', async () => {
      const name = unique('Dupe');
      expect((await create({ name })).status).toBe(201);

      const res = await create({ name });
      expect(res.status).toBe(409);
      expect(res.body.code).toBe('DUPLICATE_RESOURCE');
    });

    it('requires master-data write permission', async () => {
      const res = await request(app)
        .post('/api/v1/partners')
        .set(auth(staff.token))
        .send({ name: unique('Nope') });
      expect(res.status).toBe(403);
    });
  });

  describe('listing', () => {
    let supplier, customer, inactive;

    beforeAll(async () => {
      supplier = await createTrackedPartner({
        name: unique('Listing-Supplier'),
        type: PARTNER_TYPES.SUPPLIER,
      });
      customer = await createTrackedPartner({
        name: unique('Listing-Customer'),
        type: PARTNER_TYPES.CUSTOMER,
      });
      inactive = await createTrackedPartner({ name: unique('Listing-Inactive'), isActive: false });
    });

    it('returns the paginated envelope', async () => {
      const res = await request(app)
        .get('/api/v1/partners?page=1&pageSize=5')
        .set(auth(admin.token));

      expect(res.status).toBe(200);
      expect(res.body.data.pagination).toMatchObject({ page: 1, pageSize: 5 });
      expect(res.body.data.items.length).toBeLessThanOrEqual(5);
    });

    it('filters by search substring', async () => {
      const res = await request(app)
        .get(`/api/v1/partners?search=${encodeURIComponent(supplier.name)}`)
        .set(auth(admin.token));

      expect(res.status).toBe(200);
      const ids = res.body.data.items.map((p) => p.id);
      expect(ids).toContain(supplier.id);
      expect(ids).not.toContain(customer.id);
    });

    it('filters by active state', async () => {
      const res = await request(app).get('/api/v1/partners?isActive=false').set(auth(admin.token));

      expect(res.status).toBe(200);
      const ids = res.body.data.items.map((p) => p.id);
      expect(ids).toContain(inactive.id);
      expect(ids).not.toContain(supplier.id);
    });

    it('rejects a non-boolean isActive filter', async () => {
      const res = await request(app).get('/api/v1/partners?isActive=maybe').set(auth(admin.token));
      expect(res.status).toBe(400);
    });
  });

  describe('options', () => {
    let supplier, customer, trading, inactive;

    beforeAll(async () => {
      supplier = await createTrackedPartner({
        name: unique('Opt-Supplier'),
        type: PARTNER_TYPES.SUPPLIER,
      });
      customer = await createTrackedPartner({
        name: unique('Opt-Customer'),
        type: PARTNER_TYPES.CUSTOMER,
      });
      trading = await createTrackedPartner({
        name: unique('Opt-Trading'),
        type: PARTNER_TYPES.BOTH,
      });
      inactive = await createTrackedPartner({
        name: unique('Opt-Inactive'),
        type: PARTNER_TYPES.SUPPLIER,
        isActive: false,
      });
    });

    it('returns a bare array for pickers, not the paginated envelope', async () => {
      const res = await request(app).get('/api/v1/partners/options').set(auth(admin.token));

      expect(res.status).toBe(200);
      expect(Array.isArray(res.body.data)).toBe(true);
      expect(res.body.data[0]).toEqual(
        expect.objectContaining({
          id: expect.any(String),
          name: expect.any(String),
          type: expect.any(String),
        }),
      );
    });

    it('excludes inactive partners', async () => {
      const res = await request(app).get('/api/v1/partners/options').set(auth(admin.token));
      const ids = res.body.data.map((p) => p.id);

      expect(ids).not.toContain(inactive.id);
      expect(ids).toContain(supplier.id);
    });

    it('widens a supplier filter to include BOTH partners', async () => {
      const res = await request(app)
        .get(`/api/v1/partners/options?type=${PARTNER_TYPES.SUPPLIER}`)
        .set(auth(admin.token));
      const ids = res.body.data.map((p) => p.id);

      expect(ids).toContain(supplier.id);
      expect(ids).toContain(trading.id);
      expect(ids).not.toContain(customer.id);
    });

    it('widens a customer filter to include BOTH partners', async () => {
      const res = await request(app)
        .get(`/api/v1/partners/options?type=${PARTNER_TYPES.CUSTOMER}`)
        .set(auth(admin.token));
      const ids = res.body.data.map((p) => p.id);

      expect(ids).toContain(customer.id);
      expect(ids).toContain(trading.id);
      expect(ids).not.toContain(supplier.id);
    });

    it('rejects an unknown type filter', async () => {
      const res = await request(app)
        .get('/api/v1/partners/options?type=NOBODY')
        .set(auth(admin.token));
      expect(res.status).toBe(400);
    });

    it('requires authentication', async () => {
      const res = await request(app).get('/api/v1/partners/options');
      expect(res.status).toBe(401);
    });
  });

  describe('retrieval, update and removal', () => {
    let partner;

    beforeEach(async () => {
      partner = await createTrackedPartner({
        name: unique('Editable'),
        type: PARTNER_TYPES.SUPPLIER,
      });
    });

    it('returns a single partner with its receipt count', async () => {
      const res = await request(app).get(`/api/v1/partners/${partner.id}`).set(auth(admin.token));

      expect(res.status).toBe(200);
      expect(res.body.data.id).toBe(partner.id);
      expect(res.body.data._count.receipts).toBe(0);
    });

    it('404s for an unknown or malformed id', async () => {
      expect(
        (
          await request(app)
            .get(`/api/v1/partners/${unique('nope')}`)
            .set(auth(admin.token))
        ).status,
      ).toBe(400);
      expect(
        (
          await request(app)
            .get('/api/v1/partners/00000000-0000-0000-0000-000000000000')
            .set(auth(admin.token))
        ).status,
      ).toBe(404);
    });

    it('updates name, type and active state', async () => {
      const res = await request(app)
        .patch(`/api/v1/partners/${partner.id}`)
        .set(auth(admin.token))
        .send({ type: PARTNER_TYPES.CUSTOMER, isActive: false });

      expect(res.status).toBe(200);
      expect(res.body.data.type).toBe(PARTNER_TYPES.CUSTOMER);
      expect(res.body.data.isActive).toBe(false);
    });

    it('rejects an invalid type on update', async () => {
      const res = await request(app)
        .patch(`/api/v1/partners/${partner.id}`)
        .set(auth(admin.token))
        .send({ type: 'SUPPLIER_CUSTOMER' });
      expect(res.status).toBe(400);
    });

    it('deletes an unreferenced partner', async () => {
      const res = await request(app)
        .delete(`/api/v1/partners/${partner.id}`)
        .set(auth(admin.token));

      expect(res.status).toBe(200);
      expect(await prisma.partner.findUnique({ where: { id: partner.id } })).toBeNull();
    });

    it('refuses to delete a partner referenced by a receipt', async () => {
      await createTrackedReceipt({
        reference: unique('RCP'),
        partnerId: partner.id,
        warehouseId: (
          await createTrackedWarehouseWithLocations({
            name: unique('RefWH'),
            shortCode: unique('REF').toUpperCase(),
          })
        ).warehouse.id,
      });

      const res = await request(app)
        .delete(`/api/v1/partners/${partner.id}`)
        .set(auth(admin.token));

      expect(res.status).toBe(409);
      expect(res.body.code).toBe('PARTNER_IN_USE');
      expect(await prisma.partner.findUnique({ where: { id: partner.id } })).not.toBeNull();
    });

    it('requires write permission to update or delete', async () => {
      const patch = await request(app)
        .patch(`/api/v1/partners/${partner.id}`)
        .set(auth(staff.token))
        .send({ name: unique('Hacked') });
      const del = await request(app)
        .delete(`/api/v1/partners/${partner.id}`)
        .set(auth(staff.token));

      expect(patch.status).toBe(403);
      expect(del.status).toBe(403);
    });
  });
});
