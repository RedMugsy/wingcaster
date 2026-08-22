/**
 * Stage 13c parity worker (DL-196 / DL-197).
 * READS commercial.* and fin.*. Writes ONLY parity_reports + parity_drift.
 * Does not reconcile. Accumulate in memory, INSERT the final report (and
 * drift rows) in one transaction. Crash mid-window ⇒ no report; next tick
 * redoes the window. Idempotent by UNIQUE(env, source, window).
 */
import { randomUUID } from 'node:crypto'
import { transaction } from '../../../db.js'
import { BusinessClock } from '../../clock.js'
import { applyParitySession, withParityLock } from './session.js'
import {
  SOURCE_USAGE, SOURCE_CONSUMPTION, SOURCE_HOLDS, SOURCE_CAPTURES,
  classifyMirror,
} from './comparator.js'

export const AMBER_BPS = 50

function iso(value) {
  if (!value) return null
  if (value instanceof Date) return value.toISOString()
  return String(value)
}

function snapshot(row) {
  if (!row) return null
  const out = {}
  for (const [key, value] of Object.entries(row)) {
    out[key] = value instanceof Date ? value.toISOString() : value
  }
  return out
}

function statusOf(rowsChecked, rowsDrifted) {
  if (!rowsDrifted) return 'GREEN'
  const bps = rowsChecked > 0 ? Math.floor((rowsDrifted * 10000) / rowsChecked) : 10000
  if (bps < AMBER_BPS) return 'AMBER'
  return 'RED'
}

function driftRateBps(rowsChecked, rowsDrifted) {
  if (!rowsChecked) return 0
  return Math.floor((rowsDrifted * 10000) / rowsChecked)
}

async function tableExists(client, schema, table) {
  const { rows } = await client.query(
    `SELECT 1 FROM information_schema.tables
      WHERE table_schema = $1 AND table_name = $2`,
    [schema, table],
  )
  return rows.length > 0
}

