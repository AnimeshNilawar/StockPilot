const { z } = require('zod');
const { paginationSchema, booleanFilter } = require('../utils/query');
const { LOCATION_TYPE_VALUES } = require('../domain/location');

const list = z
  .object({
    search: z.string().trim().optional(),
    isActive: booleanFilter(),
  })
  .extend(paginationSchema.shape);

const create = z.object({
  name: z.string().trim().min(1).max(120),
  shortCode: z
    .string()
    .trim()
    .min(1)
    .max(30)
    .regex(/^[A-Za-z0-9_-]+$/, 'Short code may only contain letters, digits, underscore or hyphen')
    .transform((value) => value.toUpperCase()),
  isActive: z.boolean().optional(),
});

const update = z.object({
  name: z.string().trim().min(1).max(120).optional(),
  isActive: z.boolean().optional(),
});

const idParam = z.object({ id: z.string().uuid('Invalid identifier') });

// ---------------------------------------------------------------------------
// Locations
// ---------------------------------------------------------------------------

const locationList = z
  .object({
    search: z.string().trim().optional(),
    type: z.enum(LOCATION_TYPE_VALUES).optional(),
    parentId: z.string().optional(),
    isActive: booleanFilter(),
  })
  .extend(paginationSchema.shape);

const locationCreate = z.object({
  warehouseId: z.string().uuid(),
  name: z.string().trim().min(1).max(120),
  shortCode: z
    .string()
    .trim()
    .min(1)
    .max(30)
    .regex(/^[A-Za-z0-9_-]+$/, 'Short code may only contain letters, digits, underscore or hyphen')
    .transform((value) => value.toUpperCase()),
  type: z.enum(LOCATION_TYPE_VALUES).default('INTERNAL'),
  parentId: z.string().uuid().nullable().optional(),
  isActive: z.boolean().optional(),
});

const locationUpdate = z.object({
  name: z.string().trim().min(1).max(120).optional(),
  type: z.enum(LOCATION_TYPE_VALUES).optional(),
  parentId: z.string().uuid().nullable().optional(),
  isActive: z.boolean().optional(),
});

const locationByWarehouseParam = z.object({
  warehouseId: z.string().uuid('Invalid warehouse identifier'),
});

module.exports = {
  list,
  create,
  update,
  idParam,
  locationList,
  locationCreate,
  locationUpdate,
  locationByWarehouseParam,
};
