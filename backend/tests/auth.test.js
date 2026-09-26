const request = require('supertest');
const app = require('../src/app');
const { PrismaClient } = require('@prisma/client');
const authService = require('../src/services/auth.service');

const prisma = new PrismaClient();

describe('Auth API', () => {
  let adminToken;

  beforeAll(async () => {
    const admin = await prisma.user.findUnique({
      where: { email: 'admin@stockpilot.local' },
      include: { role: true },
    });
    adminToken = authService.generateAccessToken(admin);
  });

  describe('POST /api/v1/auth/signup', () => {
    it('should create a new user and assign default role', async () => {
      const res = await request(app)
        .post('/api/v1/auth/signup')
        .send({ email: 'newuser@example.com', password: 'Password123' });

      expect(res.status).toBe(201);
      expect(res.body.success).toBe(true);
      expect(res.body.data.email).toBe('newuser@example.com');
    });

    it('should reject duplicate email', async () => {
      const res = await request(app)
        .post('/api/v1/auth/signup')
        .send({ email: 'newuser@example.com', password: 'Password123' });

      expect(res.status).toBe(400);
      expect(res.body.code).toBe('EMAIL_IN_USE');
    });
  });

  describe('POST /api/v1/auth/login', () => {
    it('should login and return tokens', async () => {
      const res = await request(app)
        .post('/api/v1/auth/login')
        .send({ email: 'admin@stockpilot.local', password: 'Admin@1234' });

      expect(res.status).toBe(200);
      expect(res.body.data.accessToken).toBeDefined();
      expect(res.headers['set-cookie'][0]).toMatch(/refreshToken=/);
    });

    it('should reject incorrect password', async () => {
      const res = await request(app)
        .post('/api/v1/auth/login')
        .send({ email: 'admin@stockpilot.local', password: 'wrongpassword' });

      expect(res.status).toBe(401);
    });
  });

  describe('GET /api/v1/auth/me', () => {
    it('should return user profile with valid token', async () => {
      const res = await request(app)
        .get('/api/v1/auth/me')
        .set('Authorization', `Bearer ${adminToken}`);

      expect(res.status).toBe(200);
      expect(res.body.data.email).toBe('admin@stockpilot.local');
    });

    it('should reject without token', async () => {
      const res = await request(app).get('/api/v1/auth/me');
      expect(res.status).toBe(401);
    });

    it('should expose the permissions the UI gates on', async () => {
      const res = await request(app)
        .get('/api/v1/auth/me')
        .set('Authorization', `Bearer ${adminToken}`);

      expect(res.body.data.permissions).toEqual(
        expect.arrayContaining(['stock.read', 'stock.move']),
      );
      expect(Array.isArray(res.body.data.warehouseIds)).toBe(true);
    });

    // The SPA seeds its session cache from the login response and treats it as
    // fresh, so a thinner login payload silently hides every permission-gated
    // screen until a hard reload. Both endpoints must return the same shape.
    it('should return exactly the same user shape from login as from /auth/me', async () => {
      const login = await request(app).post('/api/v1/auth/login').send({
        email: 'admin@stockpilot.local',
        password: 'Admin@1234',
      });
      const me = await request(app)
        .get('/api/v1/auth/me')
        .set('Authorization', `Bearer ${login.body.data.accessToken}`);

      expect(login.status).toBe(200);
      expect(Object.keys(login.body.data.user).sort()).toEqual(Object.keys(me.body.data).sort());
      expect(login.body.data.user.permissions).toEqual(me.body.data.permissions);
    });
  });

  // Clean up
  afterAll(async () => {
    await prisma.user.deleteMany({ where: { email: 'newuser@example.com' } });
    await prisma.$disconnect();
  });
});
