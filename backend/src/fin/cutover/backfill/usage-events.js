/**
 * Stage 13b commercial.usage_events → fin.usage_events (DL-180 / DL-181).
 * Direct INSERT (no outbox). Natural key source_system='commercial' +
 * source_event_id=legacy.id. ON CONFLICT DO NOTHING.
 */
import { randomUUID } from 'node:crypto'
import { transaction } from '../../../db.js'
import { BusinessClock } from '../../clock.js'
import { applyBackfillSession, withBackfillLock } from './session.js'
import { resolveFinContextForCommercialTenant } from './tenant-map.js'
import { recordCorrection } from './corrections.js'

export const USAGE_SOURCE = 'commercial.usage_events'
export const USAGE_SOURCE_SYSTEM = 'commercial'

function iso(value) {
  if (!value) return null
  if (value instanceof Date) return value.toISOString()
  return String(value)
}

async function resolveResidencyKey(client, tenantId) {
  if (!tenantId) return '__platform__'
  const { rows } = await client.query(
    `SELECT default_residency_key FROM fin.tenants WHERE id = $1`,
    [tenantId],
  )
  return rows[0]?.default_residency_key || '__platform__'
}

async function runChunk(client, {
  environment, since, until, limit, afterId, stamped,
}) {
  await applyBackfillSession(client, environment)
  const { rows: legacy } = await client.query(
    `SELECT id, tenant_id, action_key, quantity, channel, destination_country,
            whatsapp_category, listing_id, conversation_id, casts_charged,
            price_minor, billing_period, metadata, occurred_at, created_at,
            territory_id
       FROM commercial.usage_events
      WHERE occurred_at < $2::timestamptz
        AND (
          occurred_at > $1::timestamptz
          OR (occurred_at = $1::timestamptz AND id > COALESCE($3, ''))
          OR ($3 IS NULL AND occurred_at >= $1::timestamptz)
        )
      ORDER BY occurred_at ASC, id ASC
      LIMIT $4`,
    [since, until, afterId, limit],
  )

  let rowsWritten = 0
  let rowsCorrected = 0
  let lastProcessedAt = since
  let lastProcessedId = afterId

  for (const row of legacy) {
    lastProcessedAt = iso(row.occurred_at) || lastProcessedAt
    lastProcessedId = row.id
    const ctx = await resolveFinContextForCommercialTenant({
      publicTenantId: row.tenant_id,
      environment,
      client,
    })
    if (!ctx.ok) {
      await recordCorrection(client, {
        environment,
        source: USAGE_SOURCE,
        sourceRowId: row.id,
        correctionKind: ctx.missing,
        reason: `fin context missing for public tenant ${row.tenant_id}`,
        legacyPayload: row,
        now: stamped,
      })
      rowsCorrected += 1
      continue
    }

    const actionKey = String(row.action_key || '').trim()
    if (!actionKey) {
      await recordCorrection(client, {
        environment,
        source: USAGE_SOURCE,
        sourceRowId: row.id,
        correctionKind: 'UNMAPPED_ACTION_KEY',
        reason: 'legacy action_key empty',
        legacyPayload: row,
        now: stamped,
      })
      rowsCorrected += 1
    }

    const occurredAt = iso(row.occurred_at) || iso(row.created_at) || stamped
    const createdAt = iso(row.created_at) || occurredAt
    if (iso(row.created_at) && iso(row.occurred_at) && row.occurred_at < row.created_at) {
      await recordCorrection(client, {
        environment,
        source: USAGE_SOURCE,
        sourceRowId: row.id,
        correctionKind: 'OUT_OF_ORDER',
        reason: 'occurred_at before created_at',
        legacyPayload: row,
        now: stamped,
      })
      rowsCorrected += 1
    }

    const residencyKey = await resolveResidencyKey(client, ctx.tenantId)
    const quantityUnits = Math.max(1, Number(row.quantity) || 1)
    const dimensions = {
      ...(row.metadata && typeof row.metadata === 'object' ? row.metadata : {}),
      channel: row.channel ?? null,
      destination_country: row.destination_country ?? null,
      whatsapp_category: row.whatsapp_category ?? null,
      casts_charged: row.casts_charged ?? null,
      price_minor: row.price_minor ?? null,
      quota_billing_period: row.billing_period ?? null,
      public_tenant_id: row.tenant_id ?? null,
      cutover_origin: 'backfill',
    }
    const id = randomUUID()
    const inserted = await client.query(
      `INSERT INTO fin.usage_events (
         id, environment, residency_key, tenant_id, holder_id, billing_account_id,
         source_system, source_event_id, event_type, event_kind,
         corrects_event_id, corrects_residency_key, subject_type, subject_id,
         quantity_units, dimensions, occurred_at, received_at, ingestion_version,
         created_at
       ) VALUES (
         $1,$2,$3,$4,$5,$6,
         $7,$8,$9,'ORIGINAL',
         NULL,NULL,$10,$11,
         $12,$13::jsonb,$14,$14,1,
         $15
       )
       ON CONFLICT (environment, source_system, source_event_id, residency_key)
       DO NOTHING
       RETURNING id`,
      [
        id, environment, residencyKey, ctx.tenantId, ctx.holderId, ctx.billingAccountId,
        USAGE_SOURCE_SYSTEM, String(row.id), actionKey || 'unknown',
        row.conversation_id ? 'CONVERSATION' : row.listing_id ? 'LISTING' : null,
        row.conversation_id || row.listing_id || null,
        quantityUnits, JSON.stringify(dimensions), occurredAt, createdAt,
      ],
    )
    if (inserted.rowCount) rowsWritten += 1
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

/**
 * @param {{ environment?: string, since: string, until: string, limit?: number, afterId?: string|null, now?: string, holdLock?: boolean }} args
 */
export async function backfillUsageEventsChunk({
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
