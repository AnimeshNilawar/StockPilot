const { z } = require('zod');
const { paginationSchema } = require('../utils/query');
const { DOC_STATE_VALUES } = require('../domain/documentState');

const list = z
  .object({
    search: z.string().trim().optional(),
    warehouseId: z.string().uuid().optional(),
    state: z.enum([...DOC_STATE_VALUES]).optional(),
  })
  .extend(paginationSchema.shape);

const line = z.object({
  productId: z.string().uuid('Product ID must be a valid UUID'),
  locationId: z.string().uuid('Location ID must be a valid UUID'),
  countedQuantity: z
    .union([z.string(), z.number()])
    .transform((value) => String(value).trim())
    .refine((value) => !isNaN(Number(value)) && Number(value) >= 0, 'Counted quantity must be non-negative'),
});

const create = z.object({
  warehouseId: z.string().uuid('Warehouse ID must be a valid UUID'),
  reason: z.string().trim().max(500).optional(),
  lines: z.array(line).min(1, 'At least one line is required'),
});

const idParam = z.object({
  id: z.string().uuid('Invalid adjustment ID'),
});

const edit = create;

const transition = z.object({
  state: z.literal('READY'),
});

module.exports = {
  list,
  create,
  edit,
  transition,
  idParam,
};
