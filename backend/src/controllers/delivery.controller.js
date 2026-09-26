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
const { LOCATION_TYPES, isStockHolding } = require('../domain/location');
const { DOC_STATES } = require('../domain/documentState');
const { isCustomer } = require('../domain/partner');
const { assertWarehouseAccess, applyWarehouseScope } = require('../middleware/access.middleware');

const dec = (value) => (value instanceof Prisma.Decimal ? value : new Prisma.Decimal(value));
const ZERO = new Prisma.Decimal(0);

/**
 * Deliveries — goods leaving the building.
 *
 * A delivery is a receipt run backwards, with one step receipts do not need:
 * picking. Outbound stock is contended, so a delivery must *claim* its units
 * before it ships them, and validation then consumes that claim:
 *
 *   create ──► DRAFT ──► WAITING ──► pick ──► READY ──► validate ──► DONE
 *      └──────────────────────┴──────────────┴────────► CANCELLED
 *
 * READY is reachable only through `pick`, which reserves the stock. That is the
 * whole design in one rule: the document's state is the single record of whether
 * a reservation exists, so the two can never disagree. Editing is therefore
 * limited to DRAFT as well — a picked delivery's quantities are frozen, because
 * changing them would invalidate the claim it holds on real stock.
 */

/**
 * Identifies one (product, location) balance.
 *
 * Takes the two ids separately rather than reading them off a record, because
 * the two shapes spell the location differently: a `DeliveryLine` calls it
 * `sourceLocationId` while a `StockQuant` calls it `locationId`. Keying both
 * through here is what lets a document line be matched to its balance.
 */
const quantKey = (productId, locationId) => `${productId}|${locationId}`;

const lineQuantKey = (line) => quantKey(line.productId, line.sourceLocationId);

/**
 * Lines sorted into the order the inventory engine locks their quant rows.
 *
 * The engine always locks a product/location pair in ascending id order, so
 * applying that same order across a whole document is what stops two deliveries
 * whose lines overlap in a different order from deadlocking against each other.
 */
const sortByQuantKey = (lines) =>
  [...lines].sort((a, b) => lineQuantKey(a).localeCompare(lineQuantKey(b)));

/**
 * Collapses lines into one entry per (product, source location) pair.
 *
 * A delivery may legitimately name the same product twice against the same
 * location, and reserving or releasing those one at a time would take the same
 * row lock repeatedly — and could let each half individually fit inside
 * free-to-use while their sum does not.
 */
const collapseByQuant = (lines) => {
  const totals = new Map();

  for (const line of sortByQuantKey(lines)) {
    const key = lineQuantKey(line);
    const existing = totals.get(key);

    if (existing) {
      existing.quantity = existing.quantity.plus(dec(line.quantity));
    } else {
      totals.set(key, {
        productId: line.productId,
        locationId: line.sourceLocationId,
        quantity: dec(line.quantity),
      });
    }
  }

  return [...totals.values()];
};

