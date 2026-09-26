const { z } = require('zod');
const authService = require('../services/auth.service');
const auditService = require('../services/audit.service');
const authConfig = require('../config/auth');
const { prisma } = require('../lib/prisma');

const signupSchema = z.object({
  email: z.string().email().toLowerCase(),
  password: z.string().min(8),
  name: z.string().optional(),
});

const loginSchema = z.object({
  email: z.string().email().toLowerCase(),
  password: z.string(),
});

const forgotPasswordSchema = z.object({
  email: z.string().email().toLowerCase(),
});

const verifyOtpSchema = z.object({
  email: z.string().email().toLowerCase(),
  otp: z.string().length(6),
});

const resetPasswordSchema = z.object({
  resetToken: z.string(),
  newPassword: z.string().min(8),
});

/**
 * Single source of truth for the user payload the client receives.
 *
 * `login` and `/auth/me` must agree: the SPA seeds its session cache with the
 * login response and treats it as fresh, so a thinner login payload would leave
 * the UI believing the caller has no permissions and hide every protected action
 * until a hard reload.
 *
 * The UI hides actions the caller may not perform. The server re-checks every one
 * of them, so this is presentation only.
 */
const serializeUser = (user) => ({
  id: user.id,
  email: user.email,
  name: user.name,
  role: user.role.name,
  status: user.status,
  warehouseIds: (user.warehouseAccess || []).map((w) => w.warehouseId),
  permissions: (user.role.permissions || []).map((p) => p.permission.action),
});

class AuthController {
  async signup(req, res, next) {
    try {
      const { email, password, name } = signupSchema.parse(req.body);

      const existingUser = await prisma.user.findUnique({ where: { email } });
      if (existingUser) {
        // Return a generic error or safely indicate the issue depending on security policy
        // For standard local apps, duplicate email error is fine, but we'll stick to secure behavior
        return res
          .status(400)
          .json({ success: false, message: 'Email already in use', code: 'EMAIL_IN_USE' });
      }

      // Assign default safe role (WAREHOUSE_STAFF)
      let defaultRole = await prisma.role.findUnique({ where: { name: 'WAREHOUSE_STAFF' } });
      if (!defaultRole) {
        return res
          .status(500)
          .json({ success: false, message: 'Default role not found', code: 'SERVER_ERROR' });
      }

      const passwordHash = await authService.hashPassword(password);

      const user = await prisma.user.create({
        data: {
          email,
          passwordHash,
          name,
          roleId: defaultRole.id,
        },
      });

      await auditService.log({
        userId: user.id,
        action: 'USER_CREATED',
        entityType: 'User',
        entityId: user.id,
        ip: req.ip,
      });

      res.status(201).json({
        success: true,
        data: { id: user.id, email: user.email, name: user.name },
      });
    } catch (error) {
      if (error instanceof z.ZodError) {
        return res.status(400).json({
          success: false,
          message: 'Validation failed',
          code: 'VALIDATION_ERROR',
          errors: error.errors,
        });
      }
      next(error);
    }
  }

  async login(req, res, next) {
    try {
      const { email, password } = loginSchema.parse(req.body);

      const user = await prisma.user.findUnique({
        where: { email },
        include: {
          role: { include: { permissions: { include: { permission: true } } } },
          warehouseAccess: true,
        },
      });

      if (!user || !(await authService.verifyPassword(user.passwordHash, password))) {
        return res
          .status(401)
          .json({ success: false, message: 'Invalid credentials', code: 'UNAUTHORIZED' });
      }

      if (user.status !== 'ACTIVE') {
        return res
          .status(403)
          .json({ success: false, message: 'Account is inactive', code: 'FORBIDDEN' });
      }

      const accessToken = authService.generateAccessToken(user);
      const refreshToken = await authService.createRefreshToken(
        user.id,
        req.ip,
        req.headers['user-agent'],
      );

      await auditService.log({
        userId: user.id,
        action: 'LOGIN_SUCCESS',
        entityType: 'User',
        entityId: user.id,
        ip: req.ip,
      });

      res.cookie(authConfig.cookie.name, refreshToken, authConfig.cookie.options);

      res.status(200).json({
        success: true,
        data: {
          accessToken,
          user: serializeUser(user),
        },
      });
    } catch (error) {
      if (error instanceof z.ZodError) {
        return res
          .status(400)
          .json({ success: false, message: 'Validation failed', code: 'VALIDATION_ERROR' });
      }
      next(error);
    }
  }

