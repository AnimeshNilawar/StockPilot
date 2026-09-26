const { prisma } = require('../lib/prisma');

class AuditService {
  async log({
    userId,
    action,
    entityType,
    entityId = null,
    metadata = null,
    ip = null,
    userAgent = null,
  }) {
    try {
      // Strip out sensitive info from metadata just in case
      if (metadata) {
        delete metadata.password;
        delete metadata.passwordHash;
        delete metadata.otp;
        delete metadata.refreshToken;
        delete metadata.resetToken;
      }

      await prisma.auditLog.create({
        data: {
          userId,
          action,
          entityType,
          entityId,
          metadata,
          ip,
          userAgent,
        },
      });
    } catch (error) {
      console.error('Failed to write audit log:', error);
      // We don't want audit log failures to crash the main transaction
    }
  }
}

module.exports = new AuditService();
