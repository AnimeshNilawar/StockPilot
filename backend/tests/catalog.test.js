const request = require('supertest');
const app = require('../src/app');
const { prisma, createUserWithToken, createProduct, auth, unique } = require('./helpers');

describe('Phase 2 — Catalog API (categories, UOM, products)', () => {
  let manager;
  let staff;
  let uomId;

  beforeAll(async () => {
    manager = await createUserWithToken('INVENTORY_MANAGER');
    staff = await createUserWithToken('WAREHOUSE_STAFF');

    // Created here rather than looked up in the seed: the suite must not depend
    // on master data that a particular database happens to contain, or it passes
    // on one machine and fails on a freshly migrated one.
    const uom = await prisma.uom.create({
      data: { code: unique('UOM').toUpperCase().replace(/-/g, '').slice(0, 10), name: 'Test UOM' },
    });
    uomId = uom.id;
  });

  afterAll(async () => {
    await prisma.user.deleteMany({ where: { id: { in: [manager.user.id, staff.user.id] } } });
    // Products created through the API hold a reference to this UOM, so they
    // have to go first or the delete is refused.
    await prisma.product.deleteMany({ where: { uomId } });
    await prisma.uom.deleteMany({ where: { id: uomId } });
    await prisma.$disconnect();
  });

  // -------------------------------------------------------------------------
  describe('Units of measure', () => {
    it('creates a UOM and normalises the code to upper case', async () => {
      const res = await request(app)
        .post('/api/v1/uoms')
        .set(auth(manager.token))
        .send({ name: 'Metric Tonne', code: 'tonne' });

      expect(res.status).toBe(201);
      expect(res.body.data.code).toBe('TONNE');

      await prisma.uom.delete({ where: { id: res.body.data.id } });
    });

    it('rejects a duplicate UOM code', async () => {
      const res = await request(app)
        .post('/api/v1/uoms')
        .set(auth(manager.token))
        .send({ name: 'Duplicate KG', code: 'KG' });

      expect(res.status).toBe(409);
      expect(res.body.code).toBe('DUPLICATE_RESOURCE');
    });

    it('rejects a code with illegal characters', async () => {
      const res = await request(app)
        .post('/api/v1/uoms')
        .set(auth(manager.token))
        .send({ name: 'Bad', code: 'kg/2' });

      expect(res.status).toBe(400);
      expect(res.body.code).toBe('VALIDATION_ERROR');
    });

    it('refuses to delete a UOM that products reference', async () => {
      // The referencing product is created here, so the assertion does not
      // depend on a product that some other test (or the seed) happens to have
      // left pointing at this UOM. Written directly rather than via
      // `createProduct`, which always derives the UOM from a code.
      const category = await prisma.category.create({ data: { name: unique('Category') } });
      const product = await prisma.product.create({
        data: {
          sku: unique('SKU').toUpperCase().replace(/-/g, ''),
          name: 'UOM holder',
          uomId,
          categoryId: category.id,
          costPrice: '1.00',
          reorderMin: '0',
          reorderMax: '10',
        },
      });

      const res = await request(app).delete(`/api/v1/uoms/${uomId}`).set(auth(manager.token));

      expect(res.status).toBe(400);
      expect(res.body.code).toBe('UOM_IN_USE');
      expect((await prisma.uom.findUnique({ where: { id: uomId } })).id).toBe(uomId);
      expect((await prisma.product.findUnique({ where: { id: product.id } })).id).toBe(product.id);
    });

    it('blocks WAREHOUSE_STAFF from writing master data', async () => {
      const res = await request(app)
        .post('/api/v1/uoms')
        .set(auth(staff.token))
        .send({ name: 'Staff Unit', code: 'STAFFU' });

      expect(res.status).toBe(403);
      expect(res.body.code).toBe('FORBIDDEN');
    });
  });

  // -------------------------------------------------------------------------
  describe('Categories', () => {
    let rootId;
    let childId;

    it('creates a hierarchical category tree', async () => {
      const root = await request(app)
        .post('/api/v1/categories')
        .set(auth(manager.token))
        .send({ name: unique('Electronics') });
      expect(root.status).toBe(201);
      rootId = root.body.data.id;

      const child = await request(app)
        .post('/api/v1/categories')
        .set(auth(manager.token))
        .send({ name: unique('Components'), parentId: rootId });
      expect(child.status).toBe(201);
      childId = child.body.data.id;
    });

    it('returns the category tree', async () => {
      const res = await request(app).get('/api/v1/categories/tree').set(auth(staff.token));

      expect(res.status).toBe(200);
      const branch = res.body.data.find((node) => node.id === rootId);
      expect(branch).toBeDefined();
      expect(branch.children.map((node) => node.id)).toContain(childId);
    });

    it('rejects a duplicate category name', async () => {
      const res = await request(app)
        .post('/api/v1/categories')
        .set(auth(manager.token))
        .send({ name: 'Electronics' });

      expect(res.status).toBe(409);
    });

    it('rejects an unknown parent', async () => {
      const res = await request(app)
        .post('/api/v1/categories')
        .set(auth(manager.token))
        .send({ name: unique('Orphan'), parentId: '00000000-0000-4000-8000-000000000000' });

      expect(res.status).toBe(400);
      expect(res.body.code).toBe('CATEGORY_NOT_FOUND');
    });

    it('rejects a cycle (parenting a category under its own child)', async () => {
      const res = await request(app)
        .patch(`/api/v1/categories/${rootId}`)
        .set(auth(manager.token))
        .send({ parentId: childId });

      expect(res.status).toBe(400);
      expect(res.body.code).toBe('CATEGORY_CYCLE');
    });

    it('refuses to delete a category that has children', async () => {
      const res = await request(app)
        .delete(`/api/v1/categories/${rootId}`)
        .set(auth(manager.token));

      expect(res.status).toBe(400);
      expect(res.body.code).toBe('CATEGORY_HAS_CHILDREN');
    });

    it('allows every authenticated role to read categories', async () => {
      const res = await request(app).get('/api/v1/categories').set(auth(staff.token));
      expect(res.status).toBe(200);
    });
  });

  // -------------------------------------------------------------------------
  describe('Products', () => {
    let productId;
    let productSku;
    let categoryId;
    let warehouseId;

    beforeAll(async () => {
      const category = await prisma.category.create({ data: { name: unique('Fasteners') } });
      categoryId = category.id;

      const warehouse = await prisma.warehouse.create({
        data: { name: unique('WH'), shortCode: unique('WHC').toUpperCase().replace(/-/g, '') },
      });
      warehouseId = warehouse.id;
    });

    it('requires a valid category and UOM', async () => {
      const missingUom = await request(app)
        .post('/api/v1/products')
        .set(auth(manager.token))
        .send({ sku: unique('SKU').toUpperCase(), name: 'No UOM' });
      expect(missingUom.status).toBe(400);
      expect(missingUom.body.code).toBe('VALIDATION_ERROR');

      const unknownUom = await request(app)
        .post('/api/v1/products')
        .set(auth(manager.token))
        .send({
          sku: unique('SKU').toUpperCase(),
          name: 'Bad UOM',
          uomId: '00000000-0000-4000-8000-000000000000',
        });
      expect(unknownUom.status).toBe(400);
      expect(unknownUom.body.code).toBe('UOM_NOT_FOUND');

      const unknownCategory = await request(app)
        .post('/api/v1/products')
        .set(auth(manager.token))
        .send({
          sku: unique('SKU').toUpperCase(),
          name: 'Bad Category',
          uomId,
          categoryId: '00000000-0000-4000-8000-000000000000',
        });
      expect(unknownCategory.status).toBe(400);
      expect(unknownCategory.body.code).toBe('CATEGORY_NOT_FOUND');
    });

    it('creates a product and stores quantities as NUMERIC decimals', async () => {
      productSku = unique('SKU').toUpperCase().replace(/-/g, '');
      const res = await request(app).post('/api/v1/products').set(auth(manager.token)).send({
        sku: productSku,
        name: 'Hex Bolt M8',
        description: 'Zinc plated',
        uomId,
        categoryId,
        costPrice: '12.34',
        reorderMin: '10.5',
        reorderMax: '500',
      });

      expect(res.status).toBe(201);
      productId = res.body.data.id;
      expect(res.body.data.costPrice).toBe('12.34'); // NUMERIC(14,2)
      expect(res.body.data.reorderMin).toBe('10.5');

      // The value round-trips through PostgreSQL NUMERIC at its declared scale,
      // which a JS float could not preserve (0.1 + 0.2 !== 0.3).
      const [raw] = await prisma.$queryRawUnsafe(
        'SELECT reorder_min::text AS "reorderMin" FROM products WHERE id = $1',
        productId,
      );
      expect(raw.reorderMin).toBe('10.5000');
    });

    it('enforces a unique SKU', async () => {
      const res = await request(app)
        .post('/api/v1/products')
        .set(auth(manager.token))
        .send({ sku: productSku, name: 'Duplicate SKU', uomId });

      expect(res.status).toBe(409);
      expect(res.body.code).toBe('DUPLICATE_RESOURCE');
      expect(res.body.message).toMatch(/Sku/i);
    });

    it('rejects a negative quantity field', async () => {
      const res = await request(app)
        .post('/api/v1/products')
        .set(auth(manager.token))
        .send({ sku: unique('SKU').toUpperCase(), name: 'Negative', uomId, reorderMin: '-1' });

      expect(res.status).toBe(400);
      expect(res.body.code).toBe('VALIDATION_ERROR');
    });

    it('rejects a non-numeric quantity', async () => {
      const res = await request(app)
        .post('/api/v1/products')
        .set(auth(manager.token))
        .send({ sku: unique('SKU').toUpperCase(), name: 'Text qty', uomId, reorderMin: 'ten' });

      expect(res.status).toBe(400);
      expect(res.body.code).toBe('VALIDATION_ERROR');
    });

    it('rejects reorderMax <= reorderMin', async () => {
      const res = await request(app)
        .patch(`/api/v1/products/${productId}`)
        .set(auth(manager.token))
        .send({ reorderMin: '80', reorderMax: '20' });

      expect(res.status).toBe(400);
      expect(res.body.code).toBe('INVALID_REORDER_RANGE');
    });

    it('finds products by partial SKU and partial name', async () => {
      const bySku = await request(app)
        .get(`/api/v1/products?search=${encodeURIComponent(productSku.slice(0, 6))}`)
        .set(auth(manager.token));
      expect(bySku.status).toBe(200);
      expect(bySku.body.data.items.map((item) => item.id)).toContain(productId);

      const byName = await request(app)
        .get('/api/v1/products?search=Hex%20Bol')
        .set(auth(manager.token));
      expect(byName.status).toBe(200);
      expect(byName.body.data.items.map((item) => item.id)).toContain(productId);
    });

    it('filters by category and paginates', async () => {
      const res = await request(app)
        .get(`/api/v1/products?categoryId=${categoryId}&page=1&pageSize=5`)
        .set(auth(manager.token));

      expect(res.status).toBe(200);
      expect(res.body.data.pagination).toEqual({ page: 1, pageSize: 5, total: 1, totalPages: 1 });
      expect(res.body.data.items.every((item) => item.categoryId === categoryId)).toBe(true);
    });

    it('returns 404 for an unknown product', async () => {
      const res = await request(app)
        .get('/api/v1/products/00000000-0000-4000-8000-000000000000')
        .set(auth(manager.token));

      expect(res.status).toBe(404);
      expect(res.body.code).toBe('NOT_FOUND');
    });

    it('rejects a malformed identifier before hitting the database', async () => {
      const res = await request(app).get('/api/v1/products/not-a-uuid').set(auth(manager.token));

      expect(res.status).toBe(400);
      expect(res.body.code).toBe('VALIDATION_ERROR');
    });

    it('restricts product writes to product.write holders', async () => {
      const res = await request(app)
        .post('/api/v1/products')
        .set(auth(staff.token))
        .send({ sku: unique('SKU').toUpperCase(), name: 'Staff product', uomId });

      expect(res.status).toBe(403);
      expect(res.body.code).toBe('FORBIDDEN');
    });

    it('lets staff read products', async () => {
      const res = await request(app).get('/api/v1/products').set(auth(staff.token));
      expect(res.status).toBe(200);
    });

    it('refuses to delete a product that holds stock', async () => {
      const location = await prisma.location.create({
        data: {
          warehouseId: warehouseId,
          name: unique('Bin'),
          shortCode: unique('BIN'),
          type: 'INTERNAL',
        },
      });
      await prisma.stockQuant.create({
        data: { productId, locationId: location.id, onHand: '5', reservedQuantity: '0' },
      });

      const res = await request(app)
        .delete(`/api/v1/products/${productId}`)
        .set(auth(manager.token));

      expect(res.status).toBe(400);
      expect(res.body.code).toBe('PRODUCT_IN_USE');

      await prisma.stockQuant.deleteMany({ where: { productId } });
      await prisma.location.delete({ where: { id: location.id } });
    });

    it('deletes an unused product', async () => {
      const throwaway = await createProduct();
      const res = await request(app)
        .delete(`/api/v1/products/${throwaway.id}`)
        .set(auth(manager.token));

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
    });
  });
});
