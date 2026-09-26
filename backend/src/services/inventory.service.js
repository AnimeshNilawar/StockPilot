const { Prisma } = require('@prisma/client');
const { prisma } = require('../lib/prisma');
const { conflict, unprocessable, badRequest } = require('../utils/appError');
const {
  isStockHolding,
  isOrdinaryHolding,
  isBoundary,
  LOCATION_TYPES,
} = require('../domain/location');
const { DOCUMENT_TYPES } = require('../domain/documentType');
const { DOC_STATES } = require('../domain/documentState');

const ZERO = new Prisma.Decimal(0);

/**
 * ============================================================================
 *  THE INVENTORY ENGINE
 * ============================================================================
 *
 * Every stock mutation in StockPilot goes through this module. UI code and
 * controllers never write to `stock_quants` directly.
 *
 * Two tables carry inventory state:
 *
 *   stock_moves  — append-only ledger. Explains *what happened*.
 *   stock_quants — maintained balance cache. Answers *how much is there now*
 *                  without aggregating the whole ledger.
 *
 * Guarantees provided here:
 *
 *   1. Atomicity   — a move plus both quant updates plus the ledger write all
 *                    commit inside a single caller-supplied transaction.
 *   2. Serialisation — quant rows are locked with `SELECT ... FOR UPDATE`, so
 *                    two concurrent validators of the same product/location are
 *                    ordered by PostgreSQL rather than interleaved. Locks are
 *                    always taken in ascending `location_id` order so opposing
 *                    moves can never deadlock.
 *   3. Reservations — outbound availability is always checked against
 *                    free-to-use (`on_hand - reserved_quantity`), so a move can
 *                    never consume stock another document has already reserved.
 *   4. Conservation — for internal moves `total onHand` is unchanged; the
 *                    source decreases by exactly what the destination gains.
 *   5. Decimal arithmetic — NUMERIC/Decimal only, never floats.
 */

const dec = (value) => (value instanceof Prisma.Decimal ? value : new Prisma.Decimal(value));

// ---------------------------------------------------------------------------
// Locking primitives
// ---------------------------------------------------------------------------

/**
 * Creates the quant row when it is missing. Uses a single
 * `INSERT ... ON CONFLICT DO NOTHING` statement rather than Prisma's `upsert`
 * so it can never emit a SELECT-then-INSERT race that deadlocks against another
 * transaction creating the same row.
 */
const ensureQuant = async (tx, productId, locationId) => {
  await tx.$executeRaw`
    INSERT INTO "stock_quants" ("product_id", "location_id", "on_hand", "reserved_quantity", "created_at", "updated_at")
    VALUES (${productId}, ${locationId}, 0, 0, NOW(), NOW())
    ON CONFLICT ("product_id", "location_id") DO NOTHING
  `;
};

/** `SELECT ... FOR UPDATE` on a single quant row. Call after `ensureQuant`. */
const lockQuant = async (tx, productId, locationId) => {
  const rows = await tx.$queryRaw`
    SELECT "product_id" AS "productId", "location_id" AS "locationId",
           "on_hand" AS "onHand", "reserved_quantity" AS "reservedQuantity"
    FROM "stock_quants"
    WHERE "product_id" = ${productId} AND "location_id" = ${locationId}
    FOR UPDATE
  `;

  if (rows.length === 0) {
    throw conflict('Stock quant disappeared during locking', 'QUANT_LOCK_FAILED');
  }

  const row = rows[0];
  return {
    productId: row.productId,
    locationId: row.locationId,
    onHand: dec(row.onHand),
    reservedQuantity: dec(row.reservedQuantity),
    get freeToUse() {
      return dec(row.onHand).minus(dec(row.reservedQuantity));
    },
  };
};

/**
 * Ensures and locks every requested quant in a single, deterministic order.
 * Lock ordering is the deadlock-avoidance strategy for the whole engine.
 */
const lockQuants = async (tx, productId, locationIds) => {
  const unique = [...new Set(locationIds)].sort();

  for (const locationId of unique) {
    await ensureQuant(tx, productId, locationId);
  }

  const locked = [];
  for (const locationId of unique) {
    locked.push(await lockQuant(tx, productId, locationId));
  }

  return locked;
};