const list = async (req, res) => {
  const { page, pageSize, skip, take } = parsePagination(req.valid.query);
  const { warehouseId, partnerId, state, search } = req.valid.query;

  const where = {};
  if (state) where.state = state;
  if (partnerId) where.partnerId = partnerId;

  if (warehouseId) {
    assertWarehouseAccess(req.user, warehouseId);
    where.warehouseId = warehouseId;
  } else {
    // Only warehouse-scoped roles are pinned to their assignments; naming a
    // warehouse is checked above, so a crafted id can never widen the result.
    Object.assign(where, applyWarehouseScope(req.user));
  }

  if (search) {
    where.OR = [
      { reference: { contains: search, mode: 'insensitive' } },
      { partner: { name: { contains: search, mode: 'insensitive' } } },
    ];
  }

  const [total, deliveries] = await Promise.all([
    prisma.delivery.count({ where }),
    prisma.delivery.findMany({
      where,
      include: {
        warehouse: { select: { name: true } },
        partner: { select: { name: true } },
        lines: {
          include: {
            product: { select: { sku: true, name: true, uom: true } },
            sourceLocation: { select: { name: true } },
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
    data: paginated(deliveries, total, { page, pageSize }),
  });
};

const getById = async (req, res) => {
  const { id } = req.valid.params;

  const delivery = await prisma.delivery.findUnique({
    where: { id },
    include: {
      warehouse: { select: { id: true, name: true, shortCode: true } },
      partner: { select: { id: true, name: true } },
      lines: {
        include: {
          product: { select: { id: true, sku: true, name: true, uom: true } },
          sourceLocation: { select: { id: true, name: true, type: true } },
        },
      },
    },
  });

  if (!delivery) throw notFound('Delivery not found');
  assertWarehouseAccess(req.user, delivery.warehouseId);

  res.status(200).json({
    status: 'success',
    data: delivery,
  });
};

/**
 * A delivery ships *out of* a real location, so every source must be inside the
 * delivery's own warehouse and must actually hold a balance. A boundary node
 * never has one, so naming a vendor or customer dock as a source is rejected
 * here rather than failing at pick time.
 */
const validateSources = async (warehouseId, lines) => {
  for (const line of lines) {
    const location = await prisma.location.findUnique({
      where: { id: line.sourceLocationId },
    });

    if (!location) throw badRequest(`Location ${line.sourceLocationId} not found`);

    if (location.warehouseId !== warehouseId) {
      throw badRequest(`Location ${location.name} does not belong to warehouse ${warehouseId}`);
    }

    if (!isStockHolding(location.type)) {
      throw badRequest(
        `Location ${location.name} is a boundary location and cannot be a delivery source`,
      );
    }

    if (!location.isActive) {
      throw badRequest(`Location ${location.name} is inactive`);
    }
  }
};

/**
 * A delivery is goods leaving for a customer, so the partner must be allowed to
 * buy. A supplier-only partner is rejected here rather than at pick time, where
 * the failure would be reported as if it were a stock problem.
 */
const assertPartnerCanBuy = async (partnerId) => {
  const partner = await prisma.partner.findUnique({ where: { id: partnerId } });

  if (!partner) throw badRequest('Partner not found');
  if (!partner.isActive) throw badRequest(`Partner ${partner.name} is inactive`);
  if (!isCustomer(partner.type)) {
    throw badRequest(
      `Partner ${partner.name} only supplies goods and cannot receive a delivery`,
      'INVALID_PARTNER_TYPE',
    );
  }

  return partner;
};

const create = async (req, res) => {
  const { partnerId, warehouseId, lines } = req.valid.body;

  assertWarehouseAccess(req.user, warehouseId);
  await validateSources(warehouseId, lines);
  await assertPartnerCanBuy(partnerId);

  const delivery = await prisma.$transaction(async (tx) => {
    const reference = await referenceService.nextReference(tx, REFERENCE_PREFIX.DELIVERY);

    return tx.delivery.create({
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
            sourceLocationId: line.sourceLocationId,
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
    entityType: 'DELIVERY',
    entityId: delivery.id,
    metadata: { reference: delivery.reference },
  });

  res.status(201).json({
    status: 'success',
    data: delivery,
  });
};

const update = async (req, res) => {
  const { id } = req.valid.params;
  const { partnerId, warehouseId, lines } = req.valid.body;

  const current = await prisma.delivery.findUnique({ where: { id }, include: { lines: true } });
  if (!current) throw notFound('Delivery not found');
  assertWarehouseAccess(req.user, current.warehouseId);

  // Editing is DRAFT-only by design, not just convention: from WAITING on, the
  // document may already hold a reservation, and silently changing the lines
  // would leave that claim describing stock nobody is shipping.
  if (current.state !== DOC_STATES.DRAFT) {
    throw badRequest('Only DRAFT deliveries can be edited');
  }

  if (warehouseId && warehouseId !== current.warehouseId) {
    assertWarehouseAccess(req.user, warehouseId);
  }

  const finalWarehouseId = warehouseId || current.warehouseId;
  await validateSources(finalWarehouseId, lines);
  await assertPartnerCanBuy(partnerId);

  const updated = await prisma.$transaction(async (tx) => {
    await tx.deliveryLine.deleteMany({ where: { deliveryId: id } });

    return tx.delivery.update({
      where: { id },
      data: {
        partnerId,
        warehouseId: finalWarehouseId,
        lines: {
          create: lines.map((line) => ({
            productId: line.productId,
            quantity: line.quantity,
            sourceLocationId: line.sourceLocationId,
          })),
        },
      },
      include: { lines: true, partner: true },
    });
  });

  await auditService.log({
    userId: req.user.id,
    action: 'UPDATE',
    entityType: 'DELIVERY',
    entityId: id,
    metadata: { reference: updated.reference },
  });

  res.status(200).json({ status: 'success', data: updated });
};

const changeState = async (req, res) => {
  const { id } = req.valid.params;
  const { state: newState } = req.valid.body;

  const current = await prisma.delivery.findUnique({ where: { id } });
  if (!current) throw notFound('Delivery not found');
  assertWarehouseAccess(req.user, current.warehouseId);

  // The state read above is only used for the access check and the audit trail;
  // the write itself is a compare-and-set inside documentService, so a request
  // that raced another one is rejected instead of clobbering it.
  const updated = await prisma.$transaction((tx) =>
    documentService.transition(tx, {
      document: tx.delivery,
      documentId: id,
      to: newState,
    }),
  );

  await auditService.log({
    userId: req.user.id,
    action: 'TRANSITION',
    entityType: 'DELIVERY',
    entityId: id,
    metadata: { from: current.state, to: newState },
  });

  res.status(200).json({ status: 'success', data: updated });
};

/**
 * Reserving stock. This is the step that makes an outbound document safe: the
 * quantity is claimed against free-to-use, so a second delivery asking for the
 * same units is refused rather than both being promised the same stock.
 */
const pick = async (req, res) => {
  const { id } = req.valid.params;

  const delivery = await prisma.delivery.findUnique({ where: { id }, include: { lines: true } });
  if (!delivery) throw notFound('Delivery not found');
  assertWarehouseAccess(req.user, delivery.warehouseId);

  const updated = await prisma.$transaction(async (tx) => {
    // Re-read inside the transaction: the lines being reserved and the state
    // being flipped have to be the same snapshot that commits together.
    const current = await tx.delivery.findUnique({ where: { id }, include: { lines: true } });

    // Reserving again would double the claim, so an already-picked delivery is
    // refused up front rather than discovered by the state machine afterwards.
    if (current.state === DOC_STATES.READY) {
      throw conflict('Delivery has already been picked', 'DELIVERY_ALREADY_PICKED');
    }
    if (current.lines.length === 0) {
      throw badRequest('A delivery with no lines cannot be picked', 'DELIVERY_HAS_NO_LINES');
    }

    for (const { productId, locationId, quantity } of collapseByQuant(current.lines)) {
      // `reserve` checks free-to-use under a row lock, so a concurrent pick for
      // the same units is ordered by PostgreSQL rather than interleaved. Any
      // failure rolls the whole transaction back, leaving no partial reservation.
      await inventoryService.reserve(tx, { productId, locationId, quantity });
    }

    return documentService.transition(tx, {
      document: tx.delivery,
      documentId: id,
      to: DOC_STATES.READY,
    });
  });

  await auditService.log({
    userId: req.user.id,
    action: 'PICK',
    entityType: 'DELIVERY',
    entityId: id,
    metadata: { reference: updated.reference },
  });

  res.status(200).json({ status: 'success', data: updated });
};

const cancel = async (req, res) => {
  const { id } = req.valid.params;

  const current = await prisma.delivery.findUnique({ where: { id }, include: { lines: true } });
  if (!current) throw notFound('Delivery not found');
  assertWarehouseAccess(req.user, current.warehouseId);

  const updated = await prisma.$transaction(async (tx) => {
    const fresh = await tx.delivery.findUnique({ where: { id }, include: { lines: true } });

    // A picked delivery is holding a claim on real stock, so returning it is
    // part of cancelling — not a separate step an operator can forget and leave
    // the units stranded. The release runs first and holds the quant row locks
    // until commit, which is what stops a concurrent validation from consuming
    // the same units in between: it blocks on the lock, and whichever of the
    // two loses the state compare-and-set below rolls its own work back.
    if (fresh.state === DOC_STATES.READY) {
      for (const { productId, locationId, quantity } of collapseByQuant(fresh.lines)) {
        await inventoryService.releaseReservation(tx, { productId, locationId, quantity });
      }
    }

    return documentService.transition(tx, {
      document: tx.delivery,
      documentId: id,
      to: DOC_STATES.CANCELLED,
    });
  });

  await auditService.log({
    userId: req.user.id,
    action: 'CANCEL',
    entityType: 'DELIVERY',
    entityId: id,
    metadata: { reference: updated.reference },
  });

  res.status(200).json({ status: 'success', data: updated });
};

const validate = async (req, res) => {
  const { id } = req.valid.params;

  const delivery = await prisma.delivery.findUnique({ where: { id }, include: { lines: true } });
  if (!delivery) throw notFound('Delivery not found');
  assertWarehouseAccess(req.user, delivery.warehouseId);

  const result = await idempotencyService.withIdempotency({
    key: req.idempotencyKey,
    endpoint: `validate-delivery-${id}`,
    userId: req.user.id,
    payload: req.body,
    handler: async (tx) => {
      // Re-read inside the transaction: the reservation being consumed must be
      // the one that exists right up to the commit.
      const current = await tx.delivery.findUnique({ where: { id }, include: { lines: true } });

      // Validation consumes the claim made by picking, so a delivery that was
      // never picked is refused rather than silently shipping unreserved stock.
      // The terminal states are handled first because the state machine has a
      // more specific story for them — "already validated" beats "not picked"
      // when someone re-submits a delivery that has already shipped.
      documentService.assertCanValidate(current.state);

      if (current.state !== DOC_STATES.READY) {
        throw conflict(
          'Delivery must be picked before it can be validated',
          'DELIVERY_NOT_PICKED',
        );
      }

      // The customer side of the movement. A CUSTOMER location is a boundary
      // node, so the goods leave the building without a tracked balance there.
      const customerLocation = await tx.location.findFirst({
        where: { warehouseId: current.warehouseId, type: LOCATION_TYPES.CUSTOMER },
      });
      if (!customerLocation) {
        throw badRequest('No CUSTOMER location found for this warehouse');
      }

      // One ledger row per line, in quant-lock order, so the history explains the
      // document line by line. `consumeOwnReservation` is what makes this legal:
      // the stock is already claimed, so availability is checked against on-hand
      // rather than free-to-use, and the claim is released in the same write.
      for (const line of sortByQuantKey(current.lines)) {
        await inventoryService.executeMove(tx, {
          productId: line.productId,
          fromLocationId: line.sourceLocationId,
          toLocationId: customerLocation.id,
          quantity: line.quantity,
          documentType: DOCUMENT_TYPES.DELIVERY,
          documentId: current.id,
          reference: current.reference,
          createdById: req.user.id,
          consumeOwnReservation: true,
        });
      }

      // Stock is posted, so the state flip is a compare-and-set: a concurrent
      // validation of the same delivery loses the race and its whole
      // transaction, movements included, is rolled back.
      const updated = await documentService.finalize(tx, {
        document: tx.delivery,
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
      entityType: 'DELIVERY',
      entityId: id,
    });
  }

  res.status(result.statusCode).json(result.body);
};

/**
 * Per-line stock availability, so an operator can see whether a delivery can be
 * picked before attempting it rather than after being refused.
 *
 * A READY delivery is the one interesting case: it already holds the claim for
 * its own lines, so that claim is added back before the comparison — otherwise
 * a picked delivery would report itself as unpickable.
 */
const availability = async (req, res) => {
  const { id } = req.valid.params;

  const delivery = await prisma.delivery.findUnique({ where: { id }, include: { lines: true } });
  if (!delivery) throw notFound('Delivery not found');
  assertWarehouseAccess(req.user, delivery.warehouseId);

  const quants = await prisma.stockQuant.findMany({
    where: {
      OR: delivery.lines.map((line) => ({
        productId: line.productId,
        locationId: line.sourceLocationId,
      })),
    },
    select: { productId: true, locationId: true, onHand: true, reservedQuantity: true },
  });

  const quantByKey = new Map(
    quants.map((quant) => [quantKey(quant.productId, quant.locationId), quant]),
  );

  const lines = delivery.lines.map((line) => {
    const quant = quantByKey.get(lineQuantKey(line));
    const onHand = quant ? dec(quant.onHand) : ZERO;
    const reservedQuantity = quant ? dec(quant.reservedQuantity) : ZERO;
    const freeToUse = onHand.minus(reservedQuantity);
    const quantity = dec(line.quantity);
    const ownClaim = delivery.state === DOC_STATES.READY ? quantity : ZERO;

    return {
      lineId: line.id,
      productId: line.productId,
      sourceLocationId: line.sourceLocationId,
      quantity,
      onHand,
      reservedQuantity,
      freeToUse,
      isAvailable: freeToUse.plus(ownClaim).gte(quantity),
    };
  });

  res.status(200).json({
    status: 'success',
    data: {
      deliveryId: delivery.id,
      state: delivery.state,
      lines,
      isPicked: delivery.state === DOC_STATES.READY,
      canPick: lines.length > 0 && lines.every((line) => line.isAvailable),
    },
  });
};

module.exports = {
  list,
  getById,
  availability,
  create,
  update,
  changeState,
  pick,
  cancel,
  validate,
  sortByQuantKey,
  collapseByQuant,
};
