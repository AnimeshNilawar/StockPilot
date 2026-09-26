const { z } = require('zod');
const { unauthorized, forbidden, badRequest } = require('../utils/appError');
const { isAdmin, isWarehouseScoped, warehouseIdsOf } = require('../domain/roles');

/**
 * Restricts a query to the warehouses the caller is assigned to. Only
 * warehouse-scoped roles are limited: ADMIN and INVENTORY_MANAGER are
 * system-wide operators.
 *
 * `key` is the field the scope applies to: `warehouseId` on warehouse-scoped
 * models such as Location, or `id` when listing the warehouses themselves.
 */
const applyWarehouseScope = (user, where = {}, { key = 'warehouseId' } = {}) => {
  if (!isWarehouseScoped(user)) return where;
  return { ...where, [key]: { in: warehouseIdsOf(user) } };
};

/** True when the caller may see records belonging to `warehouseId`. */
const canAccessWarehouse = (user, warehouseId) =>
  !isWarehouseScoped(user) || warehouseIdsOf(user).includes(warehouseId);

const assertWarehouseAccess = (user, warehouseId) => {
  if (!canAccessWarehouse(user, warehouseId)) {
    throw forbidden('No access to this warehouse');
  }
};

/**
 * `requireWarehouseAccess` factory. Resolves the warehouse id with `pick` (in
 * order: params, query, body) and checks it against the caller's assignments.
 * Mount it *after* `validate()` so the id is known to be a well-formed UUID.
 */
const requireWarehouseAccess =
  (pick = (req) => req.params.warehouseId) =>
  (req, res, next) => {
    try {
      if (!req.user) throw unauthorized('Authentication required');
      if (isAdmin(req.user)) return next();

      const warehouseId = pick(req);
      if (!warehouseId) throw badRequest('Warehouse ID required');

      assertWarehouseAccess(req.user, warehouseId);
      return next();
    } catch (error) {
      return next(error);
    }
  };

/**
 * Guards warehouse-scoped *creation* payloads: the body must reference a
 * warehouse the caller is allowed to write into.
 */
const requireBodyWarehouseAccess = () => (req, res, next) => {
  try {
    if (!req.user) throw unauthorized('Authentication required');
    if (isAdmin(req.user)) return next();

    const body = req.valid ? req.valid.body : req.body;
    const warehouseId = body && body.warehouseId;
    if (!warehouseId) throw badRequest('Warehouse ID required');

    assertWarehouseAccess(req.user, warehouseId);
    return next();
  } catch (error) {
    return next(error);
  }
};

/** Parses `:id` style path parameters as UUIDs. */
const uuidParam = (name = 'id') =>
  z.object({ [name]: z.string().uuid('Invalid identifier') }).passthrough();

module.exports = {
  applyWarehouseScope,
  canAccessWarehouse,
  assertWarehouseAccess,
  requireWarehouseAccess,
  requireBodyWarehouseAccess,
  uuidParam,
};
