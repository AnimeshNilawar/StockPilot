const { prisma } = require('../lib/prisma');
const { badRequest, notFound, conflict } = require('../utils/appError');
const idempotencyService = require('../services/idempotency.service');
const inventoryService = require('../services/inventory.service');
const referenceService = require('../services/reference.service');
const auditService = require('../services/audit.service');
const { DOCUMENT_TYPES, REFERENCE_PREFIX } = require('../domain/documentType');
const { LOCATION_TYPES, isBoundary } = require('../domain/location');
const { DOC_STATES, canTransition } = require('../domain/documentState');
const { assertWarehouseAccess } = require('../middleware/access.middleware');

const list = async (req, res) => {
  const { page = 1, pageSize = 20, warehouseId, state, search } = req.query;
  const skip = (page - 1) * pageSize;

  const where = {};
  if (state) where.state = state;
  if (warehouseId) {
    assertWarehouseAccess(req.user, warehouseId);
    where.warehouseId = warehouseId;
  } else {
    const user = await prisma.user.findUnique({
      where: { id: req.user.id },
      include: { warehouseAccess: true, role: true },
    });
    if (user.role.name !== 'ADMIN') {
      where.warehouseId = { in: user.warehouseAccess.map((a) => a.warehouseId) };
    }
  }

  if (search) {
    where.OR = [
      { reference: { contains: search, mode: 'insensitive' } },
      { partner: { name: { contains: search, mode: 'insensitive' } } },
    ];
  }

  const [total, receipts] = await Promise.all([
    prisma.receipt.count({ where }),
    prisma.receipt.findMany({
      where,
      include: {
        warehouse: { select: { name: true } },
        partner: { select: { name: true } },
        lines: {
          include: {
            product: { select: { sku: true, name: true, uom: true } },
            destinationLocation: { select: { name: true } },
          },
        },
      },
      skip: Number(skip),
      take: Number(pageSize),
      orderBy: { createdAt: 'desc' },
    }),
  ]);

  res.status(200).json({
    status: 'success',
    data: {
      items: receipts,
      pagination: {
        page: Number(page),
        pageSize: Number(pageSize),
        total,
        totalPages: Math.ceil(total / pageSize),
      },
    },
  });
};

const getById = async (req, res) => {
  const { id } = req.params;

  const receipt = await prisma.receipt.findUnique({
    where: { id },
    include: {
      warehouse: { select: { id: true, name: true, shortCode: true } },
      partner: { select: { id: true, name: true } },
      lines: {
        include: {
          product: { select: { id: true, sku: true, name: true, uom: true } },
          destinationLocation: { select: { id: true, name: true, type: true } },
        },
      },
    },
  });

  if (!receipt) throw notFound('Receipt not found');
  assertWarehouseAccess(req.user, receipt.warehouseId);

  res.status(200).json({
    status: 'success',
    data: receipt,
  });
};

const validateLocations = async (warehouseId, lines) => {
  for (const line of lines) {
    const loc = await prisma.location.findUnique({ where: { id: line.destinationLocationId } });
    if (!loc) throw badRequest(`Location ${line.destinationLocationId} not found`);
    if (loc.warehouseId !== warehouseId) {
      throw badRequest(`Location ${loc.name} does not belong to warehouse ${warehouseId}`);
    }
    if (isBoundary(loc.type)) {
      throw badRequest(`Location ${loc.name} is a boundary location and cannot be a receipt destination`);
    }
  }
};

const create = async (req, res) => {
  const { partnerId, warehouseId, lines } = req.body;

  assertWarehouseAccess(req.user, warehouseId);
  await validateLocations(warehouseId, lines);

  const partner = await prisma.partner.findUnique({ where: { id: partnerId } });
  if (!partner) throw badRequest('Partner not found');

  const receipt = await prisma.$transaction(async (tx) => {
    const reference = await referenceService.nextReference(tx, REFERENCE_PREFIX.RECEIPT);

    return tx.receipt.create({
      data: {
        reference,
        partnerId,
        warehouseId,
        createdById: req.user.id,
        state: DOC_STATES.DRAFT,
        lines: {
          create: lines.map((line) => ({
            productId: line.productId,
            quantity: line.quantity,
            destinationLocationId: line.destinationLocationId,
          })),
        },
      },
      include: {
        partner: true,
        lines: true,
      },
    });
  });

  await auditService.log({
    userId: req.user.id,
    action: 'CREATE',
    entityType: 'RECEIPT',
    entityId: receipt.id,
    metadata: { reference: receipt.reference },
  });

  res.status(201).json({
    status: 'success',
    data: receipt,
  });
};