  async refresh(req, res, next) {
    try {
      const refreshToken = req.cookies[authConfig.cookie.name];
      if (!refreshToken) {
        return res
          .status(401)
          .json({ success: false, message: 'No refresh token', code: 'UNAUTHORIZED' });
      }

      const tokenHash = authService.hashToken(refreshToken);
      const tokenRecord = await prisma.refreshToken.findUnique({
        where: { tokenHash },
        include: { user: { include: { role: true } } },
      });

      if (!tokenRecord) {
        res.clearCookie(authConfig.cookie.name);
        return res
          .status(401)
          .json({ success: false, message: 'Invalid refresh token', code: 'UNAUTHORIZED' });
      }

      if (tokenRecord.revoked) {
        // Token reuse detected -> revoke family
        await authService.revokeTokenFamily(tokenRecord.family);
        res.clearCookie(authConfig.cookie.name);
        return res
          .status(401)
          .json({ success: false, message: 'Token compromised', code: 'UNAUTHORIZED' });
      }

      if (new Date() > tokenRecord.expiresAt) {
        await prisma.refreshToken.update({
          where: { id: tokenRecord.id },
          data: { revoked: true },
        });
        res.clearCookie(authConfig.cookie.name);
        return res
          .status(401)
          .json({ success: false, message: 'Token expired', code: 'UNAUTHORIZED' });
      }

      // Check user status
      if (tokenRecord.user.status !== 'ACTIVE') {
        res.clearCookie(authConfig.cookie.name);
        return res
          .status(403)
          .json({ success: false, message: 'Account is inactive', code: 'FORBIDDEN' });
      }

      // Revoke old token
      await prisma.refreshToken.update({ where: { id: tokenRecord.id }, data: { revoked: true } });

      // Issue new tokens
      const newAccessToken = authService.generateAccessToken(tokenRecord.user);
      const newRawRefreshToken = authService.generateRawToken();
      const newHash = authService.hashToken(newRawRefreshToken);

      await prisma.refreshToken.create({
        data: {
          tokenHash: newHash,
          userId: tokenRecord.userId,
          family: tokenRecord.family,
          expiresAt: new Date(Date.now() + authConfig.cookie.options.maxAge),
          ip: req.ip,
          userAgent: req.headers['user-agent'],
        },
      });

      res.cookie(authConfig.cookie.name, newRawRefreshToken, authConfig.cookie.options);

      res.status(200).json({
        success: true,
        data: { accessToken: newAccessToken },
      });
    } catch (error) {
      next(error);
    }
  }

  async logout(req, res, next) {
    try {
      const refreshToken = req.cookies[authConfig.cookie.name];
      if (refreshToken) {
        const tokenHash = authService.hashToken(refreshToken);
        await prisma.refreshToken.updateMany({
          where: { tokenHash },
          data: { revoked: true },
        });
      }

      res.clearCookie(authConfig.cookie.name);

      if (req.user) {
        await auditService.log({
          userId: req.user.id,
          action: 'LOGOUT',
          entityType: 'User',
          entityId: req.user.id,
          ip: req.ip,
        });
      }

      res.status(200).json({ success: true, message: 'Logged out successfully' });
    } catch (error) {
      next(error);
    }
  }

  async me(req, res, next) {
    try {
      res.status(200).json({
        success: true,
        data: serializeUser(req.user),
      });
    } catch (error) {
      next(error);
    }
  }

