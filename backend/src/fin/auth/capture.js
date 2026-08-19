/**
 * Thin product-facing wrappers around Stage 1 captureHold / voidHold.
 * Keep callers off the command-service module.
 */
import { BusinessClock } from '../clock.js'
import { captureHold } from '../ledger/transactions.js'

function envelope(input) {
  return {
    ...input,
    now: input.now || BusinessClock.now(),
    actorType: input.actorType || 'SYSTEM',
    actorId: input.actorId || null,
    actorEmail: input.actorEmail || 'system@fin.local',
  }
}

export function captureUsage(input) {
  return captureHold(envelope(input))
}
