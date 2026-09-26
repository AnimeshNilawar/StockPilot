const { prisma } = require('../lib/prisma');
const { parsePagination, paginated } = require('../utils/query');
const { notFound, badRequest } = require('../utils/appError');
const auditService = require('../services/audit.service');
const authService = require('../services/auth.service');

class UserController {
  /** List all roles available in the system */
  async listRoles(req, res, next) {
    try {
      const roles = await prisma.role.findMany({
        orderBy: { name: 'asc' },
        select: { id: true, name: true },
      });
      res.status(200).json({ success: true, data: roles });
    } catch (error) {
      next(error);
    }
  }

  /**
   * Paginated list of users with composable filters:
   * - search (name or email)
   * - roleId or role (name)
   * - status ('ACTIVE' | 'INACTIVE')
   * - warehouseId (users assigned to this warehouse)
   */
  async list(req, res, next) {
    try {
      const { page, pageSize, skip, take } = parsePagination(req.valid.query);
      const { search, roleId, role, status, warehouseId } = req.valid.query;

      const where = {
        ...(status ? { status } : {}),
        ...(roleId ? { roleId } : {}),
        ...(role ? { role: { name: role } } : {}),
        ...(search
          ? {
              OR: [
                { name: { contains: search, mode: 'insensitive' } },
                { email: { contains: search, mode: 'insensitive' } },
              ],
            }
          : {}),
        ...(warehouseId
          ? {
              warehouseAccess: {
                some: { warehouseId },
              },
            }
          : {}),
      };

      const [users, total] = await Promise.all([
        prisma.user.findMany({
          where,
          skip,
          take,
          orderBy: { createdAt: 'desc' },
          select: {
            id: true,
            email: true,
            name: true,
            status: true,
            roleId: true,
            role: { select: { id: true, name: true } },
            warehouseAccess: {
              select: {
                warehouseId: true,
                warehouse: { select: { id: true, name: true, shortCode: true } },
              },
            },
            createdAt: true,
            updatedAt: true,
          },
        }),
        prisma.user.count({ where }),
      ]);

      const formatted = users.map((u) => ({
        id: u.id,
        email: u.email,
        name: u.name,
        status: u.status,
        roleId: u.roleId,
        role: u.role,
        warehouses: u.warehouseAccess.map((wa) => wa.warehouse),
        createdAt: u.createdAt,
        updatedAt: u.updatedAt,
      }));

      res.status(200).json({ success: true, data: paginated(formatted, total, { page, pageSize }) });
    } catch (error) {
      next(error);
    }
  }

  /** Get a single user by ID */
  async get(req, res, next) {
    try {
      const { id } = req.valid.params;
      const user = await prisma.user.findUnique({
        where: { id },
        select: {
          id: true,
          email: true,
          name: true,
          status: true,
          roleId: true,
          role: {
            select: {
              id: true,
              name: true,
              permissions: { select: { permission: { select: { action: true } } } },
            },
          },
          warehouseAccess: {
            select: {
              warehouseId: true,
              warehouse: { select: { id: true, name: true, shortCode: true } },
            },
          },
          createdAt: true,
          updatedAt: true,
        },
      });

      if (!user) throw notFound('User not found');

      res.status(200).json({
        success: true,
        data: {
          id: user.id,
          email: user.email,
          name: user.name,
          status: user.status,
          roleId: user.roleId,
          role: {
            id: user.role.id,
            name: user.role.name,
            permissions: user.role.permissions.map((p) => p.permission.action),
          },
          warehouses: user.warehouseAccess.map((wa) => wa.warehouse),
          createdAt: user.createdAt,
          updatedAt: user.updatedAt,
        },
      });
    } catch (error) {
      next(error);
    }
  }

