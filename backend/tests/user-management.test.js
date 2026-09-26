const request = require('supertest');
const app = require('../src/app');
const {
  prisma,
  createUserWithToken,
  createWarehouseWithLocations,
  auth,
  unique,
} = require('./helpers');

describe('Phase 7A — User & Access Management + RBAC Enforcements', () => {
  let admin;
  let manager;
  let staff;
  let warehouseA;
  let warehouseB;
  const createdUserIds = [];

  beforeAll(async () => {
    admin = await createUserWithToken('ADMIN');
    manager = await createUserWithToken('INVENTORY_MANAGER');
    staff = await createUserWithToken('WAREHOUSE_STAFF');

    ({ warehouse: warehouseA } = await createWarehouseWithLocations({
      name: 'Pune Warehouse Alpha',
      shortCode: 'PUNEALPHA',
    }));
    ({ warehouse: warehouseB } = await createWarehouseWithLocations({
      name: 'Mumbai Distribution Beta',
      shortCode: 'MUMBETA',
    }));
  });

  afterAll(async () => {
    const allUsersToDelete = [admin.user.id, manager.user.id, staff.user.id, ...createdUserIds];
    await prisma.auditLog.deleteMany({ where: { userId: { in: allUsersToDelete } } });
    await prisma.userWarehouseAccess.deleteMany({ where: { userId: { in: allUsersToDelete } } });
    await prisma.refreshToken.deleteMany({ where: { userId: { in: allUsersToDelete } } });
    await prisma.user.deleteMany({ where: { id: { in: allUsersToDelete } } });

    await prisma.location.deleteMany({ where: { warehouseId: { in: [warehouseA.id, warehouseB.id] } } });
    await prisma.warehouse.deleteMany({ where: { id: { in: [warehouseA.id, warehouseB.id] } } });
    await prisma.$disconnect();
  });

  describe('1 & 2. User Listing & Access Control', () => {
    it('allows Admin to list users with pagination and filters', async () => {
      const res = await request(app).get('/api/v1/users').set(auth(admin.token));
      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(Array.isArray(res.body.data.items)).toBe(true);
      expect(res.body.data.pagination).toBeDefined();
    });

    it('forbids Inventory Manager and Warehouse Staff from listing users', async () => {
      const resManager = await request(app).get('/api/v1/users').set(auth(manager.token));
      expect(resManager.status).toBe(403);
      expect(resManager.body.code).toBe('FORBIDDEN');

      const resStaff = await request(app).get('/api/v1/users').set(auth(staff.token));
      expect(resStaff.status).toBe(403);
      expect(resStaff.body.code).toBe('FORBIDDEN');
    });

    it('filters users by warehouse assignment', async () => {
      const staffAssigned = await createUserWithToken('WAREHOUSE_STAFF', {
        warehouseIds: [warehouseA.id],
      });
      createdUserIds.push(staffAssigned.user.id);

      const res = await request(app)
        .get(`/api/v1/users?warehouseId=${warehouseA.id}`)
        .set(auth(admin.token));

      expect(res.status).toBe(200);
      const ids = res.body.data.items.map((u) => u.id);
      expect(ids).toContain(staffAssigned.user.id);
    });
  });

  describe('3 & 4. Role Management & Authorization Enforcement', () => {
    it('allows Admin to promote a Staff user to Inventory Manager', async () => {
      const target = await createUserWithToken('WAREHOUSE_STAFF');
      createdUserIds.push(target.user.id);

      const managerRole = await prisma.role.findUnique({ where: { name: 'INVENTORY_MANAGER' } });

      const patchRes = await request(app)
        .patch(`/api/v1/users/${target.user.id}/role`)
        .set(auth(admin.token))
        .send({ roleId: managerRole.id });

      expect(patchRes.status).toBe(200);
      expect(patchRes.body.data.role.name).toBe('INVENTORY_MANAGER');

      // Verify immediate backend effect: login with new token now has manager authority
      const loginRes = await request(app)
        .post('/api/v1/auth/login')
        .send({ email: target.user.email, password: target.password });

      expect(loginRes.status).toBe(200);
      const newToken = loginRes.body.data.accessToken;

      // New token can access category creation (which manager has permission for)
      const catRes = await request(app)
        .post('/api/v1/categories')
        .set(auth(newToken))
        .send({ name: unique('PromoCat') });

      expect(catRes.status).toBe(201);
      await prisma.category.delete({ where: { id: catRes.body.data.id } });
    });
  });

  describe('5, 6, 7 & 8. Warehouse Access Management & Isolation', () => {
    it('assigns and removes warehouse access transactionally', async () => {
      const target = await createUserWithToken('WAREHOUSE_STAFF', { warehouseIds: [warehouseA.id] });
      createdUserIds.push(target.user.id);

      // 1. Initially has access to warehouseA only
      const readA = await request(app)
        .get(`/api/v1/warehouses/${warehouseA.id}`)
        .set(auth(target.token));
      expect(readA.status).toBe(200);

      const readB = await request(app)
        .get(`/api/v1/warehouses/${warehouseB.id}`)
        .set(auth(target.token));
      expect(readB.status).toBe(403);

      // 2. Admin assigns access to warehouseB as well
      const assignRes = await request(app)
        .patch(`/api/v1/users/${target.user.id}/warehouse-access`)
        .set(auth(admin.token))
        .send({ warehouseIds: [warehouseA.id, warehouseB.id] });

      expect(assignRes.status).toBe(200);
      expect(assignRes.body.data.warehouses.length).toBe(2);

      // 3. Immediate effect on next request: target can now read warehouseB
      const readBAfter = await request(app)
        .get(`/api/v1/warehouses/${warehouseB.id}`)
        .set(auth(target.token));
      expect(readBAfter.status).toBe(200);

      // 4. Admin removes access to warehouseA
      const removeRes = await request(app)
        .put(`/api/v1/users/${target.user.id}/warehouses`)
        .set(auth(admin.token))
        .send({ warehouseIds: [warehouseB.id] });

      expect(removeRes.status).toBe(200);

      // 5. Target now cannot access warehouseA
      const readANow = await request(app)
        .get(`/api/v1/warehouses/${warehouseA.id}`)
        .set(auth(target.token));
      expect(readANow.status).toBe(403);
    });

    it('rejects forged warehouseId queries or parameters', async () => {
      const target = await createUserWithToken('WAREHOUSE_STAFF', { warehouseIds: [warehouseA.id] });
      createdUserIds.push(target.user.id);

      const forgedRes = await request(app)
        .get(`/api/v1/warehouses?warehouseId=${warehouseB.id}`)
        .set(auth(target.token));

      expect(forgedRes.status).toBe(200);
      const whIds = forgedRes.body.data.items.map((w) => w.id);
      expect(whIds).not.toContain(warehouseB.id);
    });
  });

  describe('9. Zero Warehouse Access', () => {
    it('allows a newly registered staff to authenticate with zero warehouse assignments', async () => {
      const staffEmail = `${unique('newstaff').replace(/[^a-z0-9]/gi, '')}@test.local`;
      const signupRes = await request(app).post('/api/v1/auth/signup').send({
        email: staffEmail,
        name: 'Unassigned Staff',
        password: 'Password123',
      });

      expect(signupRes.status).toBe(201);
      const userId = signupRes.body.data.id;
      createdUserIds.push(userId);

      // Login to get token
      const loginRes = await request(app).post('/api/v1/auth/login').send({
        email: staffEmail,
        password: 'Password123',
      });
      expect(loginRes.status).toBe(200);
      const token = loginRes.body.data.accessToken;

      // User can call /auth/me
      const meRes = await request(app).get('/api/v1/auth/me').set(auth(token));
      expect(meRes.status).toBe(200);
      expect(meRes.body.data.warehouseIds).toHaveLength(0);

      // But warehouse-scoped query returns 0 items / blocks access
      const whRes = await request(app).get('/api/v1/warehouses').set(auth(token));
      expect(whRes.status).toBe(200);
      expect(whRes.body.data.items).toHaveLength(0);

      const readWh = await request(app)
        .get(`/api/v1/warehouses/${warehouseA.id}`)
        .set(auth(token));
      expect(readWh.status).toBe(403);
    });
  });

  describe('10 & 11. User Status & Deactivation', () => {
    it('prevents inactive users from authenticating or calling APIs', async () => {
      const target = await createUserWithToken('WAREHOUSE_STAFF');
      createdUserIds.push(target.user.id);

      // Deactivate user
      const deactRes = await request(app)
        .patch(`/api/v1/users/${target.user.id}/status`)
        .set(auth(admin.token))
        .send({ status: 'INACTIVE' });

      expect(deactRes.status).toBe(200);
      expect(deactRes.body.data.status).toBe('INACTIVE');

      // Subsequent API request with existing token immediately fails with 403 Account is inactive
      const apiRes = await request(app).get('/api/v1/auth/me').set(auth(target.token));
      expect(apiRes.status).toBe(403);
      expect(apiRes.body.message).toMatch(/Account is inactive/i);

      // Subsequent login attempt fails with 403
      const loginRes = await request(app)
        .post('/api/v1/auth/login')
        .send({ email: target.user.email, password: target.password });

      expect(loginRes.status).toBe(403);

      // Admin reactivates user
      const reactRes = await request(app)
        .patch(`/api/v1/users/${target.user.id}/status`)
        .set(auth(admin.token))
        .send({ status: 'ACTIVE' });

      expect(reactRes.status).toBe(200);
      expect(reactRes.body.data.status).toBe('ACTIVE');

      // Login succeeds again
      const reloginRes = await request(app)
        .post('/api/v1/auth/login')
        .send({ email: target.user.email, password: target.password });

      expect(reloginRes.status).toBe(200);
    });
  });

  describe('12, 13 & 14. Audit Logging', () => {
    it('creates structured audit logs for role, warehouse access, and status changes', async () => {
      const target = await createUserWithToken('WAREHOUSE_STAFF');
      createdUserIds.push(target.user.id);

      const managerRole = await prisma.role.findUnique({ where: { name: 'INVENTORY_MANAGER' } });

      // 1. Role Change
      await request(app)
        .patch(`/api/v1/users/${target.user.id}/role`)
        .set(auth(admin.token))
        .send({ roleId: managerRole.id });

      const roleAudit = await prisma.auditLog.findFirst({
        where: { entityId: target.user.id, action: 'USER_ROLE_CHANGED' },
        orderBy: { createdAt: 'desc' },
      });
      expect(roleAudit).toBeDefined();
      expect(roleAudit.metadata.newRole).toBe('INVENTORY_MANAGER');

      // 2. Warehouse Access Change
      await request(app)
        .patch(`/api/v1/users/${target.user.id}/warehouse-access`)
        .set(auth(admin.token))
        .send({ warehouseIds: [warehouseA.id] });

      const whAudit = await prisma.auditLog.findFirst({
        where: { entityId: target.user.id, action: 'USER_WAREHOUSE_ACCESS_CHANGED' },
        orderBy: { createdAt: 'desc' },
      });
      expect(whAudit).toBeDefined();
      expect(whAudit.metadata.newWarehouseIds).toContain(warehouseA.id);

      // 3. Status Change
      await request(app)
        .patch(`/api/v1/users/${target.user.id}/status`)
        .set(auth(admin.token))
        .send({ status: 'INACTIVE' });

      const statusAudit = await prisma.auditLog.findFirst({
        where: { entityId: target.user.id, action: 'USER_STATUS_CHANGED' },
        orderBy: { createdAt: 'desc' },
      });
      expect(statusAudit).toBeDefined();
      expect(statusAudit.metadata.newStatus).toBe('INACTIVE');
    });
  });

  describe('15. Self-Admin Lockout Protection', () => {
    it('refuses to deactivate or demote the last active Administrator', async () => {
      // Create a temporary isolated active Admin
      const loneAdmin = await createUserWithToken('ADMIN');
      createdUserIds.push(loneAdmin.user.id);

      // Temporarily deactivate all other admins
      await prisma.user.updateMany({
        where: {
          id: { not: loneAdmin.user.id },
          role: { name: 'ADMIN' },
        },
        data: { status: 'INACTIVE' },
      });

      try {
        // Attempting to deactivate loneAdmin must be blocked
        const deactRes = await request(app)
          .patch(`/api/v1/users/${loneAdmin.user.id}/status`)
          .set(auth(loneAdmin.token))
          .send({ status: 'INACTIVE' });

        expect(deactRes.status).toBe(400);
        expect(deactRes.body.code).toBe('LAST_ADMIN_LOCKOUT_PROTECTION');

        // Attempting to demote loneAdmin must be blocked
        const staffRole = await prisma.role.findUnique({ where: { name: 'WAREHOUSE_STAFF' } });
        const demoteRes = await request(app)
          .patch(`/api/v1/users/${loneAdmin.user.id}/role`)
          .set(auth(loneAdmin.token))
          .send({ roleId: staffRole.id });

        expect(demoteRes.status).toBe(400);
        expect(demoteRes.body.code).toBe('LAST_ADMIN_LOCKOUT_PROTECTION');
      } finally {
        // Restore active status on admin accounts
        await prisma.user.updateMany({
          where: { role: { name: 'ADMIN' } },
          data: { status: 'ACTIVE' },
        });
      }
    });
  });
});
