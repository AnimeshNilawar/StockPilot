const { Prisma } = require('@prisma/client');
const { prisma } = require('../lib/prisma');
const { parsePagination, paginated, optionalDate } = require('../utils/query');
const { notFound, badRequest, forbidden } = require('../utils/appError');
const { assertWarehouseAccess, canAccessWarehouse } = require('../middleware/access.middleware');
const { isWarehouseScoped, warehouseIdsOf } = require('../domain/roles');
const { DOC_STATE_VALUES } = require('../domain/documentState');
const {
  DOCUMENT_TYPE_VALUES,
  REFERENCE_PREFIX,
  inferDocumentType,
} = require('../domain/documentType');
const inventoryService = require('../services/inventory.service');
const idempotencyService = require('../services/idempotency.service');
const referenceService = require('../services/reference.service');

const ZERO = new Prisma.Decimal(0);

/** Adds the derived free-to-use figure and low-stock flag to a quant row. */
const decorate = (quant) => {
  const onHand = new Prisma.Decimal(quant.onHand);
  const reservedQuantity = new Prisma.Decimal(quant.reservedQuantity);
  const reorderMin = new Prisma.Decimal(quant.product.reorderMin || 0);

  return {
    productId: quant.productId,
    locationId: quant.locationId,
    product: quant.product,
    location: quant.location,
    onHand,
    reservedQuantity,
    freeToUse: onHand.minus(reservedQuantity),
    reorderMin,
    isLowStock: onHand.lte(reorderMin),
  };
};

/**
 * `warehouseId` restriction for quant/move queries.
 *
 * Warehouse-scoped roles are pinned to their assignments, and asking for a
 * warehouse they are not assigned to is an error rather than something to
 * silently ignore — otherwise the response would look like it answered the
 * question when it did not. ADMIN and INVENTORY_MANAGER may narrow to any single
 * warehouse they name.
 */
const warehouseFilter = (user, requested) => {
  if (isWarehouseScoped(user)) {
    if (requested && !canAccessWarehouse(user, requested)) {
      throw forbidden('No access to this warehouse');
    }
    return { warehouseId: { in: warehouseIdsOf(user) } };
  }
  return requested ? { warehouseId: requested } : {};
};

/**
 * Same rule for the ledger. A move belongs to a warehouse when *either* of its
 * two locations does, so the restriction has to span both relations.
 */
const moveWarehouseScope = (user, requested) => {
  if (isWarehouseScoped(user)) {
    if (requested && !canAccessWarehouse(user, requested)) {
      throw forbidden('No access to this warehouse');
    }
    return {
      OR: [
        { fromLocation: { warehouseId: { in: warehouseIdsOf(user) } } },
        { toLocation: { warehouseId: { in: warehouseIdsOf(user) } } },
      ],
    };
  }
  return requested
    ? {
        OR: [
          { fromLocation: { warehouseId: requested } },
          { toLocation: { warehouseId: requested } },
        ],
      }
    : undefined;
};

class StockController {
  /**
   * Current per-(product, location) balances.
   *
   * The warehouse restriction is part of the query, not a post-filter, so a
   * crafted `warehouseId` parameter can never widen the result set.
   */
  async listQuants(req, res) {
    const { page, pageSize, skip, take } = parsePagination(req.valid.query);
    const { search, productId, locationId, warehouseId, categoryId, nonZero } = req.valid.query;

    const productFilter = {
      ...(categoryId ? { categoryId } : {}),
      ...(search
        ? {
            OR: [
              { sku: { contains: search, mode: 'insensitive' } },
              { name: { contains: search, mode: 'insensitive' } },
            ],
          }
        : {}),
    };

    const where = {
      ...(productId ? { productId } : {}),
      ...(locationId ? { locationId } : {}),
      ...(nonZero ? { onHand: { not: ZERO } } : {}),
      ...(Object.keys(productFilter).length > 0 ? { product: productFilter } : {}),
      location: { isActive: true, ...warehouseFilter(req.user, warehouseId) },
    };

    const [rows, total] = await Promise.all([
      prisma.stockQuant.findMany({
        where,
        orderBy: [{ locationId: 'asc' }, { productId: 'asc' }],
        skip,
        take,
        include: {
          product: {
            select: {
              id: true,
              sku: true,
              name: true,
              reorderMin: true,
              uom: { select: { code: true } },
            },
          },
          location: {
            select: {
              id: true,
              name: true,
              shortCode: true,
              type: true,
              warehouseId: true,
              warehouse: { select: { id: true, name: true, shortCode: true } },
            },
          },
        },
      }),
      prisma.stockQuant.count({ where }),
    ]);

    res.status(200).json({
      success: true,
      data: paginated(rows.map(decorate), total, { page, pageSize }),
    });
  }

