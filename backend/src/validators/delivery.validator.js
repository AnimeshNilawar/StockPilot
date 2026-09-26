const { z } = require('zod');
const { paginationSchema } = require('../utils/query');
const { DOC_STATE_VALUES } = require('../domain/documentState');

const list = z
  .object({
    search: z.string().trim().optional(),
    warehouseId: z.string().uuid().optional(),
    partnerId: z.string().uuid().optional(),
    state: z.enum([...DOC_STATE_VALUES]).optional(),
  })
  .extend(paginationSchema.shape);

/**
 * Quantities stay strings here and are converted with Prisma.Decimal, so a
 * stock value never passes through a JS float. Identical rule to a receipt line
 * — the sign convention lives in the movement (a delivery always has a source),
 * never in the quantity.
 */
const line = z.object({
  productId: z.string().uuid('Product ID must be a valid UUID'),
  quantity: z
    .union([z.string(), z.number()])
    .transform((value) => String(value).trim())
    .refine((value) => !isNaN(Number(value)) && Number(value) > 0, 'Quantity must be positive'),
  sourceLocationId: z.string().uuid('Source Location ID must be a valid UUID'),
});

const create = z.object({
  partnerId: z.string().uuid('Partner ID must be a valid UUID'),
  warehouseId: z.string().uuid('Warehouse ID must be a valid UUID'),
  lines: z.array(line).min(1, 'At least one line is required'),
});

const idParam = z.object({
  id: z.string().uuid('Invalid delivery ID'),
});

const edit = create;

/**
 * `READY` is deliberately absent: a delivery becomes READY only by picking, which
 * is what reserves the stock. Letting a caller set the state directly would let a
 * delivery reach validation without ever holding a reservation.
 */
const transition = z.object({
  state: z.literal('WAITING'),
});

module.exports = {
  list,
  create,
  edit,
  transition,
  idParam,
};
