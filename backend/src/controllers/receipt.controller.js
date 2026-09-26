const { prisma } = require('../lib/prisma');
const { badRequest, notFound } = require('../utils/appError');
const { parsePagination, paginated } = require('../utils/query');
const idempotencyService = require('../services/idempotency.service');
const inventoryService = require('../services/inventory.service');
const referenceService = require('../services/reference.service');
const auditService = require('../services/audit.service');
const documentService = require('../services/document.service');
const { DOCUMENT_TYPES, REFERENCE_PREFIX } = require('../domain/documentType');
const { LOCATION_TYPES, isBoundary } = require('../domain/location');
const { DOC_STATES } = require('../domain/documentState');
const { isSupplier } = require('../domain/partner');
const { assertWarehouseAccess, applyWarehouseScope } = require('../middleware/access.middleware');

const list = async (req, res) => {
  const { page, pageSize, skip, take } = parsePagination(req.valid.query);
  const { warehouseId, state, search } = req.valid.query;

  const where = {};
  if (state) where.state = state;
  if (warehouseId) {
    assertWarehouseAccess(req.user, warehouseId);
    where.warehouseId = warehouseId;
  } else {
    // Only warehouse-scoped roles are pinned to their assignments, so an
    // INVENTORY_MANAGER still sees every warehouse. Naming a warehouse is
    // checked above, so a crafted id cannot widen the result.
    Object.assign(where, applyWarehouseScope(req.user));
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
      skip,
      take,
      orderBy: { createdAt: 'desc' },
    }),
  ]);

  res.status(200).json({
    status: 'success',
    data: paginated(receipts, total, { page, pageSize }),
  });
};

const getById = async (req, res) => {
  const { id } = req.valid.params;

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
      throw badRequest(
        `Location ${loc.name} is a boundary location and cannot be a receipt destination`,
      );
    }
  }
};

/**
 * A receipt is goods arriving, so its partner must be allowed to supply. A
 * customer-only partner is rejected here rather than at validation, where the
 * stock movement would otherwise be attempted and rolled back.
 */
const assertPartnerCanSupply = async (partnerId) => {
  const partner = await prisma.partner.findUnique({ where: { id: partnerId } });
  if (!partner) throw badRequest('Partner not found');
  if (!isSupplier(partner.type)) {
    throw badRequest(
      `Partner ${partner.name} is a customer and cannot receive goods`,
      'INVALID_PARTNER_TYPE',
    );
  }
  return partner;
};

const create = async (req, res) => {
  const { partnerId, warehouseId, lines } = req.valid.body;

  assertWarehouseAccess(req.user, warehouseId);
  await validateLocations(warehouseId, lines);
  await assertPartnerCanSupply(partnerId);

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
  const { id } = req.valid.params;
  const { partnerId, warehouseId, lines } = req.valid.body;

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
  await assertPartnerCanSupply(partnerId);

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

const changeState = async (req, res) => {
  const { id } = req.valid.params;
  const { state: newState } = req.valid.body;

  const current = await prisma.receipt.findUnique({ where: { id } });
  if (!current) throw notFound('Receipt not found');
  assertWarehouseAccess(req.user, current.warehouseId);

  // The state read above is only used for the access check and the audit trail;
  // the write itself is a compare-and-set inside documentService, so a request
  // that raced another one is rejected instead of clobbering it.
  const updated = await prisma.$transaction((tx) =>
    documentService.transition(tx, {
      document: tx.receipt,
      documentId: id,
      to: newState,
    }),
  );

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
  const { id } = req.valid.params;

  const current = await prisma.receipt.findUnique({ where: { id } });
  if (!current) throw notFound('Receipt not found');
  assertWarehouseAccess(req.user, current.warehouseId);

  const updated = await prisma.$transaction((tx) =>
    documentService.transition(tx, {
      document: tx.receipt,
      documentId: id,
      to: DOC_STATES.CANCELLED,
    }),
  );

  await auditService.log({
    userId: req.user.id,
    action: 'CANCEL',
    entityType: 'RECEIPT',
    entityId: id,
  });

  res.status(200).json({ status: 'success', data: updated });
};

const validate = async (req, res) => {
  const { id } = req.valid.params;

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
      // Re-read inside the transaction: the state that authorises the stock
      // movement must be the one that commits with it.
      const current = await tx.receipt.findUnique({
        where: { id },
        include: { lines: true },
      });

      // Find VENDOR location for this warehouse
      const vendorLoc = await tx.location.findFirst({
        where: { warehouseId: current.warehouseId, type: LOCATION_TYPES.VENDOR },
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

      // Stock is posted, so the state flip is a compare-and-set: a concurrent
      // validation of the same receipt loses the race and its whole
      // transaction, movements included, is rolled back.
      const updated = await documentService.finalize(tx, {
        document: tx.receipt,
        documentId: id,
      });

      return { statusCode: 200, body: { status: 'success', data: updated } };
    },
  });

  if (result.replayed) {
    res.set('Idempotent-Replay', 'true');
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
  changeState,
  cancel,
  validate,
};
