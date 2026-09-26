const { Prisma } = require('@prisma/client');
const { prisma } = require('../lib/prisma');
const { badRequest, notFound, conflict, unprocessable } = require('../utils/appError');
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

const validateAdjustmentLocations = async (warehouseId, lines) => {
  for (const line of lines) {
    const [location, product] = await Promise.all([
      prisma.location.findUnique({ where: { id: line.locationId } }),
      prisma.product.findUnique({ where: { id: line.productId } }),
    ]);

    if (!location) throw badRequest(`Location ${line.locationId} not found`);
    if (!product) throw badRequest(`Product ${line.productId} not found`);

    if (location.warehouseId !== warehouseId) {
      throw badRequest(`Location ${location.name} does not belong to warehouse ${warehouseId}`);
    }

    if (location.type !== LOCATION_TYPES.INTERNAL) {
      throw badRequest(
        `Location ${location.name} is of type ${location.type}. Stock counts/adjustments can only be recorded on INTERNAL stock locations.`,
        'INVALID_LOCATION_TYPES',
      );
    }

    if (!location.isActive) throw badRequest(`Location ${location.name} is inactive`);
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
      { reason: { contains: search, mode: 'insensitive' } },
    ];
  }

  const [total, adjustments] = await Promise.all([
    prisma.adjustment.count({ where }),
    prisma.adjustment.findMany({
      where,
      include: {
        warehouse: { select: { id: true, name: true, shortCode: true } },
        lines: {
          include: {
            product: { select: { id: true, sku: true, name: true, uom: true } },
            location: { select: { id: true, name: true, shortCode: true } },
          },
        },
      },
      skip,
      take,
      orderBy: { createdAt: 'desc' },
    }),
  ]);

  const userIds = [
    ...new Set(adjustments.flatMap((a) => [a.createdById, a.validatedById]).filter(Boolean)),
  ];
  const users =
    userIds.length > 0
      ? await prisma.user.findMany({
          where: { id: { in: userIds } },
          select: { id: true, name: true, email: true },
        })
      : [];
  const userMap = new Map(users.map((u) => [u.id, u]));
  const hydrated = adjustments.map((a) => ({
    ...a,
    creator: userMap.get(a.createdById) || null,
    validator: userMap.get(a.validatedById) || null,
  }));

  res.status(200).json({
    status: 'success',
    data: paginated(hydrated, total, { page, pageSize }),
  });
};

const getById = async (req, res) => {
  const { id } = req.valid.params;

  const adjustment = await prisma.adjustment.findUnique({
    where: { id },
    include: {
      warehouse: { select: { id: true, name: true, shortCode: true } },
      lines: {
        include: {
          product: { select: { id: true, sku: true, name: true, uom: true } },
          location: { select: { id: true, name: true, shortCode: true, type: true } },
        },
      },
    },
  });

  if (!adjustment) throw notFound('Adjustment not found');
  assertWarehouseAccess(req.user, adjustment.warehouseId);

  const userIds = [adjustment.createdById, adjustment.validatedById].filter(Boolean);
  const users =
    userIds.length > 0
      ? await prisma.user.findMany({
          where: { id: { in: userIds } },
          select: { id: true, name: true, email: true },
        })
      : [];
  const userMap = new Map(users.map((u) => [u.id, u]));

  res.status(200).json({
    status: 'success',
    data: {
      ...adjustment,
      creator: userMap.get(adjustment.createdById) || null,
      validator: userMap.get(adjustment.validatedById) || null,
    },
  });
};