const update = async (req, res) => {
  const { id } = req.params;
  const { partnerId, warehouseId, lines } = req.body;

  const current = await prisma.receipt.findUnique({ where: { id }, include: { lines: true } });
  if (!current) throw notFound('Receipt not found');
  assertWarehouseAccess(req.user, current.warehouseId);

  if (current.state !== DOC_STATES.DRAFT) {
    throw badRequest('Only DRAFT receipts can be edited');
  }

  // If changing warehouse, check access to new warehouse
  if (warehouseId && warehouseId !== current.warehouseId) {
    assertWarehouseAccess(req.user, warehouseId);
  }
  const finalWarehouseId = warehouseId || current.warehouseId;
  await validateLocations(finalWarehouseId, lines);

  const updated = await prisma.$transaction(async (tx) => {
    // Delete existing lines
    await tx.receiptLine.deleteMany({ where: { receiptId: id } });

    // Update receipt and add new lines
    return tx.receipt.update({
      where: { id },
      data: {
        partnerId,
        warehouseId: finalWarehouseId,
        lines: {
          create: lines.map((line) => ({
            productId: line.productId,
            quantity: line.quantity,
            destinationLocationId: line.destinationLocationId,
          })),
        },
      },
      include: { lines: true, partner: true },
    });
  });

  await auditService.log({
    userId: req.user.id,
    action: 'UPDATE',
    entityType: 'RECEIPT',
    entityId: id,
    metadata: { reference: updated.reference },
  });

  res.status(200).json({ status: 'success', data: updated });
};

const transition = async (req, res) => {
  const { id } = req.params;
  const { state: newState } = req.body;

  const current = await prisma.receipt.findUnique({ where: { id } });
  if (!current) throw notFound('Receipt not found');
  assertWarehouseAccess(req.user, current.warehouseId);

  if (!canTransition(current.state, newState)) {
    throw conflict(`Cannot transition receipt from ${current.state} to ${newState}`);
  }

  const updated = await prisma.receipt.update({
    where: { id },
    data: { state: newState },
  });

  await auditService.log({
    userId: req.user.id,
    action: 'TRANSITION',
    entityType: 'RECEIPT',
    entityId: id,
    metadata: { from: current.state, to: newState },
  });

  res.status(200).json({ status: 'success', data: updated });
};

const cancel = async (req, res) => {
  const { id } = req.params;

  const current = await prisma.receipt.findUnique({ where: { id } });
  if (!current) throw notFound('Receipt not found');
  assertWarehouseAccess(req.user, current.warehouseId);

  if (!canTransition(current.state, DOC_STATES.CANCELLED)) {
    throw conflict(`Cannot cancel receipt in state ${current.state}`);
  }

  const updated = await prisma.receipt.update({
    where: { id },
    data: { state: DOC_STATES.CANCELLED },
  });

  await auditService.log({
    userId: req.user.id,
    action: 'CANCEL',
    entityType: 'RECEIPT',
    entityId: id,
  });

  res.status(200).json({ status: 'success', data: updated });
};

const validate = async (req, res) => {
  const { id } = req.params;

  const receipt = await prisma.receipt.findUnique({
    where: { id },
    include: { lines: true },
  });

  if (!receipt) throw notFound('Receipt not found');
  assertWarehouseAccess(req.user, receipt.warehouseId);

  const result = await idempotencyService.withIdempotency({
    key: req.idempotencyKey,
    endpoint: `validate-receipt-${id}`,
    userId: req.user.id,
    payload: req.body,
    handler: async (tx) => {
      // Re-read inside tx
      const current = await tx.receipt.findUnique({
        where: { id },
        include: { lines: true },
      });
      if (current.state === DOC_STATES.DONE || current.state === DOC_STATES.CANCELLED) {
        throw conflict('Receipt is already DONE or CANCELLED');
      }

      // Find VENDOR location for this warehouse
      const vendorLoc = await tx.location.findFirst({
        where: { warehouseId: receipt.warehouseId, type: LOCATION_TYPES.VENDOR },
      });
      if (!vendorLoc) {
        throw badRequest('No VENDOR location found for this warehouse');
      }

      for (const line of current.lines) {
        await inventoryService.executeMove(tx, {
          productId: line.productId,
          fromLocationId: vendorLoc.id,
          toLocationId: line.destinationLocationId,
          quantity: line.quantity,
          documentType: DOCUMENT_TYPES.RECEIPT,
          documentId: current.id,
          reference: current.reference,
          createdById: req.user.id,
        });
      }

      const updated = await tx.receipt.update({
        where: { id },
        data: { state: DOC_STATES.DONE },
      });

      return { statusCode: 200, body: { status: 'success', data: updated } };
    },
  });

  if (result.replayed) {
    res.set('Idempotent-Replayed', 'true');
  } else if (result.statusCode === 200) {
    await auditService.log({
      userId: req.user.id,
      action: 'VALIDATE',
      entityType: 'RECEIPT',
      entityId: id,
    });
  }
  
  res.status(result.statusCode).json(result.body);
};

module.exports = {
  list,
  getById,
  create,
  update,
  transition,
  cancel,
  validate,
};