  /**
   * Products at or below their reorder minimum (`onHand <= reorderMin`).
   * Compared per product because the threshold lives on the product, not the
   * quant — one row per product, so pagination stays exact.
   */
  async lowStock(req, res) {
    const { page, pageSize, skip, take } = parsePagination(req.valid.query);
    const { search, categoryId, warehouseId } = req.valid.query;

    const productWhere = {
      isActive: true,
      ...(categoryId ? { categoryId } : {}),
      ...(search
        ? {
            OR: [
              { sku: { contains: search, mode: 'insensitive' } },
              { name: { contains: search, mode: 'insensitive' } },
            ],
          }
        : {}),
    };

    const products = await prisma.product.findMany({
      where: productWhere,
      orderBy: { sku: 'asc' },
      select: {
        id: true,
        sku: true,
        name: true,
        reorderMin: true,
        category: { select: { id: true, name: true } },
        uom: { select: { code: true, name: true } },
      },
    });

    const totals = await prisma.stockQuant.groupBy({
      by: ['productId'],
      where: { location: { isActive: true, ...warehouseFilter(req.user, warehouseId) } },
      _sum: { onHand: true, reservedQuantity: true },
    });
    const totalByProduct = new Map(totals.map((row) => [row.productId, row._sum]));

    const rows = products
      .map((product) => {
        const sums = totalByProduct.get(product.id) || {};
        const onHand = new Prisma.Decimal(sums.onHand || 0);
        const reservedQuantity = new Prisma.Decimal(sums.reservedQuantity || 0);
        return {
          ...product,
          onHand,
          reservedQuantity,
          freeToUse: onHand.minus(reservedQuantity),
          shortfall: new Prisma.Decimal(product.reorderMin || 0).minus(onHand),
          isOutOfStock: onHand.lte(0),
        };
      })
      .filter((row) => row.onHand.lte(new Prisma.Decimal(row.reorderMin || 0)));

    res.status(200).json({
      success: true,
      data: paginated(rows.slice(skip, skip + take), rows.length, { page, pageSize }),
    });
  }

  /** Warehouse-level roll-up per product: on hand, reserved and free. */
  async summary(req, res) {
    const { productIds, warehouseId } = req.valid.query;

    const rows = await prisma.stockQuant.groupBy({
      by: ['productId'],
      where: {
        ...(productIds.length > 0 ? { productId: { in: productIds } } : {}),
        location: { isActive: true, ...warehouseFilter(req.user, warehouseId) },
      },
      _sum: { onHand: true, reservedQuantity: true },
    });

    const products = await prisma.product.findMany({
      where: { id: { in: rows.map((row) => row.productId) } },
      select: {
        id: true,
        sku: true,
        name: true,
        reorderMin: true,
        uom: { select: { code: true } },
      },
    });
    const productById = new Map(products.map((product) => [product.id, product]));

    const data = rows
      .map((row) => {
        const onHand = new Prisma.Decimal(row._sum.onHand || 0);
        const reservedQuantity = new Prisma.Decimal(row._sum.reservedQuantity || 0);
        return {
          productId: row.productId,
          product: productById.get(row.productId) || null,
          onHand,
          reservedQuantity,
          freeToUse: onHand.minus(reservedQuantity),
        };
      })
      .sort((a, b) => String(a.product?.sku || '').localeCompare(String(b.product?.sku || '')));

    res.status(200).json({ success: true, data });
  }