const create = async (req, res) => {
  const { warehouseId, reason, lines } = req.valid.body;

  assertWarehouseAccess(req.user, warehouseId);
  await validateAdjustmentLocations(warehouseId, lines);

  const adjustment = await prisma.$transaction(async (tx) => {
    // Look up current authoritative on-hand for each (product, location)
    const quants = await tx.stockQuant.findMany({
      where: {
        OR: lines.map((l) => ({
          productId: l.productId,
          locationId: l.locationId,
        })),
      },
    });

    const quantMap = new Map(quants.map((q) => [`${q.productId}|${q.locationId}`, q]));

    const processedLines = lines.map((l) => {
      const q = quantMap.get(`${l.productId}|${l.locationId}`);
      const systemQuantity = q ? dec(q.onHand) : ZERO;
      const countedQuantity = dec(l.countedQuantity);
      const difference = countedQuantity.minus(systemQuantity);

      return {
        productId: l.productId,
        locationId: l.locationId,
        systemQuantity,
        countedQuantity,
        difference,
      };
    });

    const reference = await referenceService.nextReference(tx, REFERENCE_PREFIX.ADJUSTMENT);

    return tx.adjustment.create({
      data: {
        reference,
        warehouseId,
        reason: reason || null,
        createdById: req.user.id,
        state: DOC_STATES.DRAFT,
        lines: {
          create: processedLines,
        },
      },
      include: {
        warehouse: true,
        lines: {
          include: {
            product: true,
            location: true,
          },
        },
      },
    });
  });

  await auditService.log({
    userId: req.user.id,
    action: 'CREATE',
    entityType: 'ADJUSTMENT',
    entityId: adjustment.id,
    metadata: { reference: adjustment.reference },
  });

  res.status(201).json({
    status: 'success',
    data: adjustment,
  });
};

const update = async (req, res) => {
  const { id } = req.valid.params;
  const { warehouseId, reason, lines } = req.valid.body;

  const current = await prisma.adjustment.findUnique({ where: { id }, include: { lines: true } });
  if (!current) throw notFound('Adjustment not found');
  assertWarehouseAccess(req.user, current.warehouseId);

  if (current.state !== DOC_STATES.DRAFT) {
    throw badRequest('Only DRAFT adjustments can be edited');
  }

  if (warehouseId && warehouseId !== current.warehouseId) {
    assertWarehouseAccess(req.user, warehouseId);
  }

  const finalWarehouseId = warehouseId || current.warehouseId;
  await validateAdjustmentLocations(finalWarehouseId, lines);

  const updated = await prisma.$transaction(async (tx) => {
    await tx.adjustmentLine.deleteMany({ where: { adjustmentId: id } });

    const quants = await tx.stockQuant.findMany({
      where: {
        OR: lines.map((l) => ({
          productId: l.productId,
          locationId: l.locationId,
        })),
      },
    });

    const quantMap = new Map(quants.map((q) => [`${q.productId}|${q.locationId}`, q]));

    const processedLines = lines.map((l) => {
      const q = quantMap.get(`${l.productId}|${l.locationId}`);
      const systemQuantity = q ? dec(q.onHand) : ZERO;
      const countedQuantity = dec(l.countedQuantity);
      const difference = countedQuantity.minus(systemQuantity);

      return {
        productId: l.productId,
        locationId: l.locationId,
        systemQuantity,
        countedQuantity,
        difference,
      };
    });

    return tx.adjustment.update({
      where: { id },
      data: {
        warehouseId: finalWarehouseId,
        reason: reason !== undefined ? reason : current.reason,
        lines: {
          create: processedLines,
        },
      },
      include: {
        warehouse: true,
        lines: {
          include: {
            product: true,
            location: true,
          },
        },
      },
    });
  });

  await auditService.log({
    userId: req.user.id,
    action: 'UPDATE',
    entityType: 'ADJUSTMENT',
    entityId: id,
    metadata: { reference: updated.reference },
  });

  res.status(200).json({ status: 'success', data: updated });
};

const changeState = async (req, res) => {
  const { id } = req.valid.params;
  const { state: newState } = req.valid.body;

  const current = await prisma.adjustment.findUnique({ where: { id } });
  if (!current) throw notFound('Adjustment not found');
  assertWarehouseAccess(req.user, current.warehouseId);

  const updated = await prisma.$transaction((tx) =>
    documentService.transition(tx, {
      document: tx.adjustment,
      documentId: id,
      to: newState,
    }),
  );

  await auditService.log({
    userId: req.user.id,
    action: 'TRANSITION',
    entityType: 'ADJUSTMENT',
    entityId: id,
    metadata: { from: current.state, to: newState },
  });

  res.status(200).json({ status: 'success', data: updated });
};