const SOURCE_CONFIG = {
  [SOURCE_USAGE]: {
    schema: 'commercial',
    table: 'usage_events',
    timeColumn: 'occurred_at',
    extraWhere: '',
    finSystems: ['commercial', 'commercial.usage_events'],
    async loadLegacy(client, { windowStart, windowEnd, afterId, batchSize }) {
      const { rows } = await client.query(
        `SELECT id, tenant_id, action_key, quantity, channel, destination_country,
                whatsapp_category, listing_id, conversation_id, casts_charged,
                price_minor, billing_period, metadata, occurred_at, created_at,
                territory_id
           FROM commercial.usage_events
          WHERE occurred_at >= $1::timestamptz
            AND occurred_at < $2::timestamptz
            AND ($3::text IS NULL OR id > $3)
          ORDER BY id ASC
          LIMIT $4`,
        [windowStart, windowEnd, afterId, batchSize],
      )
      return rows
    },
    async loadFin(client, { environment, ids }) {
      if (!ids.length) return []
      const { rows } = await client.query(
        `SELECT id, environment, tenant_id, source_system, source_event_id,
                event_type, quantity_units, dimensions, occurred_at, received_at
           FROM fin.usage_events
          WHERE environment = $1
            AND source_system = ANY($2::text[])
            AND source_event_id = ANY($3::text[])`,
        [environment, ['commercial', 'commercial.usage_events'], ids.map(String)],
      )
      return rows
    },
    groupKey: (fin) => String(fin.source_event_id),
    rowId: (legacy) => String(legacy.id),
    async loadMissingLegacy(client, { environment, windowStart, windowEnd }) {
      const { rows } = await client.query(
        `SELECT f.id, f.environment, f.tenant_id, f.source_system, f.source_event_id,
                f.event_type, f.quantity_units, f.dimensions, f.occurred_at, f.received_at
           FROM fin.usage_events f
          WHERE f.environment = $1
            AND f.source_system = ANY($2::text[])
            AND f.occurred_at >= $3::timestamptz
            AND f.occurred_at < $4::timestamptz
            AND NOT EXISTS (
              SELECT 1 FROM commercial.usage_events c
               WHERE c.id::text = f.source_event_id
                 AND c.occurred_at >= $3::timestamptz
                 AND c.occurred_at < $4::timestamptz
            )`,
        [environment, ['commercial', 'commercial.usage_events'], windowStart, windowEnd],
      )
      return rows
    },
  },
  [SOURCE_CONSUMPTION]: {
    schema: 'commercial',
    table: 'ledger_entries',
    timeColumn: 'created_at',
    finSystems: ['commercial.ledger_entries'],
    async loadLegacy(client, { windowStart, windowEnd, afterId, batchSize }) {
      const { rows } = await client.query(
        `SELECT id, tenant_id, billing_period, type, quota_key, amount,
                source_event_id, metadata, created_at
           FROM commercial.ledger_entries
          WHERE type = 'consumption'
            AND created_at >= $1::timestamptz
            AND created_at < $2::timestamptz
            AND ($3::text IS NULL OR id > $3)
          ORDER BY id ASC
          LIMIT $4`,
        [windowStart, windowEnd, afterId, batchSize],
      )
      return rows
    },
    async loadFin(client, { environment, ids }) {
      if (!ids.length) return []
      const { rows } = await client.query(
        `SELECT ru.id, ru.environment, ru.tenant_id, ru.source_system, ru.source_row_id,
                ru.billable_units AS quantity_units, ru.currency, ru.occurred_at,
                ru.occurred_at AS event_at,
                NULL::text AS event_type,
                jsonb_build_object('public_tenant_id', t.public_tenant_id) AS dimensions
           FROM fin.rated_usage ru
           LEFT JOIN fin.tenants t ON t.id = ru.tenant_id
          WHERE ru.environment = $1
            AND ru.source_system = 'commercial.ledger_entries'
            AND ru.source_row_id = ANY($2::text[])
         UNION ALL
         SELECT ue.id, ue.environment, ue.tenant_id, ue.source_system, ue.source_event_id,
                ue.quantity_units, NULL::text AS currency, ue.occurred_at,
                ue.occurred_at AS event_at,
                ue.event_type,
                ue.dimensions
           FROM fin.usage_events ue
          WHERE ue.environment = $1
            AND ue.source_system = 'commercial.ledger_entries'
            AND ue.source_event_id = ANY($2::text[])
            AND NOT EXISTS (
              SELECT 1 FROM fin.rated_usage r
               WHERE r.source_system = 'commercial.ledger_entries'
                 AND r.source_row_id = ue.source_event_id
            )`,
        [environment, ids.map(String)],
      )
      return rows
    },
    groupKey: (fin) => String(fin.source_row_id || fin.source_event_id),
    rowId: (legacy) => String(legacy.id),
    async loadMissingLegacy(client, { environment, windowStart, windowEnd }) {
      const { rows } = await client.query(
        `SELECT ru.id, ru.environment, ru.tenant_id, ru.source_system, ru.source_row_id,
                ru.billable_units AS quantity_units, ru.currency, ru.occurred_at,
                jsonb_build_object('public_tenant_id', t.public_tenant_id) AS dimensions
           FROM fin.rated_usage ru
           LEFT JOIN fin.tenants t ON t.id = ru.tenant_id
          WHERE ru.environment = $1
            AND ru.source_system = 'commercial.ledger_entries'
            AND ru.occurred_at >= $2::timestamptz
            AND ru.occurred_at < $3::timestamptz
            AND NOT EXISTS (
              SELECT 1 FROM commercial.ledger_entries c
               WHERE c.id::text = ru.source_row_id
                 AND c.type = 'consumption'
                 AND c.created_at >= $2::timestamptz
                 AND c.created_at < $3::timestamptz
            )`,
        [environment, windowStart, windowEnd],
      )
      return rows
    },
  },
  [SOURCE_HOLDS]: {
    schema: 'commercial',
    table: 'holds',
    optional: true,
    async loadLegacy() { return [] },
    async loadFin() { return [] },
    groupKey: (fin) => String(fin.source_row_id || fin.id),
    rowId: (legacy) => String(legacy.id),
    async loadMissingLegacy() { return [] },
  },
  [SOURCE_CAPTURES]: {
    schema: 'commercial',
    table: 'captures',
    optional: true,
    async loadLegacy() { return [] },
    async loadFin() { return [] },
    groupKey: (fin) => String(fin.source_row_id || fin.id),
    rowId: (legacy) => String(legacy.id),
    async loadMissingLegacy() { return [] },
  },
}

