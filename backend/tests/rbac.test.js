const request = require('supertest');
const app = require('../src/app');
const { PrismaClient } = require('@prisma/client');
const authService = require('../src/services/auth.service');

const prisma = new PrismaClient();

describe('RBAC & Warehouse Access API', () => {
  let adminToken;
  let staffToken;
  let warehouse;

  beforeAll(async () => {
    const admin = await prisma.user.findUnique({
      where: { email: 'admin@stockpilot.local' },
      include: {
        role: { include: { permissions: { include: { permission: true } } } },
        warehouseAccess: true,
      },
    });
    adminToken = authService.generateAccessToken(admin);

    // Create a staff role user
    const staffRole = await prisma.role.findUnique({ where: { name: 'WAREHOUSE_STAFF' } });
    const pwHash = await authService.hashPassword('Staff123');

    warehouse = await prisma.warehouse.create({ data: { name: 'Main WH', shortCode: 'MAINWH' } });

    const staffUser = await prisma.user.create({
      data: {
        email: 'staff_' + Date.now() + '@stockpilot.local',
        passwordHash: pwHash,
        name: 'Staff User',
        roleId: staffRole.id,
        warehouseAccess: {
          create: { warehouseId: warehouse.id },
        },
      },
      include: {
        role: { include: { permissions: { include: { permission: true } } } },
        warehouseAccess: true,
      },
    });

    staffToken = authService.generateAccessToken(staffUser);
  });

  describe('GET /api/v1/users', () => {
    it('Admin can list users', async () => {
      const res = await request(app)
        .get('/api/v1/users')
        .set('Authorization', `Bearer ${adminToken}`);
      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
    });

    it('Staff gets 403 on users list', async () => {
      const res = await request(app)
        .get('/api/v1/users')
        .set('Authorization', `Bearer ${staffToken}`);
      expect(res.status).toBe(403);
    });
  });

  afterAll(async () => {
    await prisma.user.deleteMany({ where: { email: 'staff@stockpilot.local' } });
    await prisma.warehouse.delete({ where: { id: warehouse.id } });
    await prisma.$disconnect();
  });
});
