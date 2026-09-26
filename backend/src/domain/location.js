/**
 * Location types. Enum values are stored as upper-case strings to match the
 * existing convention (`User.status` = 'ACTIVE' | 'INACTIVE', Role.name).
 */
const LOCATION_TYPES = Object.freeze({
  INTERNAL: 'INTERNAL',
  VENDOR: 'VENDOR',
  CUSTOMER: 'CUSTOMER',
  PRODUCTION: 'PRODUCTION',
  SCRAP: 'SCRAP',
  TRANSIT: 'TRANSIT',
});

const LOCATION_TYPE_VALUES = Object.freeze(Object.values(LOCATION_TYPES));

/**
 * Location types that hold real, countable stock. VENDOR and CUSTOMER are
 * boundary nodes: they terminate an inbound/outbound movement but never carry
 * a balance themselves.
 */
const STOCK_HOLDING_TYPES = Object.freeze([
  LOCATION_TYPES.INTERNAL,
  LOCATION_TYPES.PRODUCTION,
  LOCATION_TYPES.SCRAP,
  LOCATION_TYPES.TRANSIT,
]);

const BOUNDARY_TYPES = Object.freeze([LOCATION_TYPES.VENDOR, LOCATION_TYPES.CUSTOMER]);

const isStockHolding = (type) => STOCK_HOLDING_TYPES.includes(type);
const isBoundary = (type) => BOUNDARY_TYPES.includes(type);

const LOCATION_TYPE_LABELS = Object.freeze({
  INTERNAL: 'Internal',
  VENDOR: 'Vendor',
  CUSTOMER: 'Customer',
  PRODUCTION: 'Production',
  SCRAP: 'Scrap',
  TRANSIT: 'Transit',
});

module.exports = {
  LOCATION_TYPES,
  LOCATION_TYPE_VALUES,
  LOCATION_TYPE_LABELS,
  STOCK_HOLDING_TYPES,
  BOUNDARY_TYPES,
  isStockHolding,
  isBoundary,
};
