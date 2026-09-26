/**
 * Display formatting.
 *
 * Stock quantities and money cross the wire as strings because the API uses
 * PostgreSQL NUMERIC: the client must never reinterpret them as JavaScript
 * floats, and must not strip or pad them. These helpers only shape a value for
 * display.
 */

/** `1234.5000` -> `1,234.5`, `90.0000` -> `90`. Never rounds the value away. */
export const formatQuantity = (value, { maxDecimals = 4 } = {}) => {
  if (value === null || value === undefined || value === '') return '—';
  const [whole, fraction = ''] = String(value).split('.');
  const grouped = whole.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  const trimmed = fraction.replace(/0+$/, '').slice(0, maxDecimals);
  return trimmed ? `${grouped}.${trimmed}` : grouped;
};

export const formatMoney = (value, { currency = '₹', maxDecimals = 2 } = {}) => {
  if (value === null || value === undefined || value === '') return '—';
  return `${currency}${formatQuantity(value, { maxDecimals })}`;
};

export const formatDate = (value) => {
  if (!value) return '—';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '—';
  return date.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: '2-digit' });
};

export const formatDateTime = (value) => {
  if (!value) return '—';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '—';
  return date.toLocaleString(undefined, {
    year: 'numeric',
    month: 'short',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
};

/** Signed difference, used for ledger rows where direction matters. */
export const formatDelta = (value) => {
  if (value === null || value === undefined || value === '') return '—';
  return String(value).startsWith('-') ? formatQuantity(value) : `+${formatQuantity(value)}`;
};

export const locationTypeLabel = (type) => {
  const labels = {
    INTERNAL: 'Internal',
    PRODUCTION: 'Production',
    SCRAP: 'Scrap',
    TRANSIT: 'Transit',
    VENDOR: 'Vendor',
    CUSTOMER: 'Customer',
  };
  return labels[type] || type || '—';
};

export const documentTypeLabel = (type) => {
  const labels = {
    RECEIPT: 'Receipt',
    DELIVERY: 'Delivery',
    INTERNAL: 'Internal transfer',
    ADJUSTMENT: 'Adjustment',
  };
  return labels[type] || type || '—';
};

export const stateLabel = (state) => {
  const labels = {
    DRAFT: 'Draft',
    WAITING: 'Waiting',
    READY: 'Ready',
    DONE: 'Done',
    CANCELLED: 'Cancelled',
  };
  return labels[state] || state || '—';
};

export const stateTone = (state) => {
  const tones = {
    DRAFT: 'bg-slate-100 text-slate-700',
    WAITING: 'bg-amber-100 text-amber-800',
    READY: 'bg-sky-100 text-sky-800',
    DONE: 'bg-emerald-100 text-emerald-800',
    CANCELLED: 'bg-rose-100 text-rose-700',
  };
  return tones[state] || 'bg-slate-100 text-slate-700';
};

/** True when a location is allowed to hold a balance. */
export const isStockHolding = (type) =>
  ['INTERNAL', 'PRODUCTION', 'SCRAP', 'TRANSIT'].includes(type);

/** Turns a rejection into something worth showing a user. */
export const errorMessage = (error) => {
  if (!error) return 'Something went wrong';
  if (Array.isArray(error.data?.errors) && error.data.errors.length > 0) {
    return error.data.errors.map((field) => `${field.path}: ${field.message}`).join(', ');
  }
  return error.message || 'Something went wrong';
};

/** Field-level validation errors, keyed by field name, from an API rejection. */
export const fieldErrors = (error) => {
  if (!Array.isArray(error?.data?.errors)) return {};
  return error.data.errors.reduce((acc, field) => ({ ...acc, [field.path]: field.message }), {});
};
