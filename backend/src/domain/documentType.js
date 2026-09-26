/**
 * Movement semantics, keyed by document type.
 *
 *   receipt           VENDOR  ──►  stock-holding
 *   delivery          stock-holding ──► CUSTOMER
 *   internal          stock-holding ──► stock-holding (total stock preserved)
 *   adjustment        SCRAP / adjustment side ◄──► stock-holding
 *
 * A "stock-holding" location is INTERNAL, PRODUCTION, SCRAP or TRANSIT.
 * VENDOR and CUSTOMER are boundary nodes: they terminate a movement but never
 * carry a balance, which is why a vendor receipt needs no tracked vendor stock.
 */
const { isStockHolding } = require('./location');
const { badRequest } = require('../utils/appError');

const DOCUMENT_TYPES = Object.freeze({
  RECEIPT: 'RECEIPT',
  DELIVERY: 'DELIVERY',
  INTERNAL: 'INTERNAL',
  ADJUSTMENT: 'ADJUSTMENT',
});

const DOCUMENT_TYPE_VALUES = Object.freeze(Object.values(DOCUMENT_TYPES));

/**
 * Infers the movement's document type from its two endpoints.
 *
 * Used by the ad-hoc direct-move endpoint, where the operator names a source and
 * a destination rather than a document. The four shapes are unambiguous:
 *
 *   VENDOR      -> holding   a receipt   (goods arriving)
 *   holding     -> CUSTOMER  a delivery  (goods leaving)
 *   holding     -> SCRAP     an adjustment (write-off)
 *   holding     -> holding   an internal transfer
 *
 * Anything else — two boundaries, customer -> holding, scrap as a source into
 * ordinary stock — is a reversal or a side effect of another document, and must
 * be posted explicitly rather than guessed at.
 */
const inferDocumentType = (fromType, toType) => {
  if (fromType === 'VENDOR' && isStockHolding(toType)) return DOCUMENT_TYPES.RECEIPT;
  if (isStockHolding(fromType) && toType === 'CUSTOMER') return DOCUMENT_TYPES.DELIVERY;
  if (isStockHolding(fromType) && toType === 'SCRAP') return DOCUMENT_TYPES.ADJUSTMENT;
  if (isStockHolding(fromType) && isStockHolding(toType)) return DOCUMENT_TYPES.INTERNAL;

  throw badRequest(
    `Cannot infer a document type for a ${fromType} -> ${toType} movement; specify documentType explicitly`,
    'AMBIGUOUS_DOCUMENT_TYPE',
  );
};

const REFERENCE_PREFIX = Object.freeze({
  RECEIPT: 'RCP',
  DELIVERY: 'DLV',
  INTERNAL: 'TRF',
  ADJUSTMENT: 'ADJ',
  MOVE: 'MOV',
});

module.exports = {
  DOCUMENT_TYPES,
  DOCUMENT_TYPE_VALUES,
  REFERENCE_PREFIX,
  inferDocumentType,
};
