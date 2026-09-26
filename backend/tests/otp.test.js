const request = require('supertest');
const app = require('../src/app');
const { PrismaClient } = require('@prisma/client');
const authService = require('../src/services/auth.service');

const prisma = new PrismaClient();

describe('OTP API', () => {
  let user;

  beforeAll(async () => {
    const pwHash = await authService.hashPassword('OldPassword123');
    const role = await prisma.role.findUnique({ where: { name: 'WAREHOUSE_STAFF' } });
    user = await prisma.user.create({
      data: {
        email: 'otpuser@stockpilot.local',
        passwordHash: pwHash,
        roleId: role.id,
      }
    });
  });

  it('POST /api/v1/auth/forgot-password should return success', async () => {
    const res = await request(app)
      .post('/api/v1/auth/forgot-password')
      .send({ email: 'otpuser@stockpilot.local' });
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
  });

  it('POST /api/v1/auth/verify-otp with wrong OTP should fail', async () => {
    const res = await request(app)
      .post('/api/v1/auth/verify-otp')
      .send({ email: 'otpuser@stockpilot.local', otp: '000000' });
    expect(res.status).toBe(400);
    expect(res.body.code).toBe('INVALID_OTP');
  });

  afterAll(async () => {
    await prisma.otpReset.deleteMany({ where: { userId: user.id } });
    await prisma.user.delete({ where: { id: user.id } });
    await prisma.$disconnect();
  });
});