// ---------------------------------------------------------------------------
// Read helpers
// ---------------------------------------------------------------------------

const freeToUse = (quant) => dec(quant.onHand).minus(dec(quant.reservedQuantity));

/** Current balances for one product across the given locations. */
const readQuants = (productId, locationIds) =>
  prisma.stockQuant.findMany({
    where: {
      productId,
      ...(locationIds && locationIds.length > 0 ? { locationId: { in: locationIds } } : {}),
    },
    select: { locationId: true, onHand: true, reservedQuantity: true },
  });

/** Raw ledger read used by the reconciliation tests (Phase 3 invariants). */
const ledgerForProduct = (productId) =>
  prisma.stockMove.findMany({
    where: { productId, state: DOC_STATES.DONE },
    orderBy: { doneDate: 'asc' },
    select: {
      id: true,
      documentType: true,
      documentId: true,
      fromLocationId: true,
      toLocationId: true,
      quantity: true,
      doneDate: true,
      fromLocation: { select: { type: true } },
      toLocation: { select: { type: true } },
    },
  });

/**
 * Recomputes on-hand balances from the ledger. Used by the invariant tests to
 * prove the cached quants still match the immutable history.
 */
const ledgerBalances = (productId) => {
  const balances = new Map();
  const add = (locationId, delta) => {
    balances.set(locationId, (balances.get(locationId) || ZERO).plus(delta));
  };

  return prisma.$transaction(async () => {
    const moves = await ledgerForProduct(productId);
    for (const move of moves) {
      const quantity = dec(move.quantity);
      // Only stock-holding locations carry a balance. A receipt's VENDOR side and
      // a delivery's CUSTOMER side are boundary nodes: the engine never creates
      // a quant row for them, so the replay must skip them too.
      if (
        move.fromLocation &&
        isStockHolding(move.fromLocation.type) &&
        !(move.fromLocation.type === LOCATION_TYPES.SCRAP && move.documentType === DOCUMENT_TYPES.ADJUSTMENT)
      ) {
        add(move.fromLocationId, quantity.negated());
      }
      if (move.toLocation && isStockHolding(move.toLocation.type)) {
        add(move.toLocationId, quantity);
      }
    }
    return balances;
  });
};

// ---------------------------------------------------------------------------
// Reservation primitives
// ---------------------------------------------------------------------------

/**
 * Reserves stock without moving it. Rejected when the request exceeds
 * free-to-use, so two pickers can never promise the same units.
 */
const reserve = async (tx, { productId, locationId, quantity }) => {
  const qty = dec(quantity);
  if (qty.lte(0)) {
    throw badRequest('Reservation quantity must be greater than zero', 'INVALID_QUANTITY');
  }

  const [quant] = await lockQuants(tx, productId, [locationId]);
  const available = freeToUse(quant);

  if (available.lt(qty)) {
    throw unprocessable(
      `Insufficient free stock at location ${locationId}: requested ${qty.toString()}, available ${available.toString()}`,
      'INSUFFICIENT_STOCK',
    );
  }

  await tx.stockQuant.update({
    where: { productId_locationId: { productId, locationId } },
    data: { reservedQuantity: { increment: qty } },
  });

  return {
    productId,
    locationId,
    onHand: quant.onHand,
    reservedQuantity: dec(quant.reservedQuantity).plus(qty),
  };
};

/** Releases a reservation. Clamped at zero so repeated calls cannot go negative. */
const releaseReservation = async (tx, { productId, locationId, quantity }) => {
  const qty = dec(quantity);
  if (qty.lte(0)) {
    throw badRequest('Release quantity must be greater than zero', 'INVALID_QUANTITY');
  }

  const [quant] = await lockQuants(tx, productId, [locationId]);
  const remaining = dec(quant.reservedQuantity).minus(qty).lt(0)
    ? ZERO
    : dec(quant.reservedQuantity).minus(qty);

  await tx.stockQuant.update({
    where: { productId_locationId: { productId, locationId } },
    data: { reservedQuantity: remaining },
  });

  return { productId, locationId, reservedQuantity: remaining };
};

