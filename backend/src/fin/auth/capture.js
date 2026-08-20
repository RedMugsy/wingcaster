/**
 * Thin product-facing wrappers around Stage 1 captureHold / voidHold.
 * Keep callers off the command-service module.
 * Stage 9: REVENUE_RECOGNIZED is inserted on the ambient client after
 * captureHold returns (D-T11 ALS reuse — do not edit transactions.js).
 */
import { transaction } from '../../db.js'
import { BusinessClock } from '../clock.js'
import { recognizeRevenueForCapture } from '../accounting/deferred-revenue.js'
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

export async function captureUsage(input) {
  const env = envelope(input)
  return transaction(async (client) => {
    const captured = await captureHold(env)
    await recognizeRevenueForCapture(client, {
      holdId: captured.holdId || env.holdId,
      ratedUsageId: env.ratedUsageId,
      captureTxId: captured.txId,
      now: env.now,
      actor: { type: env.actorType, id: env.actorId, email: env.actorEmail },
    })
    return captured
  })
}
