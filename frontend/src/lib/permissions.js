/**
 * Client-side permission and warehouse-scope helpers.
 *
 * These exist so the UI can hide actions a user may not perform and can show an
 * honest list of the warehouses they are assigned to. They are presentation
 * only — every endpoint re-checks the caller's permissions and warehouse
 * assignments, so tampering with the DOM changes nothing the server trusts.
 */

export const ROLES = Object.freeze({
  ADMIN: 'ADMIN',
  INVENTORY_MANAGER: 'INVENTORY_MANAGER',
  WAREHOUSE_STAFF: 'WAREHOUSE_STAFF',
});

export const isAdmin = (user) => user?.role === ROLES.ADMIN;

export const isInventoryManager = (user) => user?.role === ROLES.INVENTORY_MANAGER;

/** Mirrors the server rule in backend/src/domain/roles.js. */
export const isWarehouseScoped = (user) => user?.role === ROLES.WAREHOUSE_STAFF;

export const hasPermission = (user, action) => {
  if (!user) return false;
  if (isAdmin(user)) return true;
  return (user.permissions || []).includes(action);
};

export const hasAnyPermission = (user, actions = []) =>
  actions.some((action) => hasPermission(user, action));

export const can = {
  manageUsers: (user) => hasPermission(user, 'user.manage'),
  readProducts: (user) => hasPermission(user, 'product.read'),
  writeCategories: (user) => hasPermission(user, 'product.write'),
  writeUoms: (user) => hasPermission(user, 'product.write'),
  writeProducts: (user) => hasPermission(user, 'product.write'),
  readWarehouses: (user) => hasPermission(user, 'warehouse.read'),
  writeWarehouses: (user) => hasPermission(user, 'warehouse.write'),
  readLocations: (user) => hasPermission(user, 'location.read'),
  writeLocations: (user) => hasPermission(user, 'location.write'),
  readStock: (user) => hasPermission(user, 'stock.read'),
  moveStock: (user) => hasPermission(user, 'stock.move'),
  viewMoveHistory: (user) => hasPermission(user, 'move_history.view') || hasPermission(user, 'stock.read'),
  viewDashboard: (user) => hasPermission(user, 'dashboard.view_all') || hasPermission(user, 'stock.read'),
  createReceipt: (user) => hasPermission(user, 'receipt.create'),
  editReceipt: (user) => hasPermission(user, 'receipt.edit'),
  validateReceipt: (user) => hasPermission(user, 'receipt.validate'),
  createDelivery: (user) => hasPermission(user, 'delivery.create'),
  editDelivery: (user) => hasPermission(user, 'delivery.edit'),
  pickDelivery: (user) => hasPermission(user, 'delivery.pick'),
  validateDelivery: (user) => hasPermission(user, 'delivery.validate'),
  createTransfer: (user) => hasPermission(user, 'internal_transfer.create'),
  validateTransfer: (user) => hasPermission(user, 'internal_transfer.validate'),
  createAdjustment: (user) => hasPermission(user, 'adjustment.create'),
  validateAdjustment: (user) => hasPermission(user, 'adjustment.validate'),
};

/** The warehouse ids a user may filter by, or `null` when unrestricted. */
export const scopedWarehouseIds = (user) =>
  isWarehouseScoped(user) ? user.warehouseIds || [] : null;
