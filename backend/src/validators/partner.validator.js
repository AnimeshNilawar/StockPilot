const { z } = require('zod');
const { paginationSchema, booleanFilter } = require('../utils/query');
const { PARTNER_TYPES, PARTNER_TYPE_VALUES } = require('../domain/partner');

const partnerType = z.enum([...PARTNER_TYPE_VALUES]);

const list = z
  .object({
    search: z.string().trim().optional(),
    type: partnerType.optional(),
    isActive: booleanFilter(),
  })
  .extend(paginationSchema.shape);

const options = z.object({
  type: partnerType.optional(),
  search: z.string().trim().optional(),
});

const create = z.object({
  name: z.string().trim().min(1, 'Partner name is required').max(200),
  type: partnerType.default(PARTNER_TYPES.BOTH),
  isActive: z.boolean().optional(),
});

const update = create.partial();

const idParam = z.object({ id: z.string().uuid('Invalid partner ID') });

module.exports = { partnerType, list, options, create, update, idParam };
