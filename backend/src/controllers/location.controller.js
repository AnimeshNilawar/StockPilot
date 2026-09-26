const { prisma } = require('../lib/prisma');
const { parsePagination, paginated } = require('../utils/query');
const { applyWarehouseScope, assertWarehouseAccess } = require('../middleware/access.middleware');
const { notFound, badRequest } = require('../utils/appError');
const auditService = require('../services/audit.service');

class LocationController {
  /** All locations across the caller's warehouses. */
  async list(req, res) {
    const { page, pageSize, skip, take } = parsePagination(req.valid.query);
    const { search, type, parentId, isActive } = req.valid.query;

    const where = applyWarehouseScope(req.user, {
      ...(search
        ? {
            OR: [
              { name: { contains: search, mode: 'insensitive' } },
              { shortCode: { contains: search, mode: 'insensitive' } },
            ],
          }
        : {}),
      ...(type ? { type } : {}),
      ...(parentId !== undefined ? { parentId: parentId === 'null' ? null : parentId } : {}),
      ...(isActive !== undefined ? { isActive } : {}),
    });

    const [items, total] = await Promise.all([
      prisma.location.findMany({
        where,
        orderBy: { shortCode: 'asc' },
        skip,
        take,
        include: { warehouse: { select: { id: true, name: true, shortCode: true } } },
      }),
      prisma.location.count({ where }),
    ]);

    res.status(200).json({ success: true, data: paginated(items, total, { page, pageSize }) });
  }

  /** Locations of one warehouse, hierarchical. */
  async listByWarehouse(req, res) {
    const { warehouseId } = req.valid.params;
    this.assertReadable(req.user, warehouseId);

    const { page, pageSize, skip, take } = parsePagination(req.valid.query);
    const { search, type, parentId, isActive } = req.valid.query;

    const where = {
      warehouseId,
      ...(search
        ? {
            OR: [
              { name: { contains: search, mode: 'insensitive' } },
              { shortCode: { contains: search, mode: 'insensitive' } },
            ],
          }
        : {}),
      ...(type ? { type } : {}),
      ...(parentId !== undefined ? { parentId: parentId === 'null' ? null : parentId } : {}),
      ...(isActive !== undefined ? { isActive } : {}),
    };

    const [items, total] = await Promise.all([
      prisma.location.findMany({
        where,
        orderBy: { shortCode: 'asc' },
        skip,
        take,
        include: { parent: { select: { id: true, name: true, shortCode: true } } },
      }),
      prisma.location.count({ where }),
    ]);

    res.status(200).json({ success: true, data: paginated(items, total, { page, pageSize }) });
  }

  /** Dropdown source: active locations of the warehouses the caller can use. */
  async options(req, res) {
    const where = applyWarehouseScope(req.user, { isActive: true });
    const items = await prisma.location.findMany({
      where,
      orderBy: [{ warehouseId: 'asc' }, { shortCode: 'asc' }],
      select: { id: true, name: true, shortCode: true, type: true, warehouseId: true },
    });
    res.status(200).json({ success: true, data: items });
  }

  async get(req, res) {
    const { id } = req.valid.params;

    const location = await prisma.location.findUnique({
      where: { id },
      include: {
        warehouse: { select: { id: true, name: true, shortCode: true } },
        parent: { select: { id: true, name: true, shortCode: true } },
        children: { select: { id: true, name: true, shortCode: true, type: true } },
      },
    });
    if (!location) throw notFound('Location not found');

    this.assertReadable(req.user, location.warehouseId);

    res.status(200).json({ success: true, data: location });
  }

  async create(req, res) {
    const { warehouseId, name, shortCode, type, parentId, isActive } = req.valid.body;

    const warehouse = await prisma.warehouse.findUnique({ where: { id: warehouseId } });
    if (!warehouse) throw badRequest('Warehouse not found', 'WAREHOUSE_NOT_FOUND');

    await this.assertParentValid({ warehouseId, parentId });

    const location = await prisma.location.create({
      data: {
        warehouseId,
        name,
        shortCode,
        type,
        parentId: parentId ?? null,
        ...(isActive === undefined ? {} : { isActive }),
      },
      include: { warehouse: { select: { id: true, name: true, shortCode: true } } },
    });

    await auditService.log({
      userId: req.user.id,
      action: 'LOCATION_CREATED',
      entityType: 'Location',
      entityId: location.id,
      metadata: { name, shortCode, type, warehouseId },
      ip: req.ip,
    });

    res.status(201).json({ success: true, data: location });
  }

