/**
 * Thin product-facing wrapper around Stage 1 voidHold.
 */
import { BusinessClock } from '../clock.js'
import { voidHold } from '../ledger/transactions.js'

export function voidUsage(input) {
  return voidHold({
    ...input,
    now: input.now || BusinessClock.now(),
    actorType: input.actorType || 'SYSTEM',
    actorId: input.actorId || null,
    actorEmail: input.actorEmail || 'system@fin.local',
  })
}
