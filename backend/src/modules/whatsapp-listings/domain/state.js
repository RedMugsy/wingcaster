/**
 * State machine transitions for the WhatsApp listing intake session.
 */

import { SessionState } from './types.js'

export const transitions = {
  [SessionState.IDLE]: [SessionState.COLLECTING],
  [SessionState.COLLECTING]: [SessionState.COLLECTING, SessionState.READY_FOR_EXTRACTION, SessionState.EXTRACTING, SessionState.ERROR],
  [SessionState.READY_FOR_EXTRACTION]: [SessionState.EXTRACTING, SessionState.ERROR],
  [SessionState.EXTRACTING]: [SessionState.AWAITING_APPROVAL, SessionState.ERROR],
  [SessionState.AWAITING_APPROVAL]: [SessionState.APPROVED, SessionState.PUBLISHING, SessionState.COLLECTING, SessionState.AWAITING_PRICE_ADJUSTMENT, SessionState.DISCARDED, SessionState.ERROR],
  [SessionState.AWAITING_PRICE_ADJUSTMENT]: [SessionState.AWAITING_APPROVAL, SessionState.DISCARDED, SessionState.ERROR],
  [SessionState.APPROVED]: [SessionState.PUBLISHING, SessionState.ERROR],
  [SessionState.PUBLISHING]: [SessionState.COMPLETED, SessionState.ERROR],
  [SessionState.COMPLETED]: [],
  [SessionState.ERROR]: [SessionState.COLLECTING, SessionState.READY_FOR_EXTRACTION, SessionState.EXTRACTING, SessionState.PUBLISHING],
}

export function canTransition(from, to) {
  const allowed = transitions[from] || []
  return allowed.includes(to)
}

export function transition(session, to) {
  if (!canTransition(session.state, to)) {
    throw new Error(`Invalid state transition from ${session.state} to ${to}`)
  }
  return {
    ...session,
    state: to,
    updated_at: new Date().toISOString(),
  }
}
