const { conflict, badRequest } = require('../utils/appError');
const {
  DOC_STATES,
  VALIDATABLE_STATES,
  isTerminal,
  isValidState,
  allowedTransitions,
  canTransition,
  canValidate,
} = require('../domain/documentState');

/**
 * Single entry point for every document state change.
 *
 * Documents are the polymorphic owners of stock moves, so this is deliberately
 * generic: a `tx` is passed in so the transition can commit together with the
 * stock mutation it authorises.
 *
 * Every write is a compare-and-set on the state that was read: the UPDATE
 * carries `state` back in its WHERE clause, so a request that raced another one
 * matches no row and is rejected instead of silently overwriting it. That is
 * what makes double validation impossible rather than merely unlikely.
 */

/** Prisma raises P2025 when a compare-and-set update matches no row. */
const isCompareAndSetMiss = (error) => error?.code === 'P2025';

const readState = async (document, documentId) => {
  const current = await document.findUnique({
    where: { id: documentId },
    select: { id: true, state: true },
  });

  if (!current) {
    throw badRequest('Document not found', 'DOCUMENT_NOT_FOUND');
  }
  if (!isValidState(current.state)) {
    throw badRequest(`Document has unknown state: ${current.state}`, 'INVALID_STATE');
  }

  return current;
};

const assertTransitionAllowed = (from, to) => {
  if (canTransition(from, to)) return;

  if (isTerminal(from)) {
    throw conflict(`Document is already ${from} and cannot be changed`, 'DOCUMENT_ALREADY_FINAL');
  }
  throw conflict(
    `Cannot move document from ${from} to ${to}. Allowed: ${allowedTransitions(from).join(', ') || 'none'}`,
    'INVALID_STATE_TRANSITION',
  );
};

/**
 * Applies `data` only while the document is still in `expectedState`.
 *
 * @param document Prisma model delegate (e.g. `tx.receipt`).
 * @param include  optional `include` for the returned record.
 */
const compareAndSetState = async (document, documentId, expectedState, data, include) => {
  try {
    return await document.update({
      where: { id: documentId, state: expectedState },
      data,
      ...(include ? { include } : {}),
    });
  } catch (error) {
    if (isCompareAndSetMiss(error)) {
      throw conflict(
        'Document was changed by another request; reload and retry',
        'DOCUMENT_STATE_CONFLICT',
      );
    }
    throw error;
  }
};

/**
 * @param params.document       Prisma model delegate (e.g. `tx.receipt`).
 * @param params.documentId
 * @param params.to             target state.
 * @param params.data           extra columns to set alongside the state.
 * @param params.expectedStates optional whitelist the current state must be in.
 */
const transition = async (tx, { document, documentId, to, data = {}, expectedStates, include }) => {
  if (!isValidState(to)) {
    throw badRequest(`Unknown state: ${to}`, 'INVALID_STATE');
  }

  const current = await readState(document, documentId);

  if (expectedStates && !expectedStates.includes(current.state)) {
    throw conflict(
      `Document is ${current.state}; expected one of ${expectedStates.join(', ')}`,
      'INVALID_STATE',
    );
  }

  assertTransitionAllowed(current.state, to);

  return compareAndSetState(document, documentId, current.state, { state: to, ...data }, include);
};

/**
 * Guard for validation endpoints: a document must be in a state that permits
 * validation, otherwise double validation would consume stock twice.
 */
const assertCanValidate = (state) => {
  if (state === DOC_STATES.DONE) {
    throw conflict('Document is already validated', 'DOCUMENT_ALREADY_VALIDATED');
  }
  if (state === DOC_STATES.CANCELLED) {
    throw conflict('Document is cancelled and cannot be validated', 'DOCUMENT_CANCELLED');
  }
  if (!canValidate(state)) {
    throw conflict(`Document in state ${state} cannot be validated`, 'INVALID_STATE');
  }
};

/**
 * The validating edge: moves a document to DONE atomically.
 *
 * Call this *after* the stock movements it authorises, inside the same `tx`, so
 * that a losing racer's movements are rolled back with its state change. The
 * state flip is a compare-and-set, so two concurrent validations of the same
 * document cannot both succeed.
 */
const finalize = async (tx, { document, documentId, data = {}, include }) => {
  const current = await readState(document, documentId);
  assertCanValidate(current.state);

  return compareAndSetState(
    document,
    documentId,
    current.state,
    { state: DOC_STATES.DONE, ...data },
    include,
  );
};

module.exports = { transition, finalize, assertCanValidate, VALIDATABLE_STATES };
