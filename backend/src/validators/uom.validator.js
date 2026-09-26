const { z } = require('zod');
const { paginationSchema, booleanFilter } = require('../utils/query');

const list = z
  .object({
    search: z.string().trim().optional(),
    isActive: booleanFilter(),
  })
  .extend(paginationSchema.shape);

const create = z.object({
  name: z.string().trim().min(1).max(60),
  code: z
    .string()
    .trim()
    .min(1)
    .max(20)
    .regex(/^[A-Za-z0-9_-]+$/, 'Code may only contain letters, digits, underscore or hyphen')
    .transform((value) => value.toUpperCase()),
});

const update = z.object({
  name: z.string().trim().min(1).max(60).optional(),
  isActive: z.boolean().optional(),
});

const idParam = z.object({ id: z.string().uuid('Invalid identifier') });

module.exports = { list, create, update, idParam };