  /** Create a new user with role and optional warehouse assignments */
  async create(req, res, next) {
    try {
      const { email, password, name, roleId, warehouseIds, status } = req.valid.body;

      const existing = await prisma.user.findUnique({ where: { email } });
      if (existing) {
        throw badRequest('Email is already in use', 'EMAIL_IN_USE');
      }

      const role = await prisma.role.findUnique({ where: { id: roleId } });
      if (!role) {
        throw badRequest('Invalid role specified', 'INVALID_ROLE');
      }

      // Verify all warehouses if provided
      if (warehouseIds && warehouseIds.length > 0) {
        const foundWarehouses = await prisma.warehouse.findMany({
          where: { id: { in: warehouseIds } },
          select: { id: true },
        });
        if (foundWarehouses.length !== warehouseIds.length) {
          throw badRequest('One or more warehouse IDs are invalid', 'INVALID_WAREHOUSE');
        }
      }

      const passwordHash = await authService.hashPassword(password);

      const user = await prisma.$transaction(async (tx) => {
        const created = await tx.user.create({
          data: {
            email,
            passwordHash,
            name,
            roleId,
            status: status || 'ACTIVE',
          },
        });

        if (warehouseIds && warehouseIds.length > 0) {
          await tx.userWarehouseAccess.createMany({
            data: warehouseIds.map((wId) => ({ userId: created.id, warehouseId: wId })),
          });
        }

        return tx.user.findUnique({
          where: { id: created.id },
          select: {
            id: true,
            email: true,
            name: true,
            status: true,
            role: { select: { id: true, name: true } },
            warehouseAccess: {
              select: {
                warehouse: { select: { id: true, name: true, shortCode: true } },
              },
            },
            createdAt: true,
          },
        });
      });

      await auditService.log({
        userId: req.user.id,
        action: 'USER_CREATED',
        entityType: 'User',
        entityId: user.id,
        metadata: {
          targetUserId: user.id,
          email: user.email,
          name: user.name,
          role: user.role.name,
          warehouseIds: warehouseIds || [],
          status: user.status,
        },
        ip: req.ip,
      });

      res.status(201).json({
        success: true,
        data: {
          id: user.id,
          email: user.email,
          name: user.name,
          status: user.status,
          role: user.role,
          warehouses: user.warehouseAccess.map((wa) => wa.warehouse),
          createdAt: user.createdAt,
        },
      });
    } catch (error) {
      next(error);
    }
  }

