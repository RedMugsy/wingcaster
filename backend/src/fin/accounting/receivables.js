/**
 * Postpaid capture → RECEIVABLE_CREATED + REVENUE_RECOGNIZED (same units).
 */
import { randomUUID } from 'node:crypto'
import { BusinessClock } from '../clock.js'
import { insertEvaluatedEvents, loadActivePolicy } from './events.js'
import { evaluatePostpaidCapture } from './policy-engine.js'

function iso(value) {
  if (!value) return BusinessClock.now()
  if (value instanceof Date) return value.toISOString()
  return String(value)
}

export async function recordPostpaidCapture(client, {
  reservationId, captureTxId, amountMinor, now, actor,
}) {
  const clock = iso(now)
  const locked = await client.query(
    `SELECT r.*, f.billing_account_id, f.tenant_id, f.currency, f.environment
       FROM fin.facility_reservations r
       JOIN fin.credit_facilities f ON f.id = r.facility_id
      WHERE r.id = $1`,
    [reservationId],
  )
  const reservation = locked.rows[0]
  if (!reservation) return { skipped: true, reason: 'reservation_missing' }

  const ba = await client.query(
    `SELECT seller_legal_entity_id, tenant_id, billing_currency
       FROM fin.billing_accounts WHERE id = $1`,
    [reservation.billing_account_id],
  )
  const billing = ba.rows[0]
  const policy = await loadActivePolicy(client, {
    environment: reservation.environment,
    now: clock,
  })
  const evaluated = evaluatePostpaidCapture(
    {
      ...reservation,
      reserved_minor: amountMinor ?? reservation.reserved_minor,
      reservationId,
    },
    { txId: captureTxId, amountMinor },
    { amount_minor: amountMinor ?? reservation.reserved_minor, currency: reservation.currency },
    policy.policy_definition,
  )
  const inserted = await insertEvaluatedEvents(client, {
    evaluated,
    environment: reservation.environment,
    tenantId: reservation.tenant_id || billing?.tenant_id,
    billingAccountId: reservation.billing_account_id,
    legalEntityId: billing?.seller_legal_entity_id,
    ledgerTransactionId: captureTxId || null,
    now: clock,
    actor,
    currency: reservation.currency || billing?.billing_currency,
  })

  const existing = await client.query(
    `SELECT id FROM fin.revenue_allocation_groups
      WHERE environment = $1 AND source_type = 'FACILITY_RESERVATION' AND source_id = $2
      LIMIT 1`,
    [reservation.environment, reservationId],
  )
  if (!existing.rowCount && evaluated.groups[0]) {
    const groupId = randomUUID()
    const amount = evaluated.groups[0].amountMinor
    await client.query(
      `INSERT INTO fin.revenue_allocation_groups (
         id, environment, tenant_id, accounting_event_id,
         source_type, source_id, obligation_key, amount_minor,
         created_at, created_by_actor_type, created_by_actor_id
       ) VALUES ($1,$2,$3,$4,'FACILITY_RESERVATION',$5,'DEFAULT',$6,$7,$8,$9)`,
      [
        groupId, reservation.environment, reservation.tenant_id || billing?.tenant_id,
        inserted[0]?.id || null, reservationId, amount,
        clock, actor?.type || 'SYSTEM', actor?.id || null,
      ],
    )
    await client.query(
      `INSERT INTO fin.revenue_allocation_lines (
         id, environment, tenant_id, group_id, amount_minor,
         recognition_at, recognized_amount_minor, status, created_at
       ) VALUES ($1,$2,$3,$4,$5,NULL,$5,'RECOGNIZED',$6)`,
      [
        randomUUID(), reservation.environment, reservation.tenant_id || billing?.tenant_id,
        groupId, amount, clock,
      ],
    )
  }
  return { skipped: false, events: inserted }
}
