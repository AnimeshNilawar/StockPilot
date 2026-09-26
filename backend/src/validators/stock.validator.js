const { z } = require('zod');
const { paginationSchema, booleanFilter } = require('../utils/query');
const { positiveQuantity } = require('./product.validator');

const idParam = z.object({ id: z.string().uuid('Invalid identifier') });

/** `?warehouseId=` is accepted on the stock read endpoints; `paginated` adds pagination. */
const stockScope = {
  warehouseId: z.string().uuid().optional(),
  categoryId: z.string().uuid().optional(),
  search: z.string().trim().max(120).optional(),
};

// ---------------------------------------------------------------------------
// Balances
// ---------------------------------------------------------------------------

const quantList = z
  .object({
    ...stockScope,
    productId: z.string().uuid().optional(),
    locationId: z.string().uuid().optional(),
    /** `true` = only rows holding stock, `false` = only empty rows. */
    nonZero: booleanFilter(),
  })
  .extend(paginationSchema.shape);

const lowStockList = z.object({ ...stockScope }).extend(paginationSchema.shape);

const dashboardQuery = z.object({
  warehouseId: z.string().uuid().optional(),
  locationId: z.string().uuid().optional(),
  categoryId: z.string().uuid().optional(),
});

const stockSummary = z.object({
  warehouseId: z.string().uuid().optional(),
  productIds: z
    .string()
    .trim()
    .min(1)
    .transform((value) =>
      value
        .split(',')
        .map((id) => id.trim())
        .filter(Boolean),
    )
    .refine((ids) => ids.every((id) => z.string().uuid().safeParse(id).success), {
      message: 'productIds must be a comma-separated list of identifiers',
    }),
});

const reconcile = z.object({
  warehouseId: z.string().uuid().optional(),
  productId: z.string().uuid().optional(),
});

// ---------------------------------------------------------------------------
// Move ledger
// ---------------------------------------------------------------------------

const moveList = z
  .object({
    ...stockScope,
    reference: z.string().trim().max(60).optional(),
    productId: z.string().uuid().optional(),
    fromLocationId: z.string().uuid().optional(),
    toLocationId: z.string().uuid().optional(),
    documentType: z.string().trim().toUpperCase().optional(),
    documentId: z.string().trim().max(60).optional(),
    state: z.string().trim().toUpperCase().optional(),
    dateFrom: z.string().optional(),
    dateTo: z.string().optional(),
  })
  .extend(paginationSchema.shape);

// ---------------------------------------------------------------------------
// Direct movement (the engine's own HTTP surface)
// ---------------------------------------------------------------------------

const directMove = z
  .object({
    productId: z.string().uuid(),
    fromLocationId: z.string().uuid(),
    toLocationId: z.string().uuid(),
    quantity: positiveQuantity,
    /** Omitted for an ad-hoc move: the endpoints determine the type. */
    documentType: z.enum(['RECEIPT', 'DELIVERY', 'INTERNAL', 'ADJUSTMENT']).optional(),
    scheduledDate: z.string().optional(),
    reason: z.string().trim().max(500).optional(),
  })
  .refine((body) => body.fromLocationId !== body.toLocationId, {
    message: 'fromLocationId and toLocationId must be different',
    path: ['toLocationId'],
  })
  .refine((body) => !body.scheduledDate || !Number.isNaN(new Date(body.scheduledDate).getTime()), {
    message: 'scheduledDate must be a valid date',
    path: ['scheduledDate'],
  });

module.exports = {
  idParam,
  quantList,
  lowStockList,
  dashboardQuery,
  stockSummary,
  reconcile,
  moveList,
  directMove,
};
