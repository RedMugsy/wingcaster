/**
 * Lot expiry → BREAKAGE_RECOGNIZED (C §5.8 / G §2.5).
 * Policy breakage = ON_EXPIRY (launch) or PROPORTIONAL_EXPECTED_BREAKAGE.
 */
import { randomUUID } from 'node:crypto'
import { BusinessClock } from '../clock.js'
import { insertEvaluatedEvents, loadActivePolicy } from './events.js'
import { evaluateExpiry } from './policy-engine.js'

function iso(value) {
  if (!value) return BusinessClock.now()
  if (value instanceof Date) return value.toISOString()
  return String(value)
}

export async function recordBreakageForLot(client, {
  lot, expiryTxId, now, actor,
}) {
  const clock = iso(now)
  if (!lot?.id) return { skipped: true, reason: 'no_lot' }
  const already = await client.query(
    `SELECT id FROM fin.accounting_events
      WHERE source_type = 'LOT' AND source_id = $1 AND event_kind = 'BREAKAGE_RECOGNIZED'
      LIMIT 1`,
    [lot.id],
  )
  if (already.rowCount) {
    return { skipped: true, reason: 'already_recorded', eventId: already.rows[0].id }
  }

  const ba = await client.query(
    `SELECT seller_legal_entity_id, tenant_id, billing_currency
       FROM fin.billing_accounts WHERE id = $1`,
    [lot.billing_account_id],
  )
  const billing = ba.rows[0]
  const policy = await loadActivePolicy(client, {
    environment: lot.environment || 'LIVE',
    now: clock,
  })
  const evaluated = evaluateExpiry(lot, policy.policy_definition)
  const inserted = await insertEvaluatedEvents(client, {
    evaluated,
    environment: lot.environment || 'LIVE',
    tenantId: lot.tenant_id || billing?.tenant_id,
    billingAccountId: lot.billing_account_id,
    legalEntityId: billing?.seller_legal_entity_id,
    ledgerTransactionId: expiryTxId || null,
    now: clock,
    actor,
    currency: lot.currency || billing?.billing_currency,
  })

  for (const group of evaluated.groups || []) {
    const groupId = randomUUID()
    await client.query(
      `INSERT INTO fin.revenue_allocation_groups (
         id, environment, tenant_id, accounting_event_id,
         source_type, source_id, obligation_key, amount_minor,
         created_at, created_by_actor_type, created_by_actor_id
       ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
       ON CONFLICT (environment, source_type, source_id, obligation_key) DO NOTHING`,
      [
        groupId, lot.environment, lot.tenant_id, inserted[0]?.id || null,
        group.sourceType, group.sourceId, group.obligationKey || 'BREAKAGE',
        group.amountMinor, clock, actor?.type || 'SYSTEM', actor?.id || null,
      ],
    )
  }
  return { skipped: evaluated.events.length === 0, events: inserted }
}