  /**
   * Ledger reconciliation: recompute balances from the immutable move history
   * and compare them against the cached quants. Any difference is reported as a
   * `mismatches` entry instead of throwing, so the check can run in CI.
   */
  async reconcile(req, res) {
    const { productId, warehouseId } = req.valid.query;

    const where = {
      ...(productId ? { productId } : {}),
      location: { ...warehouseFilter(req.user, warehouseId) },
    };

    const [quants, products] = await Promise.all([
      prisma.stockQuant.findMany({ where }),
      prisma.product.findMany({
        where: {
          ...(productId ? { id: productId } : {}),
          quants: { some: where },
        },
        select: { id: true, sku: true, name: true },
      }),
    ]);

    const mismatches = [];

    for (const product of products) {
      const fromLedger = await inventoryService.ledgerBalances(product.id);
      const cached = new Map(
        quants
          .filter((quant) => quant.productId === product.id)
          .map((quant) => [quant.locationId, new Prisma.Decimal(quant.onHand)]),
      );

      const locationIds = new Set([...fromLedger.keys(), ...cached.keys()]);
      for (const locationId of locationIds) {
        const expected = fromLedger.get(locationId) || ZERO;
        const actual = cached.get(locationId) || ZERO;
        if (!expected.equals(actual)) {
          mismatches.push({
            productId: product.id,
            sku: product.sku,
            locationId,
            ledgerOnHand: expected,
            quantOnHand: actual,
          });
        }
      }
    }

    res.status(200).json({
      success: true,
      data: { checkedProducts: products.length, checkedQuants: quants.length, mismatches },
    });
  }

  /** The immutable ledger, read-only by design. */
  async listMoves(req, res) {
    const { page, pageSize, skip, take } = parsePagination(req.valid.query);
    const {
      reference,
      search,
      productId,
      fromLocationId,
      toLocationId,
      warehouseId,
      categoryId,
      state,
      documentType,
      documentId,
      dateFrom,
      dateTo,
    } = req.valid.query;

    const stateFilter = state ? String(state).toUpperCase() : undefined;
    if (stateFilter && !DOC_STATE_VALUES.includes(stateFilter)) {
      throw badRequest(`state must be one of ${DOC_STATE_VALUES.join(', ')}`, 'VALIDATION_ERROR');
    }
    if (documentType && !DOCUMENT_TYPE_VALUES.includes(documentType)) {
      throw badRequest(
        `documentType must be one of ${DOCUMENT_TYPE_VALUES.join(', ')}`,
        'VALIDATION_ERROR',
      );
    }

    // A move belongs to a warehouse when either of its locations does; a
    // warehouse-scoped role may only see moves inside its own warehouses.
    const locationScope = moveWarehouseScope(req.user, warehouseId);

    const where = {
      ...(reference ? { reference: { contains: reference, mode: 'insensitive' } } : {}),
      ...(productId ? { productId } : {}),
      ...(fromLocationId ? { fromLocationId } : {}),
      ...(toLocationId ? { toLocationId } : {}),
      ...(documentType ? { documentType } : {}),
      ...(documentId ? { documentId } : {}),
      ...(stateFilter ? { state: stateFilter } : {}),
      ...(categoryId ? { product: { categoryId } } : {}),
      ...(search
        ? {
            OR: [
              { reference: { contains: search, mode: 'insensitive' } },
              { product: { sku: { contains: search, mode: 'insensitive' } } },
              { product: { name: { contains: search, mode: 'insensitive' } } },
            ],
          }
        : {}),
      ...(dateFrom || dateTo
        ? {
            doneDate: {
              ...(dateFrom ? { gte: optionalDate(dateFrom, 'dateFrom') } : {}),
              ...(dateTo ? { lte: optionalDate(dateTo, 'dateTo') } : {}),
            },
          }
        : {}),
      ...(locationScope ? { AND: [locationScope] } : {}),
    };

    const [rows, total] = await Promise.all([
      prisma.stockMove.findMany({
        where,
        orderBy: [{ doneDate: 'desc' }, { id: 'desc' }],
        skip,
        take,
        include: {
          product: { select: { id: true, sku: true, name: true, uom: { select: { code: true } } } },
          fromLocation: {
            select: { id: true, name: true, shortCode: true, type: true, warehouseId: true },
          },
          toLocation: {
            select: { id: true, name: true, shortCode: true, type: true, warehouseId: true },
          },
        },
      }),
      prisma.stockMove.count({ where }),
    ]);

    res.status(200).json({ success: true, data: paginated(rows, total, { page, pageSize }) });
  }

