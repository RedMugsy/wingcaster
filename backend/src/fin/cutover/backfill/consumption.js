/**
 * Stage 13b commercial.ledger_entries consumption → fin.rated_usage
 * + historical accounting_events (DL-180 / DL-138).
 * No outbox. event_at = legacy.created_at.
 */
import { randomUUID } from 'node:crypto'
import { transaction } from '../../../db.js'
import { BusinessClock } from '../../clock.js'
import {
  loadActivePolicy,
  resolveAccountingPeriod,
} from '../../accounting/events.js'
import { applyBackfillSession, withBackfillLock } from './session.js'
import { resolveFinContextForCommercialTenant } from './tenant-map.js'
import { recordCorrection } from './corrections.js'
import { ensureBackfillRatingScaffold } from './scaffold.js'

export const CONSUMPTION_SOURCE = 'commercial.ledger_entries'
export const CONSUMPTION_SOURCE_SYSTEM = 'commercial.ledger_entries'

function iso(value) {
  if (!value) return null
  if (value instanceof Date) return value.toISOString()
  return String(value)
}

function unitsOf(amount) {
  return Math.max(1, Math.abs(Math.round(Number(amount) || 0)) || 1)
}

async function hasPriorGrant(client, row) {
  const { rows } = await client.query(
    `SELECT 1
       FROM commercial.ledger_entries g
      WHERE g.tenant_id = $1
        AND g.quota_key = $2
        AND g.billing_period = $3
        AND g.type = 'allowance_grant'
        AND g.created_at < $4::timestamptz
      LIMIT 1`,
    [row.tenant_id, row.quota_key, row.billing_period, row.created_at],
  )
  return rows.length > 0
}

async function insertHistoricalAccounting(client, {
  environment, ctx, ratedUsageId, amountMinor, currency, eventAt, now, sourceRowId,
}) {
  const policy = await loadActivePolicy(client, { environment, now: eventAt })
  const period = await resolveAccountingPeriod(client, {
    environment,
    legalEntityId: ctx.legalEntityId,
    eventAt,
  })
  for (const eventKind of ['DEFERRED_REVENUE_CREATED', 'REVENUE_RECOGNIZED']) {
    const id = randomUUID()
    await client.query(
      `INSERT INTO fin.accounting_events (
         id, environment, tenant_id, billing_account_id, legal_entity_id,
         event_kind, event_at, amount_minor, currency,
         source_type, source_id, ledger_transaction_id,
         accounting_policy_version_id, accounting_period_id, memo,
         created_at, created_by_actor_type, created_by_actor_id,
         source_system, source_row_id
       ) VALUES (
         $1,$2,$3,$4,$5,
         $6,$7,$8,$9,
         'RATED_USAGE',$10,NULL,
         $11,$12,$13,
         $14,'SYSTEM',NULL,
         $15,$16
       )
       ON CONFLICT (source_system, source_row_id, event_kind)
       WHERE source_row_id IS NOT NULL
       DO NOTHING`,
      [
        id, environment, ctx.tenantId, ctx.billingAccountId, ctx.legalEntityId,
        eventKind, eventAt, amountMinor, currency,
        ratedUsageId,
        policy.id, period.id, `cutover backfill ${eventKind}`,
        now, CONSUMPTION_SOURCE_SYSTEM, String(sourceRowId),
      ],
    )
  }
}

