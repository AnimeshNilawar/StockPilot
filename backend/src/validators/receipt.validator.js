const { z } = require('zod');

const list = z.object({
  page: z.string().optional(),
  pageSize: z.string().optional(),
  warehouseId: z.string().uuid().optional(),
  state: z.string().optional(),
});

const create = z.object({
  supplier: z.string().min(1, 'Supplier is required'),
  warehouseId: z.string().uuid('Warehouse ID must be a valid UUID'),
  lines: z
    .array(
      z.object({
        productId: z.string().uuid('Product ID must be a valid UUID'),
        quantity: z
          .string()
          .refine((val) => !isNaN(Number(val)) && Number(val) > 0, 'Quantity must be positive'),
        destinationLocationId: z.string().uuid('Destination Location ID must be a valid UUID'),
      }),
    )
    .min(1, 'At least one line is required'),
});

const idParam = z.object({
  id: z.string().uuid('Invalid receipt ID'),
});

module.exports = {
  list,
  create,
  idParam,
};
