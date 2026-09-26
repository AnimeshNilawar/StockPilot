const { z } = require('zod');
const { paginationSchema, booleanFilter } = require('../utils/query');

/**
 * Quantities and money are NUMERIC(14,4) / NUMERIC(14,2) in PostgreSQL. Zod
 * validates them as strings (or coerces from numbers) and the service converts
 * them with Prisma.Decimal, so no stock value ever passes through a JS float.
 */
const DECIMAL_PATTERN = /^-?\d+(\.\d+)?$/;

const decimalString = ({ min = 0, max = 9999999999.9999 } = {}) =>
  z
    .union([z.string(), z.number()])
    .transform((value) => String(value).trim())
    .refine((value) => DECIMAL_PATTERN.test(value), { message: 'Must be a decimal number' })
    .refine((value) => Number(value) >= min && Number(value) <= max, {
      message: `Must be between ${min} and ${max}`,
    });

const quantity = decimalString({ min: -9999999999.9999 });
const nonNegativeQuantity = decimalString({ min: 0 });
const positiveQuantity = decimalString({ min: 0.0001 });
const money = decimalString({ min: 0, max: 99999999.99 });

const list = z
  .object({
    search: z.string().trim().optional(),
    categoryId: z.string().uuid().optional(),
    uomId: z.string().uuid().optional(),
    isActive: booleanFilter(),
  })
  .extend(paginationSchema.shape);

const create = z.object({
  sku: z
    .string()
    .trim()
    .min(1)
    .max(64)
    .transform((value) => value.toUpperCase()),
  name: z.string().trim().min(1).max(200),
  description: z.string().trim().max(2000).nullable().optional(),
  categoryId: z.string().uuid().nullable().optional(),
  uomId: z.string().uuid(),
  costPrice: money.optional(),
  reorderMin: nonNegativeQuantity.optional(),
  reorderMax: nonNegativeQuantity.nullable().optional(),
  isActive: z.boolean().optional(),
});

const update = create.partial();

const idParam = z.object({ id: z.string().uuid('Invalid identifier') });

module.exports = {
  DECIMAL_PATTERN,
  quantity,
  nonNegativeQuantity,
  positiveQuantity,
  money,
  list,
  create,
  update,
  idParam,
};