async function runChunk(client, {
  environment, since, until, limit, afterId, stamped,
}) {
  await applyBackfillSession(client, environment)
  const { rows: legacy } = await client.query(
    `SELECT id, tenant_id, billing_period, type, quota_key, amount,
            source_event_id, metadata, created_at
       FROM commercial.ledger_entries
      WHERE type = 'consumption'
        AND created_at < $2::timestamptz
        AND (
          created_at > $1::timestamptz
          OR (created_at = $1::timestamptz AND id > COALESCE($3, ''))
          OR ($3 IS NULL AND created_at >= $1::timestamptz)
        )
      ORDER BY created_at ASC, id ASC
      LIMIT $4`,
    [since, until, afterId, limit],
  )

  let rowsWritten = 0
  let rowsCorrected = 0
  let lastProcessedAt = since
  let lastProcessedId = afterId

  for (const row of legacy) {
    lastProcessedAt = iso(row.created_at) || lastProcessedAt
    lastProcessedId = row.id

    const ctx = await resolveFinContextForCommercialTenant({
      publicTenantId: row.tenant_id,
      environment,
      client,
    })
    if (!ctx.ok) {
      await recordCorrection(client, {
        environment,
        source: CONSUMPTION_SOURCE,
        sourceRowId: row.id,
        correctionKind: ctx.missing,
        reason: `fin context missing for public tenant ${row.tenant_id}`,
        legacyPayload: row,
        now: stamped,
      })
      rowsCorrected += 1
      continue
    }

    const orphan = !(await hasPriorGrant(client, row))
    if (orphan) {
      await recordCorrection(client, {
        environment,
        source: CONSUMPTION_SOURCE,
        sourceRowId: row.id,
        correctionKind: 'ORPHAN_CONSUMPTION',
        reason: 'no allowance_grant before this consumption in the same period',
        legacyPayload: row,
        now: stamped,
      })
      rowsCorrected += 1
      continue
    }

    const billing = await client.query(
      `SELECT billing_currency FROM fin.billing_accounts WHERE id = $1`,
      [ctx.billingAccountId],
    )
    let currency = billing.rows[0]?.billing_currency || null
    if (!currency || String(currency).length !== 3) {
      await recordCorrection(client, {
        environment,
        source: CONSUMPTION_SOURCE,
        sourceRowId: row.id,
        correctionKind: 'CURRENCY_UNKNOWN',
        reason: 'billing account currency missing',
        legacyPayload: row,
        now: stamped,
      })
      rowsCorrected += 1
      currency = 'USD'
    }

    const existingRated = await client.query(
      `SELECT id FROM fin.rated_usage
        WHERE source_system = $1 AND source_row_id = $2`,
      [CONSUMPTION_SOURCE_SYSTEM, String(row.id)],
    )
    if (existingRated.rows[0]) {
      try {
        await insertHistoricalAccounting(client, {
          environment,
          ctx,
          ratedUsageId: existingRated.rows[0].id,
          amountMinor: 0,
          currency: currency || 'USD',
          eventAt: iso(row.created_at) || stamped,
          now: stamped,
          sourceRowId: row.id,
        })
      } catch {
        // already corrected on the original write
      }
      continue
    }

    const scaffold = await ensureBackfillRatingScaffold(client, {
      environment,
      tenantId: ctx.tenantId,
      holderId: ctx.holderId,
      billingAccountId: ctx.billingAccountId,
      legalEntityId: ctx.legalEntityId,
      currency,
      now: stamped,
    })

    const eventAt = iso(row.created_at) || stamped
    const measured = unitsOf(row.amount)
    const amountMinor = 0
    const residencyKey = (await client.query(
      `SELECT default_residency_key FROM fin.tenants WHERE id = $1`,
      [ctx.tenantId],
    )).rows[0]?.default_residency_key || '__platform__'

    const usageId = randomUUID()
    const usageInserted = await client.query(
      `INSERT INTO fin.usage_events (
         id, environment, residency_key, tenant_id, holder_id, billing_account_id,
         source_system, source_event_id, event_type, event_kind,
         quantity_units, dimensions, occurred_at, received_at, ingestion_version,
         created_at
       ) VALUES (
         $1,$2,$3,$4,$5,$6,
         $7,$8,$9,'ORIGINAL',
         $10,$11::jsonb,$12,$12,1,
         $12
       )
       ON CONFLICT (environment, source_system, source_event_id, residency_key)
       DO NOTHING
       RETURNING id, residency_key`,
      [
        usageId, environment, residencyKey, ctx.tenantId, ctx.holderId, ctx.billingAccountId,
        CONSUMPTION_SOURCE_SYSTEM, String(row.id), String(row.quota_key || 'consumption'),
        measured,
        JSON.stringify({
          cutover_origin: 'backfill',
          public_tenant_id: row.tenant_id,
          billing_period: row.billing_period,
        }),
        eventAt,
      ],
    )
    let usageEventId = usageInserted.rows[0]?.id
    let usageResidency = usageInserted.rows[0]?.residency_key
    if (!usageEventId) {
      const existing = await client.query(
        `SELECT id, residency_key FROM fin.usage_events
          WHERE environment = $1 AND source_system = $2
            AND source_event_id = $3 AND residency_key = $4`,
        [environment, CONSUMPTION_SOURCE_SYSTEM, String(row.id), residencyKey],
      )
      usageEventId = existing.rows[0]?.id
      usageResidency = existing.rows[0]?.residency_key
    }

    const meteredId = randomUUID()
    const meteredInserted = await client.query(
      `INSERT INTO fin.metered_usage (
         id, environment, tenant_id, meter_version_id, holder_id, period_key,
         quantity_units, computation_hash, status, metered_at
       ) VALUES (
         $1,$2,$3,$4,$5,$6,$7,$8,'ACTIVE',$9
       )
       ON CONFLICT DO NOTHING
       RETURNING id`,
      [
        meteredId, environment, ctx.tenantId, scaffold.meterVersionId, ctx.holderId,
        row.billing_period || eventAt.slice(0, 7),
        measured, `cutover-backfill:${row.id}`, eventAt,
      ],
    )
    const resolvedMeteredId = meteredInserted.rows[0]?.id || meteredId
    if (usageEventId) {
      await client.query(
        `INSERT INTO fin.metered_usage_sources (
           metered_usage_id, usage_event_id, residency_key, contribution_units
         ) VALUES ($1,$2,$3,$4)
         ON CONFLICT DO NOTHING`,
        [resolvedMeteredId, usageEventId, usageResidency, measured],
      )
    }

    const ratedId = randomUUID()
    const explanation = {
      amount_minor: amountMinor,
      cutover_origin: 'backfill',
      source_row_id: String(row.id),
    }
    const ratedInserted = await client.query(
      `INSERT INTO fin.rated_usage (
         id, environment, tenant_id, metered_usage_id, contract_version_id,
         price_version_id, measured_units, included_units, billable_units,
         amount_minor, currency, rating_hash, explanation, late_class,
         occurred_at, received_at, metered_at, rated_at, created_at,
         source_system, source_row_id
       ) VALUES (
         $1,$2,$3,$4,$5,
         $6,$7,0,$7,
         $8,$9,
         encode(sha256(convert_to(fin.canonical_json($10::jsonb), 'UTF8')), 'hex'),
         $10::jsonb, 'OPEN_PERIOD',
         $11,$11,$11,$11,$11,
         $12,$13
       )
       ON CONFLICT (source_system, source_row_id)
       WHERE source_row_id IS NOT NULL
       DO NOTHING
       RETURNING id`,
      [
        ratedId, environment, ctx.tenantId, resolvedMeteredId, scaffold.contractVersionId,
        scaffold.priceVersionId, measured,
        amountMinor, scaffold.currency,
        JSON.stringify(explanation),
        eventAt,
        CONSUMPTION_SOURCE_SYSTEM, String(row.id),
      ],
    )
    const resolvedRatedId = ratedInserted.rows[0]?.id
    if (!resolvedRatedId) continue
    rowsWritten += 1

    try {
      await insertHistoricalAccounting(client, {
        environment,
        ctx,
        ratedUsageId: resolvedRatedId,
        amountMinor,
        currency: scaffold.currency,
        eventAt,
        now: stamped,
        sourceRowId: row.id,
      })
    } catch (error) {
      await recordCorrection(client, {
        environment,
        source: CONSUMPTION_SOURCE,
        sourceRowId: row.id,
        finRowId: resolvedRatedId,
        correctionKind: 'OTHER',
        reason: `accounting_events failed: ${error.message}`,
        legacyPayload: row,
        now: stamped,
      })
      rowsCorrected += 1
    }
  }

  return {
    skipped: false,
    rowsProcessed: legacy.length,
    rowsWritten,
    rowsCorrected,
    lastProcessedAt: legacy.length ? lastProcessedAt : since,
    lastProcessedId: legacy.length ? lastProcessedId : afterId,
  }
}

export async function backfillConsumptionChunk({
  environment = 'LIVE',
  since,
  until,
  limit = 500,
  afterId = null,
  now = null,
  holdLock = true,
} = {}) {
  const env = environment === 'TEST' ? 'TEST' : 'LIVE'
  const stamped = now || BusinessClock.now()
  const run = () => transaction((client) => runChunk(client, {
    environment: env, since, until, limit, afterId, stamped,
  }))
  if (!holdLock) return run()
  const locked = await withBackfillLock(async () => run())
  if (locked?.skipped) {
    return {
      skipped: true,
      reason: locked.reason,
      rowsProcessed: 0,
      rowsWritten: 0,
      rowsCorrected: 0,
      lastProcessedAt: since,
      lastProcessedId: afterId,
    }
  }
  return locked
}
