const { prisma } = require('../lib/prisma');
const { parsePagination, paginated } = require('../utils/query');
const { notFound, badRequest } = require('../utils/appError');
const auditService = require('../services/audit.service');

class CategoryController {
  /** Flat, paginated list — `parent` is included so the UI can show the path. */
  async list(req, res) {
    const { page, pageSize, skip, take } = parsePagination(req.valid.query);
    const { search, parentId, isActive } = req.valid.query;

    const where = {
      ...(search ? { name: { contains: search, mode: 'insensitive' } } : {}),
      ...(parentId !== undefined ? { parentId: parentId === 'null' ? null : parentId } : {}),
      ...(isActive !== undefined ? { isActive } : {}),
    };

    const [items, total] = await Promise.all([
      prisma.category.findMany({
        where,
        orderBy: { name: 'asc' },
        skip,
        take,
        include: { parent: { select: { id: true, name: true } } },
      }),
      prisma.category.count({ where }),
    ]);

    res.status(200).json({ success: true, data: paginated(items, total, { page, pageSize }) });
  }

  /** Full tree for pickers and the management screen. */
  async tree(req, res) {
    const categories = await prisma.category.findMany({
      where: { isActive: true },
      orderBy: { name: 'asc' },
      select: { id: true, name: true, parentId: true },
    });

    const byParent = new Map();
    for (const category of categories) {
      const key = category.parentId || 'root';
      if (!byParent.has(key)) byParent.set(key, []);
      byParent.get(key).push({ id: category.id, name: category.name });
    }

    const build = (parentId) =>
      (byParent.get(parentId || 'root') || []).map((node) => ({
        ...node,
        children: build(node.id),
      }));

    res.status(200).json({ success: true, data: build(null) });
  }

  async get(req, res) {
    const category = await prisma.category.findUnique({
      where: { id: req.valid.params.id },
      include: { parent: true, children: true, _count: { select: { products: true } } },
    });
    if (!category) throw notFound('Category not found');
    res.status(200).json({ success: true, data: category });
  }

  async create(req, res) {
    const { name, parentId } = req.valid.body;
    await this.assertParentValid(parentId, null);

    const category = await prisma.category.create({ data: { name, parentId: parentId ?? null } });

    await auditService.log({
      userId: req.user.id,
      action: 'CATEGORY_CREATED',
      entityType: 'Category',
      entityId: category.id,
      metadata: { name, parentId: parentId ?? null },
      ip: req.ip,
    });

    res.status(201).json({ success: true, data: category });
  }

  async update(req, res) {
    const { id } = req.valid.params;
    const data = req.valid.body;

    const existing = await prisma.category.findUnique({ where: { id } });
    if (!existing) throw notFound('Category not found');

    if (data.parentId !== undefined) {
      await this.assertParentValid(data.parentId, id);
    }

    const category = await prisma.category.update({ where: { id }, data });

    await auditService.log({
      userId: req.user.id,
      action: 'CATEGORY_UPDATED',
      entityType: 'Category',
      entityId: id,
      metadata: data,
      ip: req.ip,
    });

    res.status(200).json({ success: true, data: category });
  }

  async remove(req, res) {
    const { id } = req.valid.params;

    const [productCount, childCount] = await Promise.all([
      prisma.product.count({ where: { categoryId: id } }),
      prisma.category.count({ where: { parentId: id } }),
    ]);

    if (productCount > 0) {
      throw badRequest(
        `Cannot delete a category used by ${productCount} product(s). Reassign or deactivate it instead.`,
        'CATEGORY_IN_USE',
      );
    }
    if (childCount > 0) {
      throw badRequest(
        `Cannot delete a category with ${childCount} sub-categor(ies)`,
        'CATEGORY_HAS_CHILDREN',
      );
    }

    const category = await prisma.category.findUnique({ where: { id } });
    if (!category) throw notFound('Category not found');

    await prisma.category.delete({ where: { id } });

    await auditService.log({
      userId: req.user.id,
      action: 'CATEGORY_DELETED',
      entityType: 'Category',
      entityId: id,
      metadata: { name: category.name },
      ip: req.ip,
    });

    res.status(200).json({ success: true, message: 'Category deleted' });
  }

  /** Rejects a missing parent and any attempt to build a cycle. */
  async assertParentValid(parentId, categoryId) {
    if (parentId === undefined || parentId === null) return;
    if (categoryId && parentId === categoryId) {
      throw badRequest('A category cannot be its own parent', 'INVALID_CATEGORY_PARENT');
    }

    const parent = await prisma.category.findUnique({
      where: { id: parentId },
      select: { id: true },
    });
    if (!parent) throw badRequest('Parent category not found', 'CATEGORY_NOT_FOUND');

    if (!categoryId) return;

    let cursor = parentId;
    for (let depth = 0; depth < 20 && cursor; depth += 1) {
      if (cursor === categoryId) {
        throw badRequest(
          'A category cannot be moved under one of its own descendants',
          'CATEGORY_CYCLE',
        );
      }
      const node = await prisma.category.findUnique({
        where: { id: cursor },
        select: { parentId: true },
      });
      cursor = node ? node.parentId : null;
    }
  }
}

module.exports = new CategoryController();