function groupFin(rows, groupKey) {
  const map = new Map()
  for (const row of rows) {
    const key = groupKey(row)
    const list = map.get(key) || []
    list.push(row)
    map.set(key, list)
  }
  return map
}

async function observeWindow(client, {
  environment, source, windowStart, windowEnd, batchSize, stamped,
}) {
  const cfg = SOURCE_CONFIG[source]
  if (!cfg) throw new Error(`unsupported parity source: ${source}`)

  const exists = await tableExists(client, cfg.schema || 'commercial', cfg.table)
  if (!exists) {
    return { skipped: true, reason: 'SOURCE_TABLE_MISSING' }
  }

  const aggregator = {
    tenants: new Set(),
    rowsChecked: 0,
    rowsMatched: 0,
    rowsDrifted: 0,
    rowsMissingFin: 0,
    rowsMissingLegacy: 0,
    drifts: [],
  }

  let afterId = null
  for (;;) {
    const legacy = await cfg.loadLegacy(client, {
      windowStart, windowEnd, afterId, batchSize,
    })
    if (!legacy.length) break
    const ids = legacy.map((row) => String(row.id))
    const finRows = await cfg.loadFin(client, { environment, ids })
    const grouped = groupFin(finRows, cfg.groupKey)

    for (const row of legacy) {
      aggregator.rowsChecked += 1
      if (row.tenant_id) aggregator.tenants.add(String(row.tenant_id))
      const classified = classifyMirror(source, row, grouped.get(cfg.rowId(row)) || [], {
        environment,
      })
      if (classified.ok) {
        aggregator.rowsMatched += 1
      } else {
        aggregator.rowsDrifted += 1
        if (classified.drift_kind === 'MISSING_FIN') aggregator.rowsMissingFin += 1
        aggregator.drifts.push({
          sourceRowId: cfg.rowId(row),
          driftKind: classified.drift_kind,
          legacySnapshot: snapshot(classified.legacy_snapshot || row),
          finSnapshot: snapshot(classified.fin_snapshot),
          fieldDiffs: classified.field_diffs || {},
        })
      }
    }
    afterId = String(legacy[legacy.length - 1].id)
    if (legacy.length < batchSize) break
  }

  const missingLegacy = await cfg.loadMissingLegacy(client, {
    environment, windowStart, windowEnd,
  })
  for (const finRow of missingLegacy) {
    aggregator.rowsChecked += 1
    aggregator.rowsDrifted += 1
    aggregator.rowsMissingLegacy += 1
    aggregator.drifts.push({
      sourceRowId: String(finRow.source_row_id || finRow.source_event_id || finRow.id),
      driftKind: 'MISSING_LEGACY',
      legacySnapshot: null,
      finSnapshot: snapshot(finRow),
      fieldDiffs: { legacy: null },
    })
  }

  return {
    skipped: false,
    tenantsCovered: aggregator.tenants.size,
    rowsChecked: aggregator.rowsChecked,
    rowsMatched: aggregator.rowsMatched,
    rowsDrifted: aggregator.rowsDrifted,
    rowsMissingFin: aggregator.rowsMissingFin,
    rowsMissingLegacy: aggregator.rowsMissingLegacy,
    driftRateBps: driftRateBps(aggregator.rowsChecked, aggregator.rowsDrifted),
    status: statusOf(aggregator.rowsChecked, aggregator.rowsDrifted),
    drifts: aggregator.drifts,
    generatedAt: stamped,
  }
}