const cancel = async (req, res) => {
  const { id } = req.valid.params;

  const current = await prisma.adjustment.findUnique({ where: { id } });
  if (!current) throw notFound('Adjustment not found');
  assertWarehouseAccess(req.user, current.warehouseId);

  const updated = await prisma.$transaction((tx) =>
    documentService.transition(tx, {
      document: tx.adjustment,
      documentId: id,
      to: DOC_STATES.CANCELLED,
    }),
  );

  await auditService.log({
    userId: req.user.id,
    action: 'CANCEL',
    entityType: 'ADJUSTMENT',
    entityId: id,
    metadata: { reference: updated.reference },
  });

  res.status(200).json({ status: 'success', data: updated });
};

const validate = async (req, res) => {
  const { id } = req.valid.params;

  const adjustment = await prisma.adjustment.findUnique({ where: { id }, include: { lines: true } });
  if (!adjustment) throw notFound('Adjustment not found');
  assertWarehouseAccess(req.user, adjustment.warehouseId);

  const result = await idempotencyService.withIdempotency({
    key: req.idempotencyKey,
    endpoint: `validate-adjustment-${id}`,
    userId: req.user.id,
    payload: req.body,
    handler: async (tx) => {
      const current = await tx.adjustment.findUnique({ where: { id }, include: { lines: true } });
      documentService.assertCanValidate(current.state);

      if (current.lines.length === 0) {
        throw badRequest('An adjustment with no lines cannot be validated', 'ADJUSTMENT_NO_LINES');
      }

      // Find warehouse SCRAP location for write-offs and write-backs
      const scrapLocation = await tx.location.findFirst({
        where: { warehouseId: current.warehouseId, type: LOCATION_TYPES.SCRAP, isActive: true },
      });
      if (!scrapLocation) {
        throw badRequest('No active SCRAP location found for this warehouse', 'SCRAP_LOCATION_MISSING');
      }

      // Sort lines deterministically
      const sortedLines = [...current.lines].sort((a, b) => {
        const keyA = `${a.productId}|${a.locationId}`;
        const keyB = `${b.productId}|${b.locationId}`;
        return keyA.localeCompare(keyB);
      });

      for (const line of sortedLines) {
        // Ensure and lock quant
        await inventoryService.ensureQuant(tx, line.productId, line.locationId);
        const quant = await inventoryService.lockQuant(tx, line.productId, line.locationId);

        // Stale count verification
        if (!quant.onHand.equals(dec(line.systemQuantity))) {
          throw conflict(
            `Stock changed since physical count: recorded system on-hand was ${line.systemQuantity}, but current on-hand is ${quant.onHand}. Please recount and submit a fresh adjustment.`,
            'STALE_ADJUSTMENT',
          );
        }

        // Reservation safety check: counted quantity cannot drop below already reserved units
        if (dec(line.countedQuantity).lt(quant.reservedQuantity)) {
          throw unprocessable(
            `Counted quantity (${line.countedQuantity}) cannot be less than active reserved stock (${quant.reservedQuantity}). Release pending reservations before adjusting.`,
            'ADJUSTMENT_BELOW_RESERVED',
          );
        }

        const diff = dec(line.countedQuantity).minus(quant.onHand);

        if (diff.gt(ZERO)) {
          // Positive adjustment: write-back SCRAP -> INTERNAL (+diff)
          await inventoryService.executeMove(tx, {
            productId: line.productId,
            fromLocationId: scrapLocation.id,
            toLocationId: line.locationId,
            quantity: diff,
            documentType: DOCUMENT_TYPES.ADJUSTMENT,
            documentId: current.id,
            reference: current.reference,
            createdById: req.user.id,
          });
        } else if (diff.lt(ZERO)) {
          // Negative adjustment: write-off INTERNAL -> SCRAP (-diff)
          await inventoryService.executeMove(tx, {
            productId: line.productId,
            fromLocationId: line.locationId,
            toLocationId: scrapLocation.id,
            quantity: diff.abs(),
            documentType: DOCUMENT_TYPES.ADJUSTMENT,
            documentId: current.id,
            reference: current.reference,
            createdById: req.user.id,
          });
        }
        // If diff === 0, no stock movement required
      }

      const updated = await documentService.finalize(tx, {
        document: tx.adjustment,
        documentId: id,
        data: { validatedById: req.user.id },
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
      entityType: 'ADJUSTMENT',
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
