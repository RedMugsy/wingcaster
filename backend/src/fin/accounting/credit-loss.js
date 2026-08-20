/**
 * Spec §73 / DL-117: BAD_DEBT_WRITE_OFF is credit-loss, not a revenue reversal.
 * Does not insert REFUND_REVENUE_REVERSED. Does not touch ledger CONSUMED postings.
 */
import { BusinessClock } from '../clock.js'
import { insertEvaluatedEvents, loadActivePolicy } from './events.js'
import { evaluateWriteOff } from './policy-engine.js'

function iso(value) {
  if (!value) return BusinessClock.now()
  if (value instanceof Date) return value.toISOString()
  return String(value)
}

export async function recordCreditLoss(client, {
  invoiceId, amountMinor, currency, tenantId, billingAccountId, legalEntityId,
  environment, now, actor,
}) {
  const clock = iso(now)
  const policy = await loadActivePolicy(client, {
    environment: environment || 'LIVE',
    now: clock,
  })
  const evaluated = evaluateWriteOff({
    id: invoiceId,
    invoiceId,
    amountMinor,
    currency: currency || 'USD',
  }, policy.policy_definition)
  if (evaluated.events.some((e) => e.eventKind === 'REFUND_REVENUE_REVERSED')) {
    throw new Error('evaluateWriteOff must not emit REFUND_REVENUE_REVERSED')
  }
  const inserted = await insertEvaluatedEvents(client, {
    evaluated,
    environment: environment || 'LIVE',
    tenantId,
    billingAccountId,
    legalEntityId,
    ledgerTransactionId: null,
    now: clock,
    actor,
    currency: currency || 'USD',
  })
  return { skipped: false, events: inserted }
}
