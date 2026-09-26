/**
 * Roles are seeded by `prisma/seed.js` together with the permission matrix.
 * Two properties are policy-level rather than permission-level and therefore
 * live here:
 *
 *   ADMIN               — bypasses every permission *and* warehouse check.
 *   INVENTORY_MANAGER   — system-wide operator: full master-data and document
 *                         control, no warehouse restriction.
 *   WAREHOUSE_STAFF     — warehouse-scoped: may only see and act on the
 *                         warehouses it is explicitly assigned to.
 */
const ROLES = Object.freeze({
  ADMIN: 'ADMIN',
  INVENTORY_MANAGER: 'INVENTORY_MANAGER',
  WAREHOUSE_STAFF: 'WAREHOUSE_STAFF',
});

const isAdmin = (user) => user.role.name === ROLES.ADMIN;

/** True when the user's visibility must be limited to `warehouseAccess`. */
const isWarehouseScoped = (user) => user.role.name === ROLES.WAREHOUSE_STAFF;

const warehouseIdsOf = (user) => user.warehouseAccess.map((access) => access.warehouseId);

module.exports = { ROLES, isAdmin, isWarehouseScoped, warehouseIdsOf };
