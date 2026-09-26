const { conflict, badRequest } = require('../utils/appError');
const {
  DOC_STATES,
  isTerminal,
  isValidState,
  allowedTransitions,
  canTransition,
} = require('../domain/documentState');

/**
 * Single entry point for every document state change.
 *
 * Documents are the polymorphic owners of stock moves, so this is deliberately
 * generic: a `tx` is passed in so the transition can commit together with the
 * stock mutation it authorises.
 *
 * @param tx     Prisma interactive-transaction client.
 * @param params.document       Prisma model delegate (e.g. `tx.receipt`).
 * @param params.documentId
 * @param params.to             target state.
 * @param params.data           extra columns to set alongside the state.
 * @param params.expectedStates optional whitelist the current state must be in.
 */
const transition = async (tx, { document, documentId, to, data = {}, expectedStates }) => {
  const current = await document.findUnique({
    where: { id: documentId },
    select: { id: true, state: true },
  });

  if (!current) {
    throw badRequest('Document not found', 'DOCUMENT_NOT_FOUND');
  }

  if (!isValidState(to)) {
    throw badRequest(`Unknown state: ${to}`, 'INVALID_STATE');
  }

  if (expectedStates && !expectedStates.includes(current.state)) {
    throw conflict(
      `Document is ${current.state}; expected one of ${expectedStates.join(', ')}`,
      'INVALID_STATE',
    );
  }

  if (!canTransition(current.state, to)) {
    if (isTerminal(current.state)) {
      throw conflict(
        `Document is already ${current.state} and cannot be changed`,
        'DOCUMENT_ALREADY_FINAL',
      );
    }
    throw conflict(
      `Cannot move document from ${current.state} to ${to}. Allowed: ${allowedTransitions(current.state).join(', ') || 'none'}`,
      'INVALID_STATE_TRANSITION',
    );
  }

  return document.update({
    where: { id: documentId },
    data: { state: to, ...data },
  });
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
  if (![DOC_STATES.READY, DOC_STATES.DRAFT, DOC_STATES.WAITING].includes(state)) {
    throw conflict(`Document in state ${state} cannot be validated`, 'INVALID_STATE');
  }
};

module.exports = { transition, assertCanValidate };
