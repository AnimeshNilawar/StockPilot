const jwt = require('jsonwebtoken');
const authConfig = require('../config/auth');
const { prisma } = require('../lib/prisma');
const { isAdmin } = require('../domain/roles');

const requireAuth = async (req, res, next) => {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res
        .status(401)
        .json({ success: false, message: 'Authentication required', code: 'UNAUTHORIZED' });
    }

    const token = authHeader.split(' ')[1];
    const decoded = jwt.verify(token, authConfig.jwt.secret);

    if (decoded.type !== 'access') {
      return res
        .status(401)
        .json({ success: false, message: 'Invalid token type', code: 'UNAUTHORIZED' });
    }

    const user = await prisma.user.findUnique({
      where: { id: decoded.sub },
      include: {
        role: { include: { permissions: { include: { permission: true } } } },
        warehouseAccess: true,
      },
    });

    if (!user) {
      return res
        .status(401)
        .json({ success: false, message: 'User not found', code: 'UNAUTHORIZED' });
    }

    if (user.status !== 'ACTIVE') {
      return res
        .status(403)
        .json({ success: false, message: 'Account is inactive', code: 'FORBIDDEN' });
    }

    req.user = user;
    next();
  } catch (error) {
    if (error.name === 'TokenExpiredError') {
      return res
        .status(401)
        .json({ success: false, message: 'Token expired', code: 'TOKEN_EXPIRED' });
    }
    return res.status(401).json({ success: false, message: 'Invalid token', code: 'UNAUTHORIZED' });
  }
};

const requirePermission = (requiredPermission) => {
  return (req, res, next) => {
    if (!req.user) {
      return res
        .status(401)
        .json({ success: false, message: 'Authentication required', code: 'UNAUTHORIZED' });
    }

    // ADMIN bypass
    if (isAdmin(req.user)) {
      return next();
    }

    const hasPermission = req.user.role.permissions.some(
      (rp) => rp.permission.action === requiredPermission,
    );

    if (!hasPermission) {
      return res
        .status(403)
        .json({ success: false, message: 'Missing required permission', code: 'FORBIDDEN' });
    }

    next();
  };
};

module.exports = {
  requireAuth,
  requirePermission,
};
