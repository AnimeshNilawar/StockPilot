/**
 * Partner (business counterparty) types.
 *
 * A partner is the entity on the other side of a document: the supplier whose
 * goods arrive on a receipt, or the customer the goods leave for on a delivery.
 * One record can play both roles, which is why BOTH is a first-class type rather
 * than two separate tables.
 *
 * Enum values are stored as upper-case strings, matching `Location.type` and
 * `User.status`.
 */
const PARTNER_TYPES = Object.freeze({
  SUPPLIER: 'SUPPLIER',
  CUSTOMER: 'CUSTOMER',
  BOTH: 'BOTH',
});

const PARTNER_TYPE_VALUES = Object.freeze(Object.values(PARTNER_TYPES));

const PARTNER_TYPE_LABELS = Object.freeze({
  SUPPLIER: 'Supplier',
  CUSTOMER: 'Customer',
  BOTH: 'Supplier & Customer',
});

const isSupplier = (type) => type === PARTNER_TYPES.SUPPLIER || type === PARTNER_TYPES.BOTH;

const isCustomer = (type) => type === PARTNER_TYPES.CUSTOMER || type === PARTNER_TYPES.BOTH;

/**
 * Partner types that may be picked for a document moving in `role`. A filter on
 * one concrete type always widens to BOTH, otherwise a trading partner would
 * silently disappear from every dropdown.
 */
const typesForRole = (role) => {
  if (role === PARTNER_TYPES.SUPPLIER) return [PARTNER_TYPES.SUPPLIER, PARTNER_TYPES.BOTH];
  if (role === PARTNER_TYPES.CUSTOMER) return [PARTNER_TYPES.CUSTOMER, PARTNER_TYPES.BOTH];
  return [...PARTNER_TYPE_VALUES];
};

module.exports = {
  PARTNER_TYPES,
  PARTNER_TYPE_VALUES,
  PARTNER_TYPE_LABELS,
  isSupplier,
  isCustomer,
  typesForRole,
};