  /**
   * General user update (name, status, roleId, warehouseIds)
   */
  async update(req, res, next) {
    try {
      const { id } = req.valid.params;
      const { name, status, roleId, warehouseIds } = req.valid.body;

      const targetUser = await prisma.user.findUnique({
        where: { id },
        include: {
          role: true,
          warehouseAccess: true,
        },
      });
      if (!targetUser) throw notFound('User not found');

      // Check self-lockout if changing status or role of an ADMIN
      if (targetUser.role.name === 'ADMIN') {
        const willDeactivate = status === 'INACTIVE';
        let willDemote = false;
        if (roleId) {
          const newRole = await prisma.role.findUnique({ where: { id: roleId } });
          if (!newRole) throw badRequest('Invalid role specified', 'INVALID_ROLE');
          if (newRole.name !== 'ADMIN') willDemote = true;
        }

        if ((willDeactivate || willDemote) && targetUser.status === 'ACTIVE') {
          const otherActiveAdmins = await prisma.user.count({
            where: {
              id: { not: id },
              status: 'ACTIVE',
              role: { name: 'ADMIN' },
            },
          });
          if (otherActiveAdmins === 0) {
            throw badRequest(
              'Cannot deactivate or demote the last active administrator',
              'LAST_ADMIN_LOCKOUT_PROTECTION',
            );
          }
        }
      }

      if (warehouseIds) {
        if (warehouseIds.length > 0) {
          const found = await prisma.warehouse.findMany({
            where: { id: { in: warehouseIds } },
            select: { id: true },
          });
          if (found.length !== warehouseIds.length) {
            throw badRequest('One or more warehouse IDs are invalid', 'INVALID_WAREHOUSE');
          }
        }
      }

      const updatedUser = await prisma.$transaction(async (tx) => {
        const updateData = {};
        if (name !== undefined) updateData.name = name;
        if (status !== undefined) updateData.status = status;
        if (roleId !== undefined) updateData.roleId = roleId;

        if (Object.keys(updateData).length > 0) {
          await tx.user.update({
            where: { id },
            data: updateData,
          });
        }

        if (warehouseIds !== undefined) {
          await tx.userWarehouseAccess.deleteMany({ where: { userId: id } });
          if (warehouseIds.length > 0) {
            await tx.userWarehouseAccess.createMany({
              data: warehouseIds.map((wId) => ({ userId: id, warehouseId: wId })),
            });
          }
        }

        return tx.user.findUnique({
          where: { id },
          select: {
            id: true,
            email: true,
            name: true,
            status: true,
            role: { select: { id: true, name: true } },
            warehouseAccess: {
              select: {
                warehouse: { select: { id: true, name: true, shortCode: true } },
              },
            },
            updatedAt: true,
          },
        });
      });

      // Revoke sessions if deactivated or role changed
      if (status === 'INACTIVE' || (roleId && roleId !== targetUser.roleId)) {
        await authService.revokeAllUserSessions(id);
      }

      // Audit logs
      if (roleId && roleId !== targetUser.roleId) {
        await auditService.log({
          userId: req.user.id,
          action: 'USER_ROLE_CHANGED',
          entityType: 'User',
          entityId: id,
          metadata: {
            targetUserId: id,
            previousRoleId: targetUser.roleId,
            previousRole: targetUser.role.name,
            newRoleId: roleId,
            newRole: updatedUser.role.name,
          },
          ip: req.ip,
        });
      }

      if (warehouseIds !== undefined) {
        const prevWhs = targetUser.warehouseAccess.map((wa) => wa.warehouseId);
        await auditService.log({
          userId: req.user.id,
          action: 'USER_WAREHOUSE_ACCESS_CHANGED',
          entityType: 'User',
          entityId: id,
          metadata: {
            targetUserId: id,
            previousWarehouseIds: prevWhs,
            newWarehouseIds: warehouseIds,
          },
          ip: req.ip,
        });
      }

      if (status !== undefined && status !== targetUser.status) {
        await auditService.log({
          userId: req.user.id,
          action: 'USER_STATUS_CHANGED',
          entityType: 'User',
          entityId: id,
          metadata: {
            targetUserId: id,
            previousStatus: targetUser.status,
            newStatus: status,
          },
          ip: req.ip,
        });
      }

      res.status(200).json({
        success: true,
        data: {
          id: updatedUser.id,
          email: updatedUser.email,
          name: updatedUser.name,
          status: updatedUser.status,
          role: updatedUser.role,
          warehouses: updatedUser.warehouseAccess.map((wa) => wa.warehouse),
          updatedAt: updatedUser.updatedAt,
        },
      });
    } catch (error) {
      next(error);
    }
  }

  /**
   * Change user role specifically
   */
  async updateRole(req, res, next) {
    try {
      const { id } = req.valid.params;
      const { roleId, role: roleName } = req.valid.body;

      const targetUser = await prisma.user.findUnique({
        where: { id },
        include: { role: true },
      });
      if (!targetUser) throw notFound('User not found');

      let targetRoleId = roleId;
      let targetRoleRecord;
      if (roleId) {
        targetRoleRecord = await prisma.role.findUnique({ where: { id: roleId } });
      } else if (roleName) {
        targetRoleRecord = await prisma.role.findUnique({ where: { name: roleName } });
        if (targetRoleRecord) targetRoleId = targetRoleRecord.id;
      }

      if (!targetRoleRecord) {
        throw badRequest('Invalid role specified', 'INVALID_ROLE');
      }

      // Check self-lockout when demoting an active ADMIN to non-ADMIN
      if (targetUser.role.name === 'ADMIN' && targetRoleRecord.name !== 'ADMIN' && targetUser.status === 'ACTIVE') {
        const otherActiveAdmins = await prisma.user.count({
          where: {
            id: { not: id },
            status: 'ACTIVE',
            role: { name: 'ADMIN' },
          },
        });
        if (otherActiveAdmins === 0) {
          throw badRequest(
            'Cannot demote the last active administrator',
            'LAST_ADMIN_LOCKOUT_PROTECTION',
          );
        }
      }

      const updated = await prisma.user.update({
        where: { id },
        data: { roleId: targetRoleId },
        select: {
          id: true,
          email: true,
          name: true,
          status: true,
          role: { select: { id: true, name: true } },
        },
      });

      // Revoke sessions so user re-authenticates with new permissions
      await authService.revokeAllUserSessions(id);

      await auditService.log({
        userId: req.user.id,
        action: 'USER_ROLE_CHANGED',
        entityType: 'User',
        entityId: id,
        metadata: {
          targetUserId: id,
          previousRoleId: targetUser.role.id,
          previousRole: targetUser.role.name,
          newRoleId: updated.role.id,
          newRole: updated.role.name,
        },
        ip: req.ip,
      });

      res.status(200).json({ success: true, data: updated });
    } catch (error) {
      next(error);
    }
  }

