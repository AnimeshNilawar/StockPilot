const jwt = require('jsonwebtoken');
const { PrismaClient } = require('@prisma/client');
const authConfig = require('../config/auth');
const prisma = new PrismaClient();

const requireAuth = async (req, res, next) => {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({ success: false, message: 'Authentication required', code: 'UNAUTHORIZED' });
    }

    const token = authHeader.split(' ')[1];
    const decoded = jwt.verify(token, authConfig.jwt.secret);

    if (decoded.type !== 'access') {
      return res.status(401).json({ success: false, message: 'Invalid token type', code: 'UNAUTHORIZED' });
    }

    const user = await prisma.user.findUnique({
      where: { id: decoded.sub },
      include: { role: { include: { permissions: { include: { permission: true } } } }, warehouseAccess: true },
    });

    if (!user) {
      return res.status(401).json({ success: false, message: 'User not found', code: 'UNAUTHORIZED' });
    }

    if (user.status !== 'ACTIVE') {
      return res.status(403).json({ success: false, message: 'Account is inactive', code: 'FORBIDDEN' });
    }

    req.user = user;
    next();
  } catch (error) {
    if (error.name === 'TokenExpiredError') {
      return res.status(401).json({ success: false, message: 'Token expired', code: 'TOKEN_EXPIRED' });
    }
    return res.status(401).json({ success: false, message: 'Invalid token', code: 'UNAUTHORIZED' });
  }
};

const requirePermission = (requiredPermission) => {
  return (req, res, next) => {
    if (!req.user) {
      return res.status(401).json({ success: false, message: 'Authentication required', code: 'UNAUTHORIZED' });
    }

    const hasPermission = req.user.role.permissions.some(rp => rp.permission.action === requiredPermission);
    
    // ADMIN bypass
    if (req.user.role.name === 'ADMIN') {
      return next();
    }

    if (!hasPermission) {
      return res.status(403).json({ success: false, message: 'Missing required permission', code: 'FORBIDDEN' });
    }

    next();
  };
};

const requireWarehouseAccess = (req, res, next) => {
  if (!req.user) {
    return res.status(401).json({ success: false, message: 'Authentication required', code: 'UNAUTHORIZED' });
  }

  // Admin bypass
  if (req.user.role.name === 'ADMIN') {
    return next();
  }

  // Expect warehouseId in params, query, or body
  const warehouseId = req.params.warehouseId || req.query.warehouseId || req.body.warehouseId;
  
  if (!warehouseId) {
    // If route requires warehouse context but none provided
    return res.status(400).json({ success: false, message: 'Warehouse ID required', code: 'BAD_REQUEST' });
  }

  const hasAccess = req.user.warehouseAccess.some(wa => wa.warehouseId === warehouseId);
  
  if (!hasAccess) {
    return res.status(403).json({ success: false, message: 'No access to this warehouse', code: 'FORBIDDEN' });
  }

  next();
};

module.exports = {
  requireAuth,
  requirePermission,
  requireWarehouseAccess,
};