async function persistReport(client, {
  environment, source, windowStart, windowEnd, observed, actorType, actorId,
}) {
  const reportId = randomUUID()
  const inserted = await client.query(
    `INSERT INTO fin.cutover_parity_reports (
       id, environment, source, window_start, window_end,
       tenants_covered, rows_checked, rows_matched, rows_drifted,
       rows_missing_fin, rows_missing_legacy, drift_rate_bps,
       status, generated_at, generated_by_actor_type, generated_by_actor_id
     ) VALUES (
       $1,$2,$3,$4::timestamptz,$5::timestamptz,
       $6,$7,$8,$9,
       $10,$11,$12,
       $13,$14::timestamptz,$15,$16
     )
     ON CONFLICT (environment, source, window_start, window_end) DO NOTHING
     RETURNING id`,
    [
      reportId, environment, source, windowStart, windowEnd,
      observed.tenantsCovered, observed.rowsChecked, observed.rowsMatched, observed.rowsDrifted,
      observed.rowsMissingFin, observed.rowsMissingLegacy, observed.driftRateBps,
      observed.status, observed.generatedAt, actorType, actorId,
    ],
  )
  if (!inserted.rowCount) {
    const existing = await client.query(
      `SELECT id, status, rows_checked, rows_drifted, drift_rate_bps, generated_at
         FROM fin.cutover_parity_reports
        WHERE environment = $1 AND source = $2
          AND window_start = $3::timestamptz AND window_end = $4::timestamptz`,
      [environment, source, windowStart, windowEnd],
    )
    return {
      inserted: false,
      reportId: existing.rows[0]?.id || null,
      status: existing.rows[0]?.status,
      rowsChecked: Number(existing.rows[0]?.rows_checked || 0),
      rowsDrifted: Number(existing.rows[0]?.rows_drifted || 0),
      driftRateBps: Number(existing.rows[0]?.drift_rate_bps || 0),
    }
  }

  const id = inserted.rows[0].id
  for (const drift of observed.drifts) {
    await client.query(
      `INSERT INTO fin.cutover_parity_drift (
         id, environment, report_id, source, source_row_id, drift_kind,
         legacy_snapshot, fin_snapshot, field_diffs, observed_at, created_at
       ) VALUES (
         $1,$2,$3,$4,$5,$6,
         $7::jsonb,$8::jsonb,$9::jsonb,$10::timestamptz,$10::timestamptz
       )
       ON CONFLICT (report_id, source, source_row_id, drift_kind) DO NOTHING`,
      [
        randomUUID(), environment, id, source, drift.sourceRowId, drift.driftKind,
        JSON.stringify(drift.legacySnapshot),
        JSON.stringify(drift.finSnapshot),
        JSON.stringify(drift.fieldDiffs || {}),
        observed.generatedAt,
      ],
    )
  }

  return {
    inserted: true,
    reportId: id,
    status: observed.status,
    rowsChecked: observed.rowsChecked,
    rowsMatched: observed.rowsMatched,
    rowsDrifted: observed.rowsDrifted,
    rowsMissingFin: observed.rowsMissingFin,
    rowsMissingLegacy: observed.rowsMissingLegacy,
    driftRateBps: observed.driftRateBps,
    tenantsCovered: observed.tenantsCovered,
  }
}

/**
 * @param {{
 *   environment?: string,
 *   source: string,
 *   windowStart: string,
 *   windowEnd: string,
 *   batchSize?: number,
 *   now?: string,
 *   actorType?: string,
 *   actorId?: string,
 * }} args
 */
export async function runParityTick({
  environment = 'LIVE',
  source,
  windowStart,
  windowEnd,
  batchSize = 1000,
  now = null,
  actorType = 'SYSTEM',
  actorId = null,
} = {}) {
  if (!source) throw new Error('runParityTick requires source')
  if (!windowStart || !windowEnd) throw new Error('runParityTick requires windowStart and windowEnd')
  const env = environment === 'TEST' ? 'TEST' : 'LIVE'
  const stamped = now || BusinessClock.now()
  const startIso = iso(windowStart)
  const endIso = iso(windowEnd)

  const locked = await withParityLock(source, async () => {
    const observed = await transaction(async (client) => {
      await applyParitySession(client, env)
      return observeWindow(client, {
        environment: env,
        source,
        windowStart: startIso,
        windowEnd: endIso,
        batchSize,
        stamped,
      })
    })
    if (observed.skipped) return observed

    return transaction(async (client) => {
      await applyParitySession(client, env)
      const persisted = await persistReport(client, {
        environment: env,
        source,
        windowStart: startIso,
        windowEnd: endIso,
        observed,
        actorType,
        actorId,
      })
      return { skipped: false, ...persisted, observed }
    })
  })

  if (locked?.reason === 'PARITY_LOCK_HELD') {
    return { ok: false, reason: locked.reason, inserted: false }
  }
  if (locked?.reason === 'SOURCE_TABLE_MISSING') {
    return { ok: true, skipped: true, reason: locked.reason, inserted: false }
  }
  return { ok: true, ...locked }
}