  async update(req, res) {
    const { id } = req.valid.params;
    const data = req.valid.body;

    const existing = await prisma.location.findUnique({ where: { id } });
    if (!existing) throw notFound('Location not found');

    this.assertReadable(req.user, existing.warehouseId);

    if (data.parentId !== undefined) {
      await this.assertParentValid({
        warehouseId: existing.warehouseId,
        parentId: data.parentId,
        selfId: id,
      });
    }

    // A location that already holds stock cannot change its nature: the ledger
    // rules (and the meaning of its quant rows) depend on the type.
    if (data.type && data.type !== existing.type) {
      const [moveCount, quantCount] = await Promise.all([
        prisma.stockMove.count({
          where: { OR: [{ fromLocationId: id }, { toLocationId: id }], state: 'done' },
        }),
        prisma.stockQuant.count({ where: { locationId: id, onHand: { not: 0 } } }),
      ]);
      if (moveCount > 0 || quantCount > 0) {
        throw badRequest(
          'Cannot change the type of a location that has stock movements or balances',
          'LOCATION_TYPE_LOCKED',
        );
      }
    }

    const location = await prisma.location.update({ where: { id }, data });

    await auditService.log({
      userId: req.user.id,
      action: 'LOCATION_UPDATED',
      entityType: 'Location',
      entityId: id,
      metadata: data,
      ip: req.ip,
    });

    res.status(200).json({ success: true, data: location });
  }

  async remove(req, res) {
    const { id } = req.valid.params;

    const location = await prisma.location.findUnique({
      where: { id },
      include: {
        _count: { select: { children: true, movesFrom: true, movesTo: true, quantsHere: true } },
      },
    });
    if (!location) throw notFound('Location not found');

    this.assertReadable(req.user, location.warehouseId);

    if (location._count.children > 0) {
      throw badRequest('Cannot delete a location that has sub-locations', 'LOCATION_HAS_CHILDREN');
    }
    if (
      location._count.movesFrom > 0 ||
      location._count.movesTo > 0 ||
      location._count.quantsHere > 0
    ) {
      throw badRequest('Cannot delete a location that has stock history', 'LOCATION_IN_USE');
    }

    await prisma.location.delete({ where: { id } });

    await auditService.log({
      userId: req.user.id,
      action: 'LOCATION_DELETED',
      entityType: 'Location',
      entityId: id,
      metadata: { name: location.name, shortCode: location.shortCode },
      ip: req.ip,
    });

    res.status(200).json({ success: true, message: 'Location deleted' });
  }

  /** Parents must exist and live in the same warehouse; no cycles allowed. */
  async assertParentValid({ warehouseId, parentId, selfId = null }) {
    if (parentId === undefined || parentId === null) return;
    if (selfId && parentId === selfId) {
      throw badRequest('A location cannot be its own parent', 'INVALID_LOCATION_PARENT');
    }

    const parent = await prisma.location.findUnique({
      where: { id: parentId },
      select: { id: true, warehouseId: true, parentId: true },
    });
    if (!parent) throw badRequest('Parent location not found', 'LOCATION_NOT_FOUND');
    if (parent.warehouseId !== warehouseId) {
      throw badRequest(
        'Parent location must belong to the same warehouse',
        'CROSS_WAREHOUSE_PARENT',
      );
    }
    if (!selfId) return;

    let cursor = parent.parentId;
    for (let depth = 0; depth < 20 && cursor; depth += 1) {
      if (cursor === selfId) {
        throw badRequest(
          'A location cannot be moved under one of its own descendants',
          'LOCATION_CYCLE',
        );
      }
      const node = await prisma.location.findUnique({
        where: { id: cursor },
        select: { parentId: true },
      });
      cursor = node ? node.parentId : null;
    }
  }

  assertReadable(user, warehouseId) {
    assertWarehouseAccess(user, warehouseId);
  }
}

module.exports = new LocationController();
