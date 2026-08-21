/**
 * Spec §73 / DL-117: BAD_DEBT_WRITE_OFF is credit-loss, not a revenue reversal.
 * Does not insert REFUND_REVENUE_REVERSED. Does not touch ledger CONSUMED postings.
 */
import { BusinessClock } from '../clock.js'
import { CATEGORY, finError } from '../errors.js'
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
  let writeOffMinor = amountMinor
  let writeOffCurrency = currency || 'USD'
  if (invoiceId) {
    const invoice = (await client.query(
      `SELECT i.status, i.total_minor, i.currency, i.billing_account_id, i.legal_entity_id, i.tenant_id
         FROM fin.invoices i WHERE i.id = $1`,
      [invoiceId],
    )).rows[0]
    if (invoice) {
      if (!['ISSUED', 'PART_PAID'].includes(invoice.status)) {
        throw finError('INVOICE_NOT_DRAFT', {
          category: CATEGORY.PRECONDITION,
          details: { reason: 'write_off_requires_issued_or_part_paid', status: invoice.status },
        })
      }
      const allocated = (await client.query(
        `SELECT COALESCE(SUM(amount_minor), 0)::bigint AS qty
           FROM fin.invoice_payment_allocations WHERE invoice_id = $1`,
        [invoiceId],
      )).rows[0]
      const outstanding = BigInt(invoice.total_minor) - BigInt(allocated.qty)
      if (writeOffMinor == null) writeOffMinor = outstanding.toString()
      writeOffCurrency = invoice.currency || writeOffCurrency
      billingAccountId = billingAccountId || invoice.billing_account_id
      legalEntityId = legalEntityId || invoice.legal_entity_id
      tenantId = tenantId || invoice.tenant_id
    }
  }
  const policy = await loadActivePolicy(client, {
    environment: environment || 'LIVE',
    now: clock,
  })
  const evaluated = evaluateWriteOff({
    id: invoiceId,
    invoiceId,
    amountMinor: writeOffMinor,
    currency: writeOffCurrency,
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
    currency: writeOffCurrency,
  })
  return { skipped: false, events: inserted }
}
