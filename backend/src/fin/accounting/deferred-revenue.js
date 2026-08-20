/**
 * Deferred revenue at FUND + recognition at prepaid capture.
 * Called from inside the parent command's transaction(fn).
 */
import { randomUUID } from 'node:crypto'
import { BusinessClock } from '../clock.js'
import { loadActivePolicy } from './events.js'
import { insertEvaluatedEvents } from './events.js'
import { evaluateConsumption, evaluateFunding } from './policy-engine.js'

function iso(value) {
  if (!value) return BusinessClock.now()
  if (value instanceof Date) return value.toISOString()
  return String(value)
}

async function loadBillingContext(client, billingAccountId) {
  const { rows } = await client.query(
    `SELECT id, tenant_id, seller_legal_entity_id, billing_currency, environment
       FROM fin.billing_accounts WHERE id = $1`,
    [billingAccountId],
  )
  return rows[0] || null
}

async function existingEvent(client, { sourceType, sourceId, eventKind }) {
  const { rows } = await client.query(
    `SELECT id FROM fin.accounting_events
      WHERE source_type = $1 AND source_id = $2 AND event_kind = $3
      LIMIT 1`,
    [sourceType, sourceId, eventKind],
  )
  return rows[0] || null
}

async function insertGroupAndLine(client, {
  environment, tenantId, accountingEventId, sourceType, sourceId,
  amountMinor, now, actor, recognizedAmountMinor = '0', status = 'PENDING',
}) {
  const existing = await client.query(
    `SELECT id FROM fin.revenue_allocation_groups
      WHERE environment = $1 AND source_type = $2 AND source_id = $3
        AND obligation_key = 'DEFAULT'
      LIMIT 1`,
    [environment, sourceType, sourceId],
  )
  if (existing.rowCount) return existing.rows[0].id

  const groupId = randomUUID()
  await client.query(
    `INSERT INTO fin.revenue_allocation_groups (
       id, environment, tenant_id, accounting_event_id,
       source_type, source_id, obligation_key, amount_minor,
       created_at, created_by_actor_type, created_by_actor_id
     ) VALUES ($1,$2,$3,$4,$5,$6,'DEFAULT',$7,$8,$9,$10)`,
    [
      groupId, environment, tenantId, accountingEventId,
      sourceType, sourceId, amountMinor,
      now, actor?.type || 'SYSTEM', actor?.id || null,
    ],
  )
  await client.query(
    `INSERT INTO fin.revenue_allocation_lines (
       id, environment, tenant_id, group_id, amount_minor,
       recognition_at, recognized_amount_minor, status, created_at
     ) VALUES ($1,$2,$3,$4,$5,NULL,$6,$7,$8)`,
    [
      randomUUID(), environment, tenantId, groupId, amountMinor,
      recognizedAmountMinor, status, now,
    ],
  )
  return groupId
}

export async function recordDeferredRevenueForIntent(client, {
  intent, fundingTxId, now, actor,
}) {
  const clock = iso(now)
  if (!intent?.id) return { skipped: true, reason: 'no_intent' }
  const already = await existingEvent(client, {
    sourceType: 'PURCHASE_INTENT',
    sourceId: intent.id,
    eventKind: 'DEFERRED_REVENUE_CREATED',
  })
  if (already) return { skipped: true, reason: 'already_recorded', eventId: already.id }

  const ba = await loadBillingContext(client, intent.billing_account_id || intent.billingAccountId)
  const policy = await loadActivePolicy(client, {
    environment: intent.environment || ba?.environment || 'LIVE',
    now: clock,
  })
  const evaluated = evaluateFunding(intent, { id: fundingTxId }, policy.policy_definition)
  const inserted = await insertEvaluatedEvents(client, {
    evaluated,
    environment: intent.environment || ba?.environment || 'LIVE',
    tenantId: intent.tenant_id || intent.tenantId || ba?.tenant_id,
    billingAccountId: intent.billing_account_id || intent.billingAccountId || ba?.id,
    legalEntityId: ba?.seller_legal_entity_id,
    ledgerTransactionId: fundingTxId || null,
    now: clock,
    actor,
    currency: intent.currency || ba?.billing_currency,
  })
  const deferred = inserted[0]
  if (deferred && evaluated.groups[0]) {
    await insertGroupAndLine(client, {
      environment: intent.environment || ba?.environment || 'LIVE',
      tenantId: intent.tenant_id || intent.tenantId || ba?.tenant_id,
      accountingEventId: deferred.id,
      sourceType: 'PURCHASE_INTENT',
      sourceId: intent.id,
      amountMinor: evaluated.groups[0].amountMinor,
      now: clock,
      actor,
    })
  }
  return { skipped: false, events: inserted, groupSourceId: intent.id }
}

