/**
 * Document / stock-move state machine.
 *
 *   DRAFT ──► WAITING ──► READY ──► DONE
 *     │          │          │
 *     └──────────┴──────────┴──────► CANCELLED
 *
 * DONE and CANCELLED are terminal. No stock is ever mutated before the final
 * validation step, and a terminal document can never transition again.
 */
const DOC_STATES = Object.freeze({
  DRAFT: 'DRAFT',
  WAITING: 'WAITING',
  READY: 'READY',
  DONE: 'DONE',
  CANCELLED: 'CANCELLED',
});

const DOC_STATE_VALUES = Object.freeze(Object.values(DOC_STATES));

const TERMINAL_STATES = Object.freeze([DOC_STATES.DONE, DOC_STATES.CANCELLED]);

const ALLOWED_TRANSITIONS = Object.freeze({
  DRAFT: [DOC_STATES.WAITING, DOC_STATES.READY, DOC_STATES.CANCELLED],
  WAITING: [DOC_STATES.READY, DOC_STATES.CANCELLED],
  READY: [DOC_STATES.DONE, DOC_STATES.CANCELLED],
  DONE: [],
  CANCELLED: [],
});

/**
 * Validation is a separate legal edge, not an ordinary transition: it is the
 * moment stock is posted, so it is reachable from any state that still allows
 * it. Receipts are validated straight from DRAFT, while a delivery waits for
 * READY. DONE and CANCELLED are excluded, which is what stops a second
 * validation from consuming stock twice.
 */
const VALIDATABLE_STATES = Object.freeze([DOC_STATES.DRAFT, DOC_STATES.WAITING, DOC_STATES.READY]);

const isTerminal = (state) => TERMINAL_STATES.includes(state);
const isValidState = (state) => DOC_STATE_VALUES.includes(state);
const allowedTransitions = (state) => ALLOWED_TRANSITIONS[state] || [];
const canTransition = (from, to) => allowedTransitions(from).includes(to);
const canValidate = (state) => VALIDATABLE_STATES.includes(state);

module.exports = {
  DOC_STATES,
  DOC_STATE_VALUES,
  TERMINAL_STATES,
  ALLOWED_TRANSITIONS,
  VALIDATABLE_STATES,
  isTerminal,
  isValidState,
  allowedTransitions,
  canTransition,
  canValidate,
};