// ---------------------------------------------------------------------------
// Movement validation
// ---------------------------------------------------------------------------

const isSameWarehouse = (from, to) => from.warehouseId === to.warehouseId;

/**
 * Enforces the location-type rules for a movement. Runs before any lock is
 * taken so an illegal move never touches stock.
 */
const assertMoveAllowed = ({ fromLocation, toLocation, documentType }) => {
  if (fromLocation.id === toLocation.id) {
    throw badRequest('Source and destination locations must differ', 'INVALID_LOCATIONS');
  }

  if (!isSameWarehouse(fromLocation, toLocation)) {
    throw unprocessable(
      'Cross-warehouse movement is not supported: use an internal transfer through a transit location',
      'CROSS_WAREHOUSE_MOVE',
    );
  }

  if (!isStockHolding(fromLocation.type) && !isStockHolding(toLocation.type)) {
    throw unprocessable(
      'At least one side of the movement must be a stock-holding location',
      'INVALID_LOCATION_TYPES',
    );
  }

  switch (documentType) {
    case DOCUMENT_TYPES.RECEIPT:
      if (!isBoundary(fromLocation.type) || fromLocation.type !== 'VENDOR') {
        throw unprocessable(
          'A receipt must move stock from a VENDOR location into a stock-holding location',
          'INVALID_LOCATION_TYPES',
        );
      }
      if (!isStockHolding(toLocation.type)) {
        throw unprocessable(
          'A receipt destination must be a stock-holding location',
          'INVALID_LOCATION_TYPES',
        );
      }
      break;
    case DOCUMENT_TYPES.DELIVERY:
      if (!isStockHolding(fromLocation.type)) {
        throw unprocessable(
          'A delivery must move stock out of a stock-holding location',
          'INVALID_LOCATION_TYPES',
        );
      }
      if (toLocation.type !== 'CUSTOMER') {
        throw unprocessable(
          'A delivery must move stock into a CUSTOMER location',
          'INVALID_LOCATION_TYPES',
        );
      }
      break;
    case DOCUMENT_TYPES.INTERNAL:
      if (!isStockHolding(fromLocation.type) || !isStockHolding(toLocation.type)) {
        throw unprocessable(
          'An internal movement requires stock-holding locations on both sides',
          'INVALID_LOCATION_TYPES',
        );
      }
      break;
    case DOCUMENT_TYPES.ADJUSTMENT:
      // An adjustment is a stock correction, so it runs between ordinary stock
      // and the scrap bin in one direction or the other: write-off is
      // holding -> SCRAP, write-back is SCRAP -> holding. Anything else is a
      // transfer or a mislabelled document, and posting it as an adjustment
      // would let a quantity discrepancy masquerade as a correction. The
      // ordinary side is deliberately isOrdinaryHolding, not isStockHolding:
      // SCRAP holds stock too, and SCRAP -> SCRAP is a transfer, not a
      // correction.
      if (fromLocation.type === LOCATION_TYPES.SCRAP && isOrdinaryHolding(toLocation.type)) break;
      if (toLocation.type === LOCATION_TYPES.SCRAP && isOrdinaryHolding(fromLocation.type)) break;
      throw unprocessable(
        'An adjustment must move between an ordinary stock-holding location and SCRAP ' +
          '(write-off: stock -> scrap, write-back: scrap -> stock)',
        'INVALID_LOCATION_TYPES',
      );
    default:
      throw badRequest(`Unknown document type: ${documentType}`, 'INVALID_DOCUMENT_TYPE');
  }
};

// ---------------------------------------------------------------------------
// The move executor
// ---------------------------------------------------------------------------

/**
 * Decides whether stock may leave a location, and what the reservation column
 * should read afterwards. Two modes, because a move out of a location can be
 * making two different claims on the same balance:
 *
 *   consumeOwnReservation — the caller picked this document, so these units are
 *     already spoken for and `freeToUse` deliberately excludes them. Checking
 *     free-to-use here would make a fully reserved delivery unpickable-to-ship,
 *     so availability is the raw `onHand` instead, and the reservation is
 *     released in the same write. The claim must still be present: without it
 *     the document would be consuming stock it never reserved, and two
 *     deliveries could then race for the same units.
 *
 *   otherwise — the stock is unclaimed, so availability is free-to-use, and any
 *     reservation the caller passes in is released alongside the movement.
 *
 * @returns the reservation quantity to store after the move.
 */
