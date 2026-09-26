const { z } = require('zod');
const auditService = require('../services/audit.service');
const authService = require('../services/auth.service');
const { prisma } = require('../lib/prisma');

const createUserSchema = z.object({
  email: z.string().email().toLowerCase(),
  password: z.string().min(8),
  name: z.string().optional(),
  roleId: z.string().uuid(),
});

const updateUserSchema = z.object({
  name: z.string().optional(),
  status: z.enum(['ACTIVE', 'INACTIVE']).optional(),
});

const updateRoleSchema = z.object({
  roleId: z.string().uuid(),
});

const assignWarehousesSchema = z.object({
  warehouseIds: z.array(z.string().uuid()),
});

class UserController {
  async list(req, res, next) {
    try {
      const users = await prisma.user.findMany({
        select: {
          id: true,
          email: true,
          name: true,
          status: true,
          role: { select: { id: true, name: true } },
          createdAt: true,
        },
      });
      res.status(200).json({ success: true, data: users });
    } catch (error) {
      next(error);
    }
  }

  async create(req, res, next) {
    try {
      const { email, password, name, roleId } = createUserSchema.parse(req.body);

      const existing = await prisma.user.findUnique({ where: { email } });
      if (existing) {
        return res
          .status(400)
          .json({ success: false, message: 'Email in use', code: 'EMAIL_IN_USE' });
      }

      const role = await prisma.role.findUnique({ where: { id: roleId } });
      if (!role) {
        return res
          .status(400)
          .json({ success: false, message: 'Invalid role', code: 'INVALID_ROLE' });
      }

      const passwordHash = await authService.hashPassword(password);
      const user = await prisma.user.create({
        data: { email, passwordHash, name, roleId },
        select: { id: true, email: true, name: true, role: { select: { name: true } } },
      });

      await auditService.log({
        userId: req.user.id,
        action: 'USER_CREATED',
        entityType: 'User',
        entityId: user.id,
        ip: req.ip,
      });

      res.status(201).json({ success: true, data: user });
    } catch (error) {
      if (error instanceof z.ZodError) {
        return res
          .status(400)
          .json({ success: false, message: 'Validation failed', code: 'VALIDATION_ERROR' });
      }
      next(error);
    }
  }

  async update(req, res, next) {
    try {
      const { id } = req.params;
      const data = updateUserSchema.parse(req.body);

      const user = await prisma.user.update({
        where: { id },
        data,
        select: { id: true, email: true, name: true, status: true },
      });

      if (data.status === 'INACTIVE') {
        await authService.revokeAllUserSessions(user.id);
      }

      await auditService.log({
        userId: req.user.id,
        action: 'USER_UPDATED',
        entityType: 'User',
        entityId: user.id,
        metadata: data,
        ip: req.ip,
      });

      res.status(200).json({ success: true, data: user });
    } catch (error) {
      if (error instanceof z.ZodError) {
        return res
          .status(400)
          .json({ success: false, message: 'Validation failed', code: 'VALIDATION_ERROR' });
      }
      next(error);
    }
  }

  async updateRole(req, res, next) {
    try {
      const { id } = req.params;
      const { roleId } = updateRoleSchema.parse(req.body);

      const role = await prisma.role.findUnique({ where: { id: roleId } });
      if (!role) {
        return res
          .status(400)
          .json({ success: false, message: 'Invalid role', code: 'INVALID_ROLE' });
      }

      const user = await prisma.user.update({
        where: { id },
        data: { roleId },
        select: { id: true, email: true, role: { select: { name: true } } },
      });

      // Optional: revoke sessions if role changed, depending on policy.
      await authService.revokeAllUserSessions(user.id);

      await auditService.log({
        userId: req.user.id,
        action: 'USER_ROLE_CHANGED',
        entityType: 'User',
        entityId: user.id,
        metadata: { newRole: role.name },
        ip: req.ip,
      });

      res.status(200).json({ success: true, data: user });
    } catch (error) {
      if (error instanceof z.ZodError) {
        return res
          .status(400)
          .json({ success: false, message: 'Validation failed', code: 'VALIDATION_ERROR' });
      }
      next(error);
    }
  }

  async assignWarehouses(req, res, next) {
    try {
      const { id } = req.params;
      const { warehouseIds } = assignWarehousesSchema.parse(req.body);

      // Verify user exists
      const user = await prisma.user.findUnique({ where: { id } });
      if (!user) {
        return res
          .status(404)
          .json({ success: false, message: 'User not found', code: 'NOT_FOUND' });
      }

      await prisma.$transaction(async (tx) => {
        // Delete old accesses
        await tx.userWarehouseAccess.deleteMany({ where: { userId: id } });
        // Create new ones
        if (warehouseIds.length > 0) {
          await tx.userWarehouseAccess.createMany({
            data: warehouseIds.map((wId) => ({ userId: id, warehouseId: wId })),
          });
        }
      });

      await auditService.log({
        userId: req.user.id,
        action: 'USER_WAREHOUSE_ACCESS_CHANGED',
        entityType: 'User',
        entityId: user.id,
        metadata: { warehouseIds },
        ip: req.ip,
      });

      res.status(200).json({ success: true, message: 'Warehouses assigned successfully' });
    } catch (error) {
      if (error instanceof z.ZodError) {
        return res
          .status(400)
          .json({ success: false, message: 'Validation failed', code: 'VALIDATION_ERROR' });
      }
      next(error);
    }
  }
}

module.exports = new UserController();
