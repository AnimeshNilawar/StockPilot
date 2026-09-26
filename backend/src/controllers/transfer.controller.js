const { Prisma } = require('@prisma/client');
const { prisma } = require('../lib/prisma');
const { badRequest, notFound, conflict } = require('../utils/appError');
const { parsePagination, paginated } = require('../utils/query');
const idempotencyService = require('../services/idempotency.service');
const inventoryService = require('../services/inventory.service');
const referenceService = require('../services/reference.service');
const auditService = require('../services/audit.service');
const documentService = require('../services/document.service');
const { DOCUMENT_TYPES, REFERENCE_PREFIX } = require('../domain/documentType');
const { LOCATION_TYPES } = require('../domain/location');
const { DOC_STATES } = require('../domain/documentState');
const { assertWarehouseAccess, applyWarehouseScope } = require('../middleware/access.middleware');

const dec = (value) => (value instanceof Prisma.Decimal ? value : new Prisma.Decimal(value));
const ZERO = new Prisma.Decimal(0);

/**
 * Validates that all line source and destination locations:
 * 1. Exist and are active
 * 2. Belong to the transfer's warehouse
 * 3. Are strictly INTERNAL locations (both source and destination)
 * 4. Are not identical on the same line
 */
const validateTransferLocations = async (warehouseId, lines) => {
  for (const line of lines) {
    if (line.sourceLocationId === line.destinationLocationId) {
      throw badRequest('Source and destination locations must differ', 'INVALID_LOCATIONS');
    }

    const [source, destination, product] = await Promise.all([
      prisma.location.findUnique({ where: { id: line.sourceLocationId } }),
      prisma.location.findUnique({ where: { id: line.destinationLocationId } }),
      prisma.product.findUnique({ where: { id: line.productId } }),
    ]);

    if (!source) throw badRequest(`Source location ${line.sourceLocationId} not found`);
    if (!destination) throw badRequest(`Destination location ${line.destinationLocationId} not found`);
    if (!product) throw badRequest(`Product ${line.productId} not found`);

    if (source.warehouseId !== warehouseId) {
      throw badRequest(`Source location ${source.name} does not belong to warehouse ${warehouseId}`);
    }
    if (destination.warehouseId !== warehouseId) {
      throw badRequest(`Destination location ${destination.name} does not belong to warehouse ${warehouseId}`);
    }

    if (source.type !== LOCATION_TYPES.INTERNAL) {
      throw badRequest(
        `Source location ${source.name} is of type ${source.type}. Internal transfers require INTERNAL locations on both ends.`,
        'INVALID_LOCATION_TYPES',
      );
    }
    if (destination.type !== LOCATION_TYPES.INTERNAL) {
      throw badRequest(
        `Destination location ${destination.name} is of type ${destination.type}. Internal transfers require INTERNAL locations on both ends.`,
        'INVALID_LOCATION_TYPES',
      );
    }

    if (!source.isActive) throw badRequest(`Source location ${source.name} is inactive`);
    if (!destination.isActive) throw badRequest(`Destination location ${destination.name} is inactive`);
    if (!product.isActive) throw badRequest(`Product ${product.name} is inactive`);
  }
};