const planDebit = ({
  quant,
  quantity,
  productSku,
  locationCode,
  consumeOwnReservation,
  releaseReservation,
}) => {
  if (consumeOwnReservation) {
    if (quant.reservedQuantity.lt(quantity)) {
      throw conflict(
        `Reserved stock for product ${productSku} at ${locationCode} is ` +
          `${quant.reservedQuantity.toString()} but the delivery needs ${quantity.toString()}; ` +
          're-pick the delivery',
        'RESERVATION_MISSING',
      );
    }
    return quant.reservedQuantity.minus(quantity);
  }

  const available = freeToUse(quant);
  if (available.lt(quantity)) {
    throw unprocessable(
      `Insufficient stock for product ${productSku} at ${locationCode}: ` +
        `requested ${quantity.toString()}, available ${available.toString()}`,
      'INSUFFICIENT_STOCK',
    );
  }

  return releaseReservation === null
    ? quant.reservedQuantity
    : maxZero(quant.reservedQuantity.minus(dec(releaseReservation)));
};

/**
 * Applies one completed movement.
 *
 * @param tx        Prisma interactive-transaction client.
 * @param params.productId
 * @param params.fromLocationId   location the stock leaves (may be VENDOR).
 * @param params.toLocationId     location the stock arrives at (may be CUSTOMER).
 * @param params.quantity         strictly positive Decimal.
 * @param params.documentType     RECEIPT | DELIVERY | INTERNAL | ADJUSTMENT.
 * @param params.documentId       owning document's id.
 * @param params.reference        human-readable ledger reference.
 * @param params.moveId           pre-created move row to mark done (optional).
 * @param params.releaseReservation quantity of the caller's reservation to
 *        consume alongside the physical movement (delivery validation).
 * @param params.consumeOwnReservation when true the caller holds a reservation
 *        for exactly this quantity from this document's pick step, so the
 *        availability check runs against `onHand` instead of free-to-use and
 *        the reservation is released in the same write.
 * @returns {{ move, before, after }}
 *
 * When the source is a boundary location no quant row is created or decremented:
 * a vendor receipt enters stock without requiring a tracked vendor balance.
 */