  /**
   * Assign/remove warehouse access for a user
   */
  async assignWarehouseAccess(req, res, next) {
    try {
      const { id } = req.valid.params;
      const { warehouseIds } = req.valid.body;

      const targetUser = await prisma.user.findUnique({
        where: { id },
        include: { warehouseAccess: true },
      });
      if (!targetUser) throw notFound('User not found');

      if (warehouseIds.length > 0) {
        const found = await prisma.warehouse.findMany({
          where: { id: { in: warehouseIds } },
          select: { id: true },
        });
        if (found.length !== warehouseIds.length) {
          throw badRequest('One or more warehouse IDs are invalid', 'INVALID_WAREHOUSE');
        }
      }

      await prisma.$transaction(async (tx) => {
        await tx.userWarehouseAccess.deleteMany({ where: { userId: id } });
        if (warehouseIds.length > 0) {
          await tx.userWarehouseAccess.createMany({
            data: warehouseIds.map((wId) => ({ userId: id, warehouseId: wId })),
          });
        }
      });

      const previousWarehouseIds = targetUser.warehouseAccess.map((wa) => wa.warehouseId);

      await auditService.log({
        userId: req.user.id,
        action: 'USER_WAREHOUSE_ACCESS_CHANGED',
        entityType: 'User',
        entityId: id,
        metadata: {
          targetUserId: id,
          previousWarehouseIds,
          newWarehouseIds: warehouseIds,
        },
        ip: req.ip,
      });

      const updated = await prisma.user.findUnique({
        where: { id },
        select: {
          id: true,
          email: true,
          name: true,
          warehouseAccess: {
            select: {
              warehouse: { select: { id: true, name: true, shortCode: true } },
            },
          },
        },
      });

      res.status(200).json({
        success: true,
        data: {
          id: updated.id,
          email: updated.email,
          name: updated.name,
          warehouses: updated.warehouseAccess.map((wa) => wa.warehouse),
        },
      });
    } catch (error) {
      next(error);
    }
  }

  /**
   * Update active/inactive status specifically
   */
  async updateStatus(req, res, next) {
    try {
      const { id } = req.valid.params;
      const { status } = req.valid.body;

      const targetUser = await prisma.user.findUnique({
        where: { id },
        include: { role: true },
      });
      if (!targetUser) throw notFound('User not found');

      // Check self-lockout when deactivating the last active ADMIN
      if (targetUser.role.name === 'ADMIN' && status === 'INACTIVE' && targetUser.status === 'ACTIVE') {
        const otherActiveAdmins = await prisma.user.count({
          where: {
            id: { not: id },
            status: 'ACTIVE',
            role: { name: 'ADMIN' },
          },
        });
        if (otherActiveAdmins === 0) {
          throw badRequest(
            'Cannot deactivate the last active administrator',
            'LAST_ADMIN_LOCKOUT_PROTECTION',
          );
        }
      }

      const updated = await prisma.user.update({
        where: { id },
        data: { status },
        select: {
          id: true,
          email: true,
          name: true,
          status: true,
          role: { select: { id: true, name: true } },
        },
      });

      if (status === 'INACTIVE') {
        await authService.revokeAllUserSessions(id);
      }

      await auditService.log({
        userId: req.user.id,
        action: 'USER_STATUS_CHANGED',
        entityType: 'User',
        entityId: id,
        metadata: {
          targetUserId: id,
          previousStatus: targetUser.status,
          newStatus: status,
        },
        ip: req.ip,
      });

      res.status(200).json({ success: true, data: updated });
    } catch (error) {
      next(error);
    }
  }
}

module.exports = new UserController();
