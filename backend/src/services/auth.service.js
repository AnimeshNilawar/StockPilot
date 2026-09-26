const argon2 = require('argon2');
const jwt = require('jsonwebtoken');
const crypto = require('crypto');
const { PrismaClient } = require('@prisma/client');
const authConfig = require('../config/auth');
const prisma = new PrismaClient();

class AuthService {
  async hashPassword(password) {
    return await argon2.hash(password);
  }

  async verifyPassword(hash, password) {
    return await argon2.verify(hash, password);
  }

  generateAccessToken(user) {
    return jwt.sign(
      { sub: user.id, role: user.role.name, type: 'access' },
      authConfig.jwt.secret,
      { expiresIn: authConfig.jwt.accessExpiration }
    );
  }

  generateRawToken() {
    return crypto.randomBytes(40).toString('hex');
  }

  hashToken(token) {
    return crypto.createHash('sha256').update(token).digest('hex');
  }

  async createRefreshToken(userId, ip, userAgent) {
    const rawToken = this.generateRawToken();
    const tokenHash = this.hashToken(rawToken);
    const expiresAt = new Date(Date.now() + authConfig.cookie.options.maxAge);
    const family = crypto.randomBytes(16).toString('hex');

    await prisma.refreshToken.create({
      data: {
        tokenHash,
        userId,
        family,
        expiresAt,
        ip,
        userAgent,
      },
    });

    return rawToken;
  }

  generateOtp() {
    // Generate 6-digit OTP
    return Math.floor(100000 + Math.random() * 900000).toString();
  }

  async revokeAllUserSessions(userId) {
    await prisma.refreshToken.updateMany({
      where: { userId, revoked: false },
      data: { revoked: true },
    });
  }

  async revokeTokenFamily(family) {
    await prisma.refreshToken.updateMany({
      where: { family, revoked: false },
      data: { revoked: true },
    });
  }
}

module.exports = new AuthService();
