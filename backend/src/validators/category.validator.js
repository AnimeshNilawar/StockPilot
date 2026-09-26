const { z } = require('zod');
const { paginationSchema, booleanFilter } = require('../utils/query');

const list = z
  .object({
    search: z.string().trim().optional(),
    parentId: z.string().optional(),
    isActive: booleanFilter(),
  })
  .extend(paginationSchema.shape);

const create = z.object({
  name: z.string().trim().min(1).max(120),
  parentId: z.string().uuid().nullable().optional(),
});

const update = z.object({
  name: z.string().trim().min(1).max(120).optional(),
  parentId: z.string().uuid().nullable().optional(),
  isActive: z.boolean().optional(),
});

const idParam = z.object({ id: z.string().uuid('Invalid identifier') });

module.exports = { list, create, update, idParam };
