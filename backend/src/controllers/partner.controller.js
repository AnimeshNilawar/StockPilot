const { prisma } = require('../lib/prisma');
const { parsePagination, paginated, MAX_PAGE_SIZE } = require('../utils/query');
const { notFound, conflict } = require('../utils/appError');
const { typesForRole } = require('../domain/partner');
const auditService = require('../services/audit.service');

/**
 * Partners are master data, so writes are gated on the same `product.*`
 * permissions as the rest of the catalogue (see `partner.routes.js`).
 */
const buildWhere = ({ search, type, isActive }) => ({
  ...(search ? { name: { contains: search, mode: 'insensitive' } } : {}),
  // A filter on one concrete role widens to BOTH, so a trading counterparty is
  // never missing from a supplier or customer dropdown.
  ...(type ? { type: { in: typesForRole(type) } } : {}),
  ...(isActive !== undefined ? { isActive } : {}),
});

const list = async (req, res) => {
  const { page, pageSize, skip, take } = parsePagination(req.valid.query);
  const where = buildWhere(req.valid.query);

  const [items, total] = await Promise.all([
    prisma.partner.findMany({
      where,
      orderBy: { name: 'asc' },
      skip,
      take,
    }),
    prisma.partner.count({ where }),
  ]);

  res.status(200).json({
    status: 'success',
    data: paginated(items, total, { page, pageSize }),
  });
};

/**
 * Lightweight active-only list for document pickers. Returns a bare array
 * (not the paginated envelope) and is capped, because a dropdown must never ask
 * the database for an unbounded result set.
 */
const options = async (req, res) => {
  const partners = await prisma.partner.findMany({
    where: buildWhere({ ...req.valid.query, isActive: true }),
    select: { id: true, name: true, type: true },
    orderBy: { name: 'asc' },
    take: MAX_PAGE_SIZE,
  });

  res.status(200).json({ status: 'success', data: partners });
};

const getById = async (req, res) => {
  const partner = await prisma.partner.findUnique({
    where: { id: req.valid.params.id },
    include: { _count: { select: { receipts: true } } },
  });

  if (!partner) throw notFound('Partner not found');

  res.status(200).json({ status: 'success', data: partner });
};

const create = async (req, res) => {
  const partner = await prisma.partner.create({ data: req.valid.body });

  await auditService.log({
    userId: req.user.id,
    action: 'CREATE',
    entityType: 'PARTNER',
    entityId: partner.id,
    metadata: { name: partner.name, type: partner.type },
  });

  res.status(201).json({ status: 'success', data: partner });
};

const update = async (req, res) => {
  const { id } = req.valid.params;

  const existing = await prisma.partner.findUnique({ where: { id } });
  if (!existing) throw notFound('Partner not found');

  const partner = await prisma.partner.update({ where: { id }, data: req.valid.body });

  await auditService.log({
    userId: req.user.id,
    action: 'UPDATE',
    entityType: 'PARTNER',
    entityId: id,
    metadata: { name: partner.name, type: partner.type },
  });

  res.status(200).json({ status: 'success', data: partner });
};

/**
 * A partner referenced by any receipt is never deleted — its name is part of
 * the historical record. Callers get a pointer to deactivation instead.
 */
const remove = async (req, res) => {
  const { id } = req.valid.params;

  const existing = await prisma.partner.findUnique({
    where: { id },
    include: { _count: { select: { receipts: true } } },
  });
  if (!existing) throw notFound('Partner not found');

  if (existing._count.receipts > 0) {
    throw conflict(
      `Partner is used by ${existing._count.receipts} receipt(s) and cannot be deleted; deactivate it instead`,
      'PARTNER_IN_USE',
    );
  }

  await prisma.partner.delete({ where: { id } });

  await auditService.log({
    userId: req.user.id,
    action: 'DELETE',
    entityType: 'PARTNER',
    entityId: id,
    metadata: { name: existing.name },
  });

  res.status(200).json({ status: 'success', data: { id } });
};

module.exports = { list, options, getById, create, update, remove };