const executeMove = async (tx, params) => {
  const {
    productId,
    fromLocationId,
    toLocationId,
    quantity,
    documentType,
    documentId,
    reference,
    scheduledDate = null,
    createdById = null,
    moveId = null,
    releaseReservation: reservationToRelease = null,
    consumeOwnReservation = false,
  } = params;

  const qty = dec(quantity);
  if (qty.lte(0)) {
    throw badRequest('Move quantity must be greater than zero', 'INVALID_QUANTITY');
  }

  const [fromLocation, toLocation, product] = await Promise.all([
    tx.location.findUnique({ where: { id: fromLocationId } }),
    tx.location.findUnique({ where: { id: toLocationId } }),
    tx.product.findUnique({ where: { id: productId } }),
  ]);

  if (!product) {
    throw badRequest('Product not found', 'PRODUCT_NOT_FOUND');
  }
  if (!fromLocation) {
    throw badRequest('Source location not found', 'LOCATION_NOT_FOUND');
  }
  if (!toLocation) {
    throw badRequest('Destination location not found', 'LOCATION_NOT_FOUND');
  }
  if (!product.isActive) {
    throw unprocessable('Cannot move stock for an inactive product', 'PRODUCT_INACTIVE');
  }
  if (!fromLocation.isActive || !toLocation.isActive) {
    throw unprocessable('Cannot move stock through an inactive location', 'LOCATION_INACTIVE');
  }

  assertMoveAllowed({ fromLocation, toLocation, documentType });

  const fromIsStock =
    isStockHolding(fromLocation.type) &&
    !(fromLocation.type === LOCATION_TYPES.SCRAP && documentType === DOCUMENT_TYPES.ADJUSTMENT);
  const toIsStock = isStockHolding(toLocation.type);

  // Locks are taken in a deterministic order to avoid deadlocks.
  const lockable = [fromIsStock && fromLocationId, toIsStock && toLocationId].filter(Boolean);
  const quants = await lockQuants(tx, productId, lockable);
  const byLocation = new Map(quants.map((quant) => [quant.locationId, quant]));

  const fromQuant = byLocation.get(fromLocationId);
  const toQuant = byLocation.get(toLocationId);

  // A move out of a stock-holding location may also change the reservation, so
  // the resulting value is tracked for the returned snapshot below.
  let reservedAfter = fromIsStock ? fromQuant.reservedQuantity : null;

  if (fromIsStock) {
    reservedAfter = planDebit({
      quant: fromQuant,
      quantity: qty,
      productSku: product.sku,
      locationCode: fromLocation.shortCode,
      consumeOwnReservation,
      releaseReservation: reservationToRelease,
    });

    await tx.stockQuant.update({
      where: { productId_locationId: { productId, locationId: fromLocationId } },
      data: {
        onHand: fromQuant.onHand.minus(qty),
        reservedQuantity: reservedAfter,
      },
    });
  }

  if (toIsStock) {
    await tx.stockQuant.update({
      where: { productId_locationId: { productId, locationId: toLocationId } },
      data: { onHand: (toQuant ? toQuant.onHand : ZERO).plus(qty) },
    });
  }

  const doneDate = new Date();
  const move = moveId
    ? await tx.stockMove.update({
        where: { id: moveId },
        data: { state: DOC_STATES.DONE, doneDate },
      })
    : await tx.stockMove.create({
        data: {
          reference,
          productId,
          fromLocationId,
          toLocationId,
          quantity: qty,
          state: DOC_STATES.DONE,
          documentType,
          documentId,
          scheduledDate,
          doneDate,
          createdById,
        },
      });

  return {
    move,
    before: { from: fromQuant || null, to: toQuant || null },
    after: {
      from: fromQuant
        ? { onHand: fromQuant.onHand.minus(qty), reservedQuantity: reservedAfter }
        : null,
      to: { onHand: (toQuant ? toQuant.onHand : ZERO).plus(qty) },
    },
  };
};

/**
 * Consumes a reservation *and* the physical stock in one transaction, checking
 * availability against free-to-use.
 *
 * Note this is *not* how a picked delivery ships: that path goes through
 * `executeMove` with `consumeOwnReservation`, because the units are already
 * reserved and so are excluded from free-to-use. This primitive is the
 * unreserved equivalent — a direct "consume against what's free" operation, kept
 * as part of the engine's public surface for tooling and tests.
 */
const consumeReservation = async (tx, { productId, locationId, quantity }) => {
  const qty = dec(quantity);
  if (qty.lte(0)) {
    throw badRequest('Quantity must be greater than zero', 'INVALID_QUANTITY');
  }

  const [quant] = await lockQuants(tx, productId, [locationId]);
  const available = freeToUse(quant);

  if (available.lt(qty)) {
    throw unprocessable(
      `Insufficient free stock at location ${locationId}: requested ${qty.toString()}, available ${available.toString()}`,
      'INSUFFICIENT_STOCK',
    );
  }

  const reservedAfter = maxZero(quant.reservedQuantity.minus(qty));

  await tx.stockQuant.update({
    where: { productId_locationId: { productId, locationId } },
    data: { onHand: quant.onHand.minus(qty), reservedQuantity: reservedAfter },
  });

  return {
    productId,
    locationId,
    onHand: quant.onHand.minus(qty),
    reservedQuantity: reservedAfter,
  };
};

/** Total on-hand of a product across every location. */
const totalOnHand = async (productId) => {
  const result = await prisma.stockQuant.aggregate({
    where: { productId },
    _sum: { onHand: true },
  });
  return dec(result._sum.onHand || 0);
};

const maxZero = (value) => (value.lt(0) ? ZERO : value);

module.exports = {
  dec,
  ZERO,
  ensureQuant,
  lockQuant,
  lockQuants,
  freeToUse,
  readQuants,
  ledgerForProduct,
  ledgerBalances,
  reserve,
  releaseReservation,
  consumeReservation,
  assertMoveAllowed,
  executeMove,
  totalOnHand,
};
