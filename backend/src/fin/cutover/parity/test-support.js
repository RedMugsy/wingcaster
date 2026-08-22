import { randomUUID } from 'node:crypto'
import { NOW } from '../../testing/seed.js'
import { ingestUsageEvent } from '../../usage/ingest.js'
import { insertCommercialUsage } from '../backfill/test-support.js'
import { SOURCE_USAGE } from './comparator.js'

export const WINDOW_START = '2026-08-18T00:00:00.000Z'
export const WINDOW_END = '2026-08-19T00:00:00.000Z'
export const DAY_START = '2026-08-17T00:00:00.000Z'
export const DAY_END = '2026-08-18T00:00:00.000Z'

export async function insertMatchingUsagePair(pool, world, {
  quantity = 1,
  occurredAt = NOW,
  eventType = 'webhook.received',
  finEventType = null,
  finQuantity = null,
} = {}) {
  const legacyId = await insertCommercialUsage(pool, {
    tenantId: world.tenantA.publicTenantId,
    actionKey: eventType,
    quantity,
    occurredAt,
    createdAt: occurredAt,
  })
  await ingestUsageEvent({
    environment: 'LIVE',
    tenantId: world.tenantA.tenantId,
    holderId: world.tenantA.holderId,
    billingAccountId: world.tenantA.billingAccountId,
    sourceSystem: 'commercial',
    sourceEventId: String(legacyId),
    eventType: finEventType || eventType,
    quantityUnits: finQuantity == null ? Math.max(1, quantity) : finQuantity,
    occurredAt,
    receivedAt: occurredAt,
    now: occurredAt,
    dimensions: { public_tenant_id: world.tenantA.publicTenantId },
  })
  return legacyId
}

export async function insertParityReport(pool, {
  environment = 'LIVE',
  source = SOURCE_USAGE,
  windowStart,
  windowEnd,
  status = 'GREEN',
  driftRateBps = 0,
  rowsChecked = 1,
  rowsMatched = 1,
  rowsDrifted = 0,
  generatedAt = NOW,
  id = null,
} = {}) {
  const reportId = id || randomUUID()
  await pool.query(
    `INSERT INTO fin.cutover_parity_reports (
       id, environment, source, window_start, window_end,
       tenants_covered, rows_checked, rows_matched, rows_drifted,
       rows_missing_fin, rows_missing_legacy, drift_rate_bps,
       status, generated_at, generated_by_actor_type, generated_by_actor_id
     ) VALUES (
       $1,$2,$3,$4::timestamptz,$5::timestamptz,
       1,$6,$7,$8,
       0,0,$9,
       $10,$11::timestamptz,'SYSTEM',NULL
     )`,
    [
      reportId, environment, source, windowStart, windowEnd,
      rowsChecked, rowsMatched, rowsDrifted, driftRateBps,
      status, generatedAt,
    ],
  )
  return reportId
}

export function utcDayRange(dayIso) {
  const start = `${dayIso}T00:00:00.000Z`
  const startMs = Date.parse(start)
  const end = new Date(startMs + 86400000).toISOString()
  return { windowStart: start, windowEnd: end }
}

export async function seedConsecutiveGreenDays(pool, {
  source = SOURCE_USAGE,
  endDay = null,
  days = 30,
  now = NOW,
} = {}) {
  const yesterday = new Date(Date.parse(now) - 86400000).toISOString().slice(0, 10)
  const last = endDay || yesterday
  const end = Date.parse(`${last}T00:00:00.000Z`)
  const ids = []
  for (let i = days - 1; i >= 0; i -= 1) {
    const day = new Date(end - i * 86400000).toISOString().slice(0, 10)
    const { windowStart, windowEnd } = utcDayRange(day)
    const id = await insertParityReport(pool, {
      source,
      windowStart,
      windowEnd,
      status: 'GREEN',
      generatedAt: `${day}T02:00:00.000Z`,
      rowsChecked: 10,
      rowsMatched: 10,
      rowsDrifted: 0,
      driftRateBps: 0,
    })
    ids.push(id)
  }
  return { ids, now }
}