  async getMove(req, res) {
    const move = await prisma.stockMove.findUnique({
      where: { id: req.valid.params.id },
      include: {
        product: { select: { id: true, sku: true, name: true, uom: { select: { code: true } } } },
        fromLocation: {
          select: {
            id: true,
            name: true,
            shortCode: true,
            type: true,
            warehouse: { select: { name: true } },
          },
        },
        toLocation: {
          select: {
            id: true,
            name: true,
            shortCode: true,
            type: true,
            warehouse: { select: { name: true } },
          },
        },
      },
    });
    if (!move) throw notFound('Stock move not found');

    if (isWarehouseScoped(req.user)) {
      const allowed = new Set(warehouseIdsOf(req.user));
      if (
        !allowed.has(move.fromLocation.warehouseId) &&
        !allowed.has(move.toLocation.warehouseId)
      ) {
        throw forbidden('No access to this warehouse');
      }
    }

    res.status(200).json({ success: true, data: move });
  }

  /**
   * Engine-level direct movement: the Phase 3 primitive that the Phase 4-6
   * documents are built from, also usable for ad-hoc transfers.
   *
   * Requires an `Idempotency-Key` — retrying after a network timeout must never
   * move stock twice.
   */
  async createDirectMove(req, res) {
    const body = req.valid.body;
    const key = req.idempotencyKey;

    // Availability check, both quant updates, the ledger write and the
    // idempotency record all commit inside one transaction.
    const outcome = await idempotencyService.withIdempotency({
      key,
      endpoint: 'POST /api/v1/moves',
      userId: req.user.id,
      payload: body,
      handler: async (tx) => {
        const [fromLocation, toLocation] = await Promise.all([
          tx.location.findUnique({ where: { id: body.fromLocationId } }),
          tx.location.findUnique({ where: { id: body.toLocationId } }),
        ]);

        for (const location of [fromLocation, toLocation]) {
          if (!location) throw badRequest('Location not found', 'LOCATION_NOT_FOUND');
          assertWarehouseAccess(req.user, location.warehouseId);
        }

        // The endpoints decide the document type unless the caller is explicit,
        // which keeps the ledger's `documentType` column meaningful.
        const documentType =
          body.documentType || inferDocumentType(fromLocation.type, toLocation.type);
        const reference = await referenceService.nextReference(tx, REFERENCE_PREFIX[documentType]);
        const { move } = await inventoryService.executeMove(tx, {
          productId: body.productId,
          fromLocationId: body.fromLocationId,
          toLocationId: body.toLocationId,
          quantity: body.quantity,
          documentType,
          documentId: `direct:${reference}`,
          reference,
          scheduledDate: body.scheduledDate || null,
          createdById: req.user.id,
        });

        await tx.auditLog.create({
          data: {
            userId: req.user.id,
            action: 'STOCK_MOVED',
            entityType: 'StockMove',
            entityId: move.id,
            metadata: {
              reference,
              documentType,
              productId: body.productId,
              fromLocationId: body.fromLocationId,
              toLocationId: body.toLocationId,
              quantity: body.quantity,
              reason: body.reason || null,
            },
            ip: req.ip,
          },
        });

        return { statusCode: 201, body: { success: true, data: { ...move, replayed: false } } };
      },
    });

    if (outcome.replayed) res.set('Idempotent-Replay', 'true');
    res.status(outcome.replayed ? 200 : outcome.statusCode).json(outcome.body);
  }
}

module.exports = new StockController();
