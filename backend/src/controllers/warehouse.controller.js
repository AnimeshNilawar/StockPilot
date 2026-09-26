const { prisma } = require('../lib/prisma');
const { parsePagination, paginated } = require('../utils/query');
const { applyWarehouseScope, assertWarehouseAccess } = require('../middleware/access.middleware');
const { notFound, badRequest } = require('../utils/appError');
const auditService = require('../services/audit.service');

class WarehouseController {
  /**
   * Warehouses the caller may see: ADMIN sees all, every other role only sees
   * its assignments. Enforced server side — a hand-crafted `warehouseId` in a
   * query string cannot widen the result set.
   */
  async list(req, res) {
    const { page, pageSize, skip, take } = parsePagination(req.valid.query);
    const { search, isActive } = req.valid.query;

    const where = applyWarehouseScope(
      req.user,
      {
        ...(search ? { name: { contains: search, mode: 'insensitive' } } : {}),
        ...(isActive !== undefined ? { isActive } : {}),
      },
      { key: 'id' },
    );

    const [items, total] = await Promise.all([
      prisma.warehouse.findMany({
        where,
        orderBy: { name: 'asc' },
        skip,
        take,
        include: { _count: { select: { locations: true } } },
      }),
      prisma.warehouse.count({ where }),
    ]);

    res.status(200).json({ success: true, data: paginated(items, total, { page, pageSize }) });
  }

  /** Dropdown source: every warehouse the caller is allowed to operate in. */
  async options(req, res) {
    const where = applyWarehouseScope(req.user, { isActive: true }, { key: 'id' });
    const items = await prisma.warehouse.findMany({
      where,
      orderBy: { name: 'asc' },
      select: { id: true, name: true, shortCode: true },
    });
    res.status(200).json({ success: true, data: items });
  }

  async get(req, res) {
    const { id } = req.valid.params;
    this.assertReadable(req.user, id);

    const warehouse = await prisma.warehouse.findUnique({
      where: { id },
      include: {
        locations: {
          orderBy: { shortCode: 'asc' },
          include: { _count: { select: { quantsHere: true } } },
        },
        _count: { select: { userAccess: true } },
      },
    });
    if (!warehouse) throw notFound('Warehouse not found');

    res.status(200).json({ success: true, data: warehouse });
  }

  async create(req, res) {
    const { name, shortCode, address } = req.valid.body;

    const warehouse = await prisma.warehouse.create({
      data: { name, shortCode, address: address ?? null },
    });

    await auditService.log({
      userId: req.user.id,
      action: 'WAREHOUSE_CREATED',
      entityType: 'Warehouse',
      entityId: warehouse.id,
      metadata: { name, shortCode },
      ip: req.ip,
    });

    res.status(201).json({ success: true, data: warehouse });
  }

  async update(req, res) {
    const { id } = req.valid.params;
    const data = req.valid.body;

    const existing = await prisma.warehouse.findUnique({ where: { id } });
    if (!existing) throw notFound('Warehouse not found');

    const warehouse = await prisma.warehouse.update({
      where: { id },
      data: { ...data, address: data.address === undefined ? undefined : (data.address ?? null) },
    });

    await auditService.log({
      userId: req.user.id,
      action: 'WAREHOUSE_UPDATED',
      entityType: 'Warehouse',
      entityId: id,
      metadata: data,
      ip: req.ip,
    });

    res.status(200).json({ success: true, data: warehouse });
  }

  async remove(req, res) {
    const { id } = req.valid.params;

    const warehouse = await prisma.warehouse.findUnique({
      where: { id },
      include: { _count: { select: { locations: true, userAccess: true } } },
    });
    if (!warehouse) throw notFound('Warehouse not found');

    if (warehouse._count.locations > 0) {
      throw badRequest(
        `Cannot delete a warehouse with ${warehouse._count.locations} location(s). Deactivate it instead.`,
        'WAREHOUSE_HAS_LOCATIONS',
      );
    }
    if (warehouse._count.userAccess > 0) {
      throw badRequest(
        'Cannot delete a warehouse that users are still assigned to',
        'WAREHOUSE_IN_USE',
      );
    }

    await prisma.warehouse.delete({ where: { id } });

    await auditService.log({
      userId: req.user.id,
      action: 'WAREHOUSE_DELETED',
      entityType: 'Warehouse',
      entityId: id,
      metadata: { name: warehouse.name },
      ip: req.ip,
    });

    res.status(200).json({ success: true, message: 'Warehouse deleted' });
  }

  assertReadable(user, warehouseId) {
    assertWarehouseAccess(user, warehouseId);
  }
}

module.exports = new WarehouseController();