  async forgotPassword(req, res, next) {
    try {
      const { email } = forgotPasswordSchema.parse(req.body);
      const user = await prisma.user.findUnique({ where: { email } });

      if (user && user.status === 'ACTIVE') {
        const otp = authService.generateOtp();
        const otpHash = authService.hashToken(otp);
        const expiresAt = new Date(Date.now() + authConfig.otp.expirationMinutes * 60000);

        await prisma.otpReset.create({
          data: {
            userId: user.id,
            otpHash,
            expiresAt,
          },
        });

        // In development, log the OTP for testing purposes
        if (process.env.NODE_ENV !== 'production') {
          console.log(`[DEV ONLY] OTP for ${email}: ${otp}`);
        }
      }

      // Always return success to prevent email enumeration
      res
        .status(200)
        .json({ success: true, message: 'If the email exists, an OTP has been generated.' });
    } catch (error) {
      if (error instanceof z.ZodError) {
        return res
          .status(400)
          .json({ success: false, message: 'Validation failed', code: 'VALIDATION_ERROR' });
      }
      next(error);
    }
  }

  async verifyOtp(req, res, next) {
    try {
      const { email, otp } = verifyOtpSchema.parse(req.body);
      const user = await prisma.user.findUnique({ where: { email } });

      if (!user) {
        return res
          .status(400)
          .json({ success: false, message: 'Invalid OTP', code: 'INVALID_OTP' });
      }

      const activeOtpRecord = await prisma.otpReset.findFirst({
        where: {
          userId: user.id,
          used: false,
          attempts: { lt: authConfig.otp.maxAttempts },
          expiresAt: { gt: new Date() },
        },
        orderBy: { createdAt: 'desc' },
      });

      if (!activeOtpRecord) {
        return res
          .status(400)
          .json({ success: false, message: 'Invalid or expired OTP', code: 'INVALID_OTP' });
      }

      const otpHash = authService.hashToken(otp);
      if (activeOtpRecord.otpHash !== otpHash) {
        await prisma.otpReset.update({
          where: { id: activeOtpRecord.id },
          data: { attempts: { increment: 1 } },
        });
        return res
          .status(400)
          .json({ success: false, message: 'Invalid OTP', code: 'INVALID_OTP' });
      }

      // Valid OTP -> Issue short-lived reset token
      const resetToken = authService.generateRawToken();
      const resetTokenHash = authService.hashToken(resetToken);
      const resetTokenExpiresAt = new Date(Date.now() + 15 * 60000); // 15 mins

      await prisma.otpReset.update({
        where: { id: activeOtpRecord.id },
        data: {
          used: true,
          resetTokenHash,
          resetTokenExpiresAt,
        },
      });

      res.status(200).json({ success: true, data: { resetToken } });
    } catch (error) {
      if (error instanceof z.ZodError) {
        return res
          .status(400)
          .json({ success: false, message: 'Validation failed', code: 'VALIDATION_ERROR' });
      }
      next(error);
    }
  }

  async resetPassword(req, res, next) {
    try {
      const { resetToken, newPassword } = resetPasswordSchema.parse(req.body);
      const resetTokenHash = authService.hashToken(resetToken);

      const otpRecord = await prisma.otpReset.findUnique({
        where: { resetTokenHash },
        include: { user: true },
      });

      if (
        !otpRecord ||
        !otpRecord.resetTokenExpiresAt ||
        new Date() > otpRecord.resetTokenExpiresAt
      ) {
        return res.status(400).json({
          success: false,
          message: 'Invalid or expired reset token',
          code: 'INVALID_TOKEN',
        });
      }

      const newPasswordHash = await authService.hashPassword(newPassword);

      await prisma.$transaction([
        prisma.user.update({
          where: { id: otpRecord.userId },
          data: { passwordHash: newPasswordHash },
        }),
        prisma.otpReset.update({
          where: { id: otpRecord.id },
          data: { resetTokenExpiresAt: new Date() }, // expire it immediately
        }),
      ]);

      // Revoke all existing sessions
      await authService.revokeAllUserSessions(otpRecord.userId);

      await auditService.log({
        userId: otpRecord.userId,
        action: 'PASSWORD_RESET',
        entityType: 'User',
        entityId: otpRecord.userId,
        ip: req.ip,
      });

      res.status(200).json({ success: true, message: 'Password reset successfully' });
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

module.exports = new AuthController();