async function bumpRecognition(client, { groupId, amountMinor, ratedUsageId }) {
  if (!groupId) return null
  const { rows } = await client.query(
    `SELECT id, amount_minor, recognized_amount_minor
       FROM fin.revenue_allocation_lines
      WHERE group_id = $1
      ORDER BY created_at ASC, id ASC
      LIMIT 1
      FOR UPDATE`,
    [groupId],
  )
  const line = rows[0]
  if (!line) return null
  const next = BigInt(line.recognized_amount_minor) + BigInt(amountMinor)
  const cap = BigInt(line.amount_minor)
  const recognized = next > cap ? cap : next
  const status = recognized >= cap ? 'RECOGNIZED' : recognized > 0n ? 'PARTIAL' : 'PENDING'
  await client.query(
    `UPDATE fin.revenue_allocation_lines
        SET recognized_amount_minor = $2, status = $3, rated_usage_id = COALESCE($4, rated_usage_id)
      WHERE id = $1`,
    [line.id, recognized.toString(), status, ratedUsageId || null],
  )
  return { lineId: line.id, recognizedAmountMinor: recognized.toString(), status }
}

async function findGroupForHold(client, holdId) {
  const { rows } = await client.query(
    `SELECT g.id
       FROM fin.revenue_allocation_groups g
       JOIN fin.lots l
         ON l.purchase_intent_id = g.source_id
        AND g.source_type = 'PURCHASE_INTENT'
       JOIN fin.lot_allocations a ON a.lot_id = l.id
      WHERE a.hold_id = $1
      LIMIT 1`,
    [holdId],
  )
  return rows[0]?.id || null
}

export async function recognizeRevenueForCapture(client, {
  holdId, ratedUsageId, captureTxId, now, actor, postpaid = false,
}) {
  const clock = iso(now)
  let hold = null
  if (holdId) {
    const loaded = await client.query(`SELECT * FROM fin.holds WHERE id = $1`, [holdId])
    hold = loaded.rows[0] || null
  }
  let rated = null
  const ratedId = ratedUsageId || (hold?.subject_type === 'RATED_USAGE' ? hold.subject_id : null)
  if (ratedId) {
    const loaded = await client.query(`SELECT * FROM fin.rated_usage WHERE id = $1`, [ratedId])
    rated = loaded.rows[0] || null
  }
  if (!hold && !rated) return { skipped: true, reason: 'no_hold_or_rated' }

  let billingAccountId = hold?.billing_account_id || rated?.billing_account_id
  let ba = billingAccountId ? await loadBillingContext(client, billingAccountId) : null
  if (!ba && rated?.metered_usage_id) {
    const viaMeter = await client.query(
      `SELECT ba.id, ba.tenant_id, ba.seller_legal_entity_id, ba.billing_currency, ba.environment
         FROM fin.metered_usage m
         JOIN fin.holders h ON h.id = m.holder_id
         JOIN fin.billing_accounts ba ON ba.holder_id = h.id AND ba.environment = m.environment
        WHERE m.id = $1
        ORDER BY ba.id ASC
        LIMIT 1`,
      [rated.metered_usage_id],
    )
    ba = viaMeter.rows[0] || null
    billingAccountId = ba?.id || billingAccountId
  }
  const policy = await loadActivePolicy(client, {
    environment: hold?.environment || ba?.environment || 'LIVE',
    now: clock,
  })
  const evaluated = evaluateConsumption(
    { ...hold, postpaid },
    { txId: captureTxId, postpaid },
    rated,
    policy.policy_definition,
  )
  const inserted = await insertEvaluatedEvents(client, {
    evaluated,
    environment: hold?.environment || ba?.environment || 'LIVE',
    tenantId: hold?.tenant_id || ba?.tenant_id,
    billingAccountId: billingAccountId || ba?.id,
    legalEntityId: ba?.seller_legal_entity_id,
    ledgerTransactionId: captureTxId || null,
    now: clock,
    actor,
    currency: rated?.currency || ba?.billing_currency,
  })
  const recognized = evaluated.events.find((e) => e.eventKind === 'REVENUE_RECOGNIZED')
  const groupId = holdId ? await findGroupForHold(client, holdId) : null
  const line = recognized
    ? await bumpRecognition(client, {
      groupId,
      amountMinor: recognized.amountMinor,
      ratedUsageId: ratedId,
    })
    : null
  return { skipped: false, events: inserted, line }
}
