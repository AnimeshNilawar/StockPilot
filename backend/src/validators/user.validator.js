const { z } = require('zod');
const { paginationSchema } = require('../utils/query');

const idParam = z.object({
  id: z.string().uuid('Invalid user identifier'),
});

const list = z
  .object({
    search: z.string().trim().max(120).optional(),
    roleId: z.string().uuid().optional(),
    role: z.string().trim().toUpperCase().optional(),
    status: z.enum(['ACTIVE', 'INACTIVE']).optional(),
    warehouseId: z.string().uuid().optional(),
  })
  .extend(paginationSchema.shape);

const create = z.object({
  email: z.string().trim().email('Invalid email address').toLowerCase(),
  password: z.string().min(8, 'Password must be at least 8 characters long'),
  name: z.string().trim().min(1, 'Name is required').max(100),
  roleId: z.string().uuid('Valid role identifier is required'),
  warehouseIds: z.array(z.string().uuid('Invalid warehouse identifier')).optional().default([]),
  status: z.enum(['ACTIVE', 'INACTIVE']).optional().default('ACTIVE'),
});

const update = z.object({
  name: z.string().trim().min(1).max(100).optional(),
  roleId: z.string().uuid('Invalid role identifier').optional(),
  status: z.enum(['ACTIVE', 'INACTIVE']).optional(),
  warehouseIds: z.array(z.string().uuid('Invalid warehouse identifier')).optional(),
});

const updateRole = z
  .object({
    roleId: z.string().uuid('Invalid role identifier').optional(),
    role: z.enum(['ADMIN', 'INVENTORY_MANAGER', 'WAREHOUSE_STAFF']).optional(),
  })
  .refine((data) => data.roleId || data.role, {
    message: 'Either roleId or role name must be provided',
  });

const updateWarehouseAccess = z.object({
  warehouseIds: z.array(z.string().uuid('Invalid warehouse identifier')),
});

const updateStatus = z.object({
  status: z.enum(['ACTIVE', 'INACTIVE']),
});

module.exports = {
  idParam,
  list,
  create,
  update,
  updateRole,
  updateWarehouseAccess,
  updateStatus,
};
