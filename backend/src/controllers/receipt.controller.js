const { prisma } = require('../lib/prisma');
const { badRequest, notFound } = require('../utils/appError');
const idempotencyService = require('../services/idempotency.service');
const inventoryService = require('../services/inventory.service');
const referenceService = require('../services/reference.service');
const { DOCUMENT_TYPES, REFERENCE_PREFIX } = require('../domain/documentType');
const { LOCATION_TYPES } = require('../domain/location');
const { DOC_STATES } = require('../domain/documentState');
const { assertWarehouseAccess } = require('../middleware/access.middleware');

const list = async (req, res) => {
  const { page = 1, pageSize = 20, warehouseId, state } = req.query;
  const skip = (page - 1) * pageSize;

  const where = {};
  if (state) where.state = state;
  if (warehouseId) {
    assertWarehouseAccess(req.user, warehouseId);
    where.warehouseId = warehouseId;
  } else {
    // Restrict to accessible warehouses if no filter provided
    const user = await prisma.user.findUnique({
      where: { id: req.user.id },
      include: { warehouseAccess: true, role: true },
    });
    if (user.role.name !== 'ADMIN') {
      where.warehouseId = { in: user.warehouseAccess.map((a) => a.warehouseId) };
    }
  }

  const [total, receipts] = await Promise.all([
    prisma.receipt.count({ where }),
    prisma.receipt.findMany({
      where,
      include: {
        warehouse: { select: { name: true } },
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
      warehouse: { select: { name: true, shortCode: true } },
      lines: {
        include: {
          product: { select: { sku: true, name: true, uom: true } },
          destinationLocation: { select: { name: true, type: true } },
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

const create = async (req, res) => {
  const { supplier, warehouseId, lines } = req.body;

  assertWarehouseAccess(req.user, warehouseId);

  // Validate locations belong to warehouse and are valid holding locations
  for (const line of lines) {
    const loc = await prisma.location.findUnique({ where: { id: line.destinationLocationId } });
    if (!loc) throw badRequest(`Location ${line.destinationLocationId} not found`);
    if (loc.warehouseId !== warehouseId) {
      throw badRequest(`Location ${loc.name} does not belong to warehouse ${warehouseId}`);
    }
  }

  const receipt = await prisma.$transaction(async (tx) => {
    const reference = await referenceService.nextReference(tx, REFERENCE_PREFIX.RECEIPT);

    return tx.receipt.create({
      data: {
        reference,
        supplier,
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
        lines: true,
      },
    });
  });

  res.status(201).json({
    status: 'success',
    data: receipt,
  });
};

const validate = async (req, res) => {
  const { id } = req.params;

  const receipt = await prisma.receipt.findUnique({
    where: { id },
    include: { lines: true },
  });

  if (!receipt) throw notFound('Receipt not found');
  assertWarehouseAccess(req.user, receipt.warehouseId);

  // Idempotency: execute in transaction via idempotencyService
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
      if (current.state !== DOC_STATES.DRAFT && current.state !== DOC_STATES.READY) {
        throw badRequest('Receipt is not in a valid state to be validated');
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
          userId: req.user.id,
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
  }
  res.status(result.statusCode).json(result.body);
};

module.exports = {
  list,
  getById,
  create,
  validate,
};
