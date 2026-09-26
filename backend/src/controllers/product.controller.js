const { Prisma } = require('@prisma/client');
const { prisma } = require('../lib/prisma');
const { parsePagination, paginated } = require('../utils/query');
const { notFound, badRequest } = require('../utils/appError');
const auditService = require('../services/audit.service');

const NUMERIC_FIELDS = ['costPrice', 'reorderMin', 'reorderMax'];

/** Converts validated decimal strings into Prisma Decimal — never floats. */
const toNumeric = (data) => {
  const payload = { ...data };
  for (const field of NUMERIC_FIELDS) {
    if (payload[field] === undefined) continue;
    payload[field] = payload[field] === null ? null : new Prisma.Decimal(payload[field]);
  }
  return payload;
};

class ProductController {
  /**
   * Paginated product search. `search` is a partial (substring) match on SKU or
   * name, served by the `products_sku_trgm_idx` / `products_name_trgm_idx` GIN
   * trigram indexes created in the Phase 2 migration.
   */
  async list(req, res) {
    const { page, pageSize, skip, take } = parsePagination(req.valid.query);
    const { search, categoryId, uomId, isActive } = req.valid.query;

    const where = {
      ...(search
        ? {
            OR: [
              { sku: { contains: search, mode: 'insensitive' } },
              { name: { contains: search, mode: 'insensitive' } },
            ],
          }
        : {}),
      ...(categoryId ? { categoryId } : {}),
      ...(uomId ? { uomId } : {}),
      ...(isActive !== undefined ? { isActive } : {}),
    };

    const [items, total] = await Promise.all([
      prisma.product.findMany({
        where,
        orderBy: { sku: 'asc' },
        skip,
        take,
        include: {
          category: { select: { id: true, name: true } },
          uom: { select: { id: true, code: true, name: true } },
        },
      }),
      prisma.product.count({ where }),
    ]);

    res.status(200).json({ success: true, data: paginated(items, total, { page, pageSize }) });
  }

  async get(req, res) {
    const product = await prisma.product.findUnique({
      where: { id: req.valid.params.id },
      include: {
        category: true,
        uom: true,
        _count: { select: { quants: true, moves: true } },
      },
    });
    if (!product) throw notFound('Product not found');

    const totals = await prisma.stockQuant.aggregate({
      where: { productId: product.id },
      _sum: { onHand: true, reservedQuantity: true },
    });

    const onHand = totals._sum.onHand || new Prisma.Decimal(0);
    const reserved = totals._sum.reservedQuantity || new Prisma.Decimal(0);

    res.status(200).json({
      success: true,
      data: {
        ...product,
        stock: { onHand, reservedQuantity: reserved, freeToUse: onHand.minus(reserved) },
      },
    });
  }

  /** Per-location balance breakdown for one product. */
  async stock(req, res) {
    const { id } = req.valid.params;

    const product = await prisma.product.findUnique({
      where: { id },
      select: { id: true, sku: true, name: true },
    });
    if (!product) throw notFound('Product not found');

    const quants = await prisma.stockQuant.findMany({
      where: { productId: id, location: { isActive: true } },
      orderBy: { location: { shortCode: 'asc' } },
      include: {
        location: {
          select: {
            id: true,
            name: true,
            shortCode: true,
            type: true,
            warehouseId: true,
            warehouse: { select: { id: true, name: true } },
          },
        },
      },
    });

    res.status(200).json({
      success: true,
      data: quants.map((quant) => ({
        productId: quant.productId,
        locationId: quant.locationId,
        location: quant.location,
        onHand: quant.onHand,
        reservedQuantity: quant.reservedQuantity,
        freeToUse: new Prisma.Decimal(quant.onHand).minus(
          new Prisma.Decimal(quant.reservedQuantity),
        ),
      })),
    });
  }

  async create(req, res) {
    const data = toNumeric(req.valid.body);
    await this.assertReferencesExist(data);

    const product = await prisma.product.create({
      data,
      include: { category: true, uom: true },
    });

    await auditService.log({
      userId: req.user.id,
      action: 'PRODUCT_CREATED',
      entityType: 'Product',
      entityId: product.id,
      metadata: { sku: product.sku, name: product.name },
      ip: req.ip,
    });

    res.status(201).json({ success: true, data: product });
  }

  async update(req, res) {
    const { id } = req.valid.params;
    const data = toNumeric(req.valid.body);

    const existing = await prisma.product.findUnique({ where: { id } });
    if (!existing) throw notFound('Product not found');

    await this.assertReferencesExist(data);

    if (
      data.reorderMax !== undefined &&
      data.reorderMax !== null &&
      data.reorderMin !== undefined &&
      new Prisma.Decimal(data.reorderMax).lte(new Prisma.Decimal(data.reorderMin))
    ) {
      throw badRequest(
        'Reorder maximum must be greater than reorder minimum',
        'INVALID_REORDER_RANGE',
      );
    }

    const product = await prisma.product.update({
      where: { id },
      data,
      include: { category: true, uom: true },
    });

    await auditService.log({
      userId: req.user.id,
      action: 'PRODUCT_UPDATED',
      entityType: 'Product',
      entityId: id,
      metadata: Object.keys(data),
      ip: req.ip,
    });

    res.status(200).json({ success: true, data: product });
  }

  async remove(req, res) {
    const { id } = req.valid.params;

    const product = await prisma.product.findUnique({ where: { id } });
    if (!product) throw notFound('Product not found');

    const [moveCount, quantCount] = await Promise.all([
      prisma.stockMove.count({ where: { productId: id } }),
      prisma.stockQuant.count({ where: { productId: id, onHand: { not: new Prisma.Decimal(0) } } }),
    ]);

    if (moveCount > 0 || quantCount > 0) {
      throw badRequest(
        'Cannot delete a product that has stock movements or stock balances. Deactivate it instead.',
        'PRODUCT_IN_USE',
      );
    }

    await prisma.product.delete({ where: { id } });

    await auditService.log({
      userId: req.user.id,
      action: 'PRODUCT_DELETED',
      entityType: 'Product',
      entityId: id,
      metadata: { sku: product.sku },
      ip: req.ip,
    });

    res.status(200).json({ success: true, message: 'Product deleted' });
  }

  /** Products require a valid, active category and UOM. */
  async assertReferencesExist(data) {
    if (data.uomId) {
      const uom = await prisma.uom.findUnique({
        where: { id: data.uomId },
        select: { id: true, isActive: true },
      });
      if (!uom) throw badRequest('Unit of measure not found', 'UOM_NOT_FOUND');
      if (!uom.isActive) throw badRequest('Unit of measure is inactive', 'UOM_INACTIVE');
    }

    if (data.categoryId) {
      const category = await prisma.category.findUnique({
        where: { id: data.categoryId },
        select: { id: true, isActive: true },
      });
      if (!category) throw badRequest('Category not found', 'CATEGORY_NOT_FOUND');
      if (!category.isActive) throw badRequest('Category is inactive', 'CATEGORY_INACTIVE');
    }
  }
}

module.exports = new ProductController();
