const { prisma } = require('../lib/prisma');
const { parsePagination, paginated } = require('../utils/query');
const { notFound, badRequest } = require('../utils/appError');
const auditService = require('../services/audit.service');

class UomController {
  async list(req, res) {
    const { page, pageSize, skip, take } = parsePagination(req.valid.query);
    const { search, isActive } = req.valid.query;

    const where = {
      ...(search
        ? {
            OR: [
              { name: { contains: search, mode: 'insensitive' } },
              { code: { contains: search, mode: 'insensitive' } },
            ],
          }
        : {}),
      ...(isActive !== undefined ? { isActive } : {}),
    };

    const [items, total] = await Promise.all([
      prisma.uom.findMany({ where, orderBy: { code: 'asc' }, skip, take }),
      prisma.uom.count({ where }),
    ]);

    res.status(200).json({ success: true, data: paginated(items, total, { page, pageSize }) });
  }

  /** Lightweight list for dropdowns: no pagination, active rows only. */
  async options(req, res) {
    const items = await prisma.uom.findMany({
      where: { isActive: true },
      orderBy: { code: 'asc' },
      select: { id: true, code: true, name: true },
    });
    res.status(200).json({ success: true, data: items });
  }

  async get(req, res) {
    const uom = await prisma.uom.findUnique({
      where: { id: req.valid.params.id },
      include: { _count: { select: { products: true } } },
    });
    if (!uom) throw notFound('Unit of measure not found');
    res.status(200).json({ success: true, data: uom });
  }

  async create(req, res) {
    const { name, code } = req.valid.body;
    const uom = await prisma.uom.create({ data: { name, code } });

    await auditService.log({
      userId: req.user.id,
      action: 'UOM_CREATED',
      entityType: 'Uom',
      entityId: uom.id,
      metadata: { name, code },
      ip: req.ip,
    });

    res.status(201).json({ success: true, data: uom });
  }

  async update(req, res) {
    const { id } = req.valid.params;
    const data = req.valid.body;

    const existing = await prisma.uom.findUnique({ where: { id } });
    if (!existing) throw notFound('Unit of measure not found');

    const uom = await prisma.uom.update({ where: { id }, data });

    await auditService.log({
      userId: req.user.id,
      action: 'UOM_UPDATED',
      entityType: 'Uom',
      entityId: id,
      metadata: data,
      ip: req.ip,
    });

    res.status(200).json({ success: true, data: uom });
  }

  async remove(req, res) {
    const { id } = req.valid.params;

    const productCount = await prisma.product.count({ where: { uomId: id } });
    if (productCount > 0) {
      throw badRequest(
        `Cannot delete a unit of measure used by ${productCount} product(s). Deactivate it instead.`,
        'UOM_IN_USE',
      );
    }

    const uom = await prisma.uom.findUnique({ where: { id } });
    if (!uom) throw notFound('Unit of measure not found');

    await prisma.uom.delete({ where: { id } });

    await auditService.log({
      userId: req.user.id,
      action: 'UOM_DELETED',
      entityType: 'Uom',
      entityId: id,
      metadata: { code: uom.code },
      ip: req.ip,
    });

    res.status(200).json({ success: true, message: 'Unit of measure deleted' });
  }
}

module.exports = new UomController();