const list = async (req, res) => {
  const { page, pageSize, skip, take } = parsePagination(req.valid.query);
  const { warehouseId, state, search } = req.valid.query;

  const where = {};
  if (state) where.state = state;

  if (warehouseId) {
    assertWarehouseAccess(req.user, warehouseId);
    where.warehouseId = warehouseId;
  } else {
    Object.assign(where, applyWarehouseScope(req.user));
  }

  if (search) {
    where.OR = [
      { reference: { contains: search, mode: 'insensitive' } },
    ];
  }

  const [total, transfers] = await Promise.all([
    prisma.internalTransfer.count({ where }),
    prisma.internalTransfer.findMany({
      where,
      include: {
        warehouse: { select: { id: true, name: true, shortCode: true } },
        lines: {
          include: {
            product: { select: { id: true, sku: true, name: true, uom: true } },
            sourceLocation: { select: { id: true, name: true, shortCode: true } },
            destinationLocation: { select: { id: true, name: true, shortCode: true } },
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
    data: paginated(transfers, total, { page, pageSize }),
  });
};

const getById = async (req, res) => {
  const { id } = req.valid.params;

  const transfer = await prisma.internalTransfer.findUnique({
    where: { id },
    include: {
      warehouse: { select: { id: true, name: true, shortCode: true } },
      lines: {
        include: {
          product: { select: { id: true, sku: true, name: true, uom: true } },
          sourceLocation: { select: { id: true, name: true, shortCode: true, type: true } },
          destinationLocation: { select: { id: true, name: true, shortCode: true, type: true } },
        },
      },
    },
  });

  if (!transfer) throw notFound('Internal transfer not found');
  assertWarehouseAccess(req.user, transfer.warehouseId);

  res.status(200).json({
    status: 'success',
    data: transfer,
  });
};

const create = async (req, res) => {
  const { warehouseId, lines } = req.valid.body;

  assertWarehouseAccess(req.user, warehouseId);
  await validateTransferLocations(warehouseId, lines);

  const transfer = await prisma.$transaction(async (tx) => {
    const reference = await referenceService.nextReference(tx, REFERENCE_PREFIX.INTERNAL);

    return tx.internalTransfer.create({
      data: {
        reference,
        warehouseId,
        createdById: req.user.id,
        state: DOC_STATES.DRAFT,
        lines: {
          create: lines.map((l) => ({
            productId: l.productId,
            quantity: l.quantity,
            sourceLocationId: l.sourceLocationId,
            destinationLocationId: l.destinationLocationId,
          })),
        },
      },
      include: {
        warehouse: true,
        lines: {
          include: {
            product: true,
            sourceLocation: true,
            destinationLocation: true,
          },
        },
      },
    });
  });

  await auditService.log({
    userId: req.user.id,
    action: 'CREATE',
    entityType: 'INTERNAL_TRANSFER',
    entityId: transfer.id,
    metadata: { reference: transfer.reference },
  });

  res.status(201).json({
    status: 'success',
    data: transfer,
  });
};

const update = async (req, res) => {
  const { id } = req.valid.params;
  const { warehouseId, lines } = req.valid.body;

  const current = await prisma.internalTransfer.findUnique({ where: { id }, include: { lines: true } });
  if (!current) throw notFound('Internal transfer not found');
  assertWarehouseAccess(req.user, current.warehouseId);

  if (current.state !== DOC_STATES.DRAFT) {
    throw badRequest('Only DRAFT transfers can be edited');
  }

  if (warehouseId && warehouseId !== current.warehouseId) {
    assertWarehouseAccess(req.user, warehouseId);
  }

  const finalWarehouseId = warehouseId || current.warehouseId;
  await validateTransferLocations(finalWarehouseId, lines);

  const updated = await prisma.$transaction(async (tx) => {
    await tx.internalTransferLine.deleteMany({ where: { transferId: id } });

    return tx.internalTransfer.update({
      where: { id },
      data: {
        warehouseId: finalWarehouseId,
        lines: {
          create: lines.map((l) => ({
            productId: l.productId,
            quantity: l.quantity,
            sourceLocationId: l.sourceLocationId,
            destinationLocationId: l.destinationLocationId,
          })),
        },
      },
      include: {
        warehouse: true,
        lines: {
          include: {
            product: true,
            sourceLocation: true,
            destinationLocation: true,
          },
        },
      },
    });
  });

  await auditService.log({
    userId: req.user.id,
    action: 'UPDATE',
    entityType: 'INTERNAL_TRANSFER',
    entityId: id,
    metadata: { reference: updated.reference },
  });

  res.status(200).json({ status: 'success', data: updated });
};

const changeState = async (req, res) => {
  const { id } = req.valid.params;
  const { state: newState } = req.valid.body;

  const current = await prisma.internalTransfer.findUnique({ where: { id } });
  if (!current) throw notFound('Internal transfer not found');
  assertWarehouseAccess(req.user, current.warehouseId);

  const updated = await prisma.$transaction((tx) =>
    documentService.transition(tx, {
      document: tx.internalTransfer,
      documentId: id,
      to: newState,
    }),
  );

  await auditService.log({
    userId: req.user.id,
    action: 'TRANSITION',
    entityType: 'INTERNAL_TRANSFER',
    entityId: id,
    metadata: { from: current.state, to: newState },
  });

  res.status(200).json({ status: 'success', data: updated });
};

const cancel = async (req, res) => {
  const { id } = req.valid.params;

  const current = await prisma.internalTransfer.findUnique({ where: { id } });
  if (!current) throw notFound('Internal transfer not found');
  assertWarehouseAccess(req.user, current.warehouseId);

  const updated = await prisma.$transaction((tx) =>
    documentService.transition(tx, {
      document: tx.internalTransfer,
      documentId: id,
      to: DOC_STATES.CANCELLED,
    }),
  );

  await auditService.log({
    userId: req.user.id,
    action: 'CANCEL',
    entityType: 'INTERNAL_TRANSFER',
    entityId: id,
    metadata: { reference: updated.reference },
  });

  res.status(200).json({ status: 'success', data: updated });
};

const validate = async (req, res) => {
  const { id } = req.valid.params;

  const transfer = await prisma.internalTransfer.findUnique({ where: { id }, include: { lines: true } });
  if (!transfer) throw notFound('Internal transfer not found');
  assertWarehouseAccess(req.user, transfer.warehouseId);

  const result = await idempotencyService.withIdempotency({
    key: req.idempotencyKey,
    endpoint: `validate-internal-transfer-${id}`,
    userId: req.user.id,
    payload: req.body,
    handler: async (tx) => {
      const current = await tx.internalTransfer.findUnique({ where: { id }, include: { lines: true } });
      documentService.assertCanValidate(current.state);

      if (current.lines.length === 0) {
        throw badRequest('A transfer with no lines cannot be validated', 'TRANSFER_NO_LINES');
      }

      // Sort lines by product and source/destination to preserve deterministic lock order
      const sortedLines = [...current.lines].sort((a, b) => {
        const keyA = `${a.productId}|${a.sourceLocationId}|${a.destinationLocationId}`;
        const keyB = `${b.productId}|${b.sourceLocationId}|${b.destinationLocationId}`;
        return keyA.localeCompare(keyB);
      });

      for (const line of sortedLines) {
        await inventoryService.executeMove(tx, {
          productId: line.productId,
          fromLocationId: line.sourceLocationId,
          toLocationId: line.destinationLocationId,
          quantity: line.quantity,
          documentType: DOCUMENT_TYPES.INTERNAL,
          documentId: current.id,
          reference: current.reference,
          createdById: req.user.id,
        });
      }

      const updated = await documentService.finalize(tx, {
        document: tx.internalTransfer,
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
      entityType: 'INTERNAL_TRANSFER',
      entityId: id,
    });
  }

  res.status(result.statusCode).json(result.body);
};

const availability = async (req, res) => {
  const { id } = req.valid.params;

  const transfer = await prisma.internalTransfer.findUnique({ where: { id }, include: { lines: true } });
  if (!transfer) throw notFound('Internal transfer not found');
  assertWarehouseAccess(req.user, transfer.warehouseId);

  const quants = await prisma.stockQuant.findMany({
    where: {
      OR: transfer.lines.map((l) => ({
        productId: l.productId,
        locationId: l.sourceLocationId,
      })),
    },
    select: { productId: true, locationId: true, onHand: true, reservedQuantity: true },
  });

  const quantByKey = new Map(
    quants.map((q) => [`${q.productId}|${q.locationId}`, q]),
  );

  const lines = transfer.lines.map((line) => {
    const quant = quantByKey.get(`${line.productId}|${line.sourceLocationId}`);
    const onHand = quant ? dec(quant.onHand) : ZERO;
    const reservedQuantity = quant ? dec(quant.reservedQuantity) : ZERO;
    const freeToUse = onHand.minus(reservedQuantity);
    const quantity = dec(line.quantity);

    return {
      lineId: line.id,
      productId: line.productId,
      sourceLocationId: line.sourceLocationId,
      destinationLocationId: line.destinationLocationId,
      quantity,
      onHand,
      reservedQuantity,
      freeToUse,
      isAvailable: freeToUse.gte(quantity),
    };
  });

  res.status(200).json({
    status: 'success',
    data: {
      transferId: transfer.id,
      state: transfer.state,
      lines,
      canValidate: lines.length > 0 && lines.every((l) => l.isAvailable),
    },
  });
};

module.exports = {
  list,
  getById,
  create,
  update,
  changeState,
  cancel,
  validate,
  availability,
};
