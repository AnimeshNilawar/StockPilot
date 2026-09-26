const request = require('supertest');
const app = require('../src/app');
const { PrismaClient } = require('@prisma/client');
const authService = require('../src/services/auth.service');
const authConfig = require('../src/config/auth');

const prisma = new PrismaClient();

describe('Auth API', () => {
  let adminToken;
  let adminId;

  beforeAll(async () => {
    const admin = await prisma.user.findUnique({ where: { email: 'admin@stockpilot.local' }, include: { role: true } });
    adminId = admin.id;
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
  });
  
  // Clean up
  afterAll(async () => {
    await prisma.user.deleteMany({ where: { email: 'newuser@example.com' } });
    await prisma.$disconnect();
  });
});
