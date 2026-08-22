/**
 * Stage 13b backfill orchestrator (DL-180).
 * Resumes from latestCompletedAt, never overlaps the DUAL cutoff,
 * refuses to run when the cutoff has not been established.
 */
import { transaction } from '../../../db.js'
import { BusinessClock } from '../../clock.js'
import { resolveCutoverModeFromParts } from '../mode.js'
import { applyBackfillSession, withBackfillLock } from './session.js'
import {
  startBatch, completeBatch, latestCompletedCursor,
} from './progress.js'
import { backfillUsageEventsChunk, USAGE_SOURCE } from './usage-events.js'
import { backfillConsumptionChunk, CONSUMPTION_SOURCE } from './consumption.js'

const EPOCH = '1970-01-01T00:00:00.000Z'

function iso(value) {
  if (!value) return null
  if (value instanceof Date) return value.toISOString()
  return String(value)
}

async function loadCutoff(client, environment) {
  const { rows } = await client.query(
    `SELECT MIN(ue.received_at) AS cutoff
       FROM fin.usage_events ue
       JOIN fin.tenants t ON t.id = ue.tenant_id
       JOIN fin.cutover_tenant_allowlist a
         ON a.tenant_id = t.public_tenant_id
        AND a.environment = ue.environment
        AND a.mode = 'DUAL'
      WHERE ue.environment = $1
        AND ue.source_system = 'commercial.usage_events'`,
    [environment],
  )
  return iso(rows[0]?.cutoff)
}

async function cutoffEstablished(client, environment) {
  const global = process.env.FIN_CUTOVER_MODE_GLOBAL
  const mode = resolveCutoverModeFromParts({
    globalMode: global,
    allowlistMode: null,
  })
  const { rows: allow } = await client.query(
    `SELECT 1 FROM fin.cutover_tenant_allowlist
      WHERE environment = $1 AND mode = 'DUAL'
      LIMIT 1`,
    [environment],
  )
  if (mode !== 'FIN_ONLY' && !allow.length) return { ok: false, cutoff: null }
  if (mode === 'FIN_ONLY') {
    const { rows } = await client.query(
      `SELECT MIN(ue.received_at) AS cutoff
         FROM fin.usage_events ue
        WHERE ue.environment = $1
          AND ue.source_system = 'commercial.usage_events'`,
      [environment],
    )
    const cutoff = iso(rows[0]?.cutoff)
    return { ok: Boolean(cutoff), cutoff }
  }
  const cutoff = await loadCutoff(client, environment)
  return { ok: Boolean(cutoff), cutoff }
}

function chunkFor(source) {
  if (source === USAGE_SOURCE) return backfillUsageEventsChunk
  if (source === CONSUMPTION_SOURCE) return backfillConsumptionChunk
  throw new Error(`unsupported backfill source: ${source}`)
}

/**
 * @param {{
 *   environment?: string,
 *   source: string,
 *   sinceOverride?: string,
 *   untilOverride?: string,
 *   batchSize?: number,
 *   now?: string,
 * }} args
 */
export async function runBackfill({
  environment = 'LIVE',
  source,
  sinceOverride = null,
  untilOverride = null,
  batchSize = 500,
  now = null,
} = {}) {
  if (!source) throw new Error('runBackfill requires source')
  const env = environment === 'TEST' ? 'TEST' : 'LIVE'
  const stamped = now || BusinessClock.now()
  const chunkFn = chunkFor(source)

  const locked = await withBackfillLock(async () => {
    const gate = await transaction(async (client) => {
      await applyBackfillSession(client, env)
      return cutoffEstablished(client, env)
    })
    if (!gate.ok) {
      return { ok: false, reason: 'CUTOFF_NOT_ESTABLISHED', rowsProcessed: 0, rowsWritten: 0, rowsCorrected: 0 }
    }

    let until = gate.cutoff
    if (untilOverride) {
      const overrideIso = iso(untilOverride)
      until = overrideIso < until ? overrideIso : until
    }

    const cursor = await latestCompletedCursor({ source, environment: env })
    let since = iso(sinceOverride) || iso(cursor?.last_processed_at) || EPOCH
    let afterId = sinceOverride ? null : (cursor?.last_processed_id || null)
    if (since >= until) {
      return {
        ok: true,
        reason: 'CAUGHT_UP',
        rowsProcessed: 0,
        rowsWritten: 0,
        rowsCorrected: 0,
        lastProcessedAt: since,
      }
    }

    const started = await startBatch({
      source, environment: env, now: stamped, actorType: 'SYSTEM',
    })
    let rowsProcessed = 0
    let rowsWritten = 0
    let rowsCorrected = 0
    let lastProcessedAt = since
    let lastProcessedId = afterId

    try {
      for (;;) {
        const summary = await chunkFn({
          environment: env,
          since: lastProcessedAt,
          until,
          limit: batchSize,
          afterId: lastProcessedId,
          now: stamped,
          holdLock: false,
        })
        if (summary.skipped) break
        rowsProcessed += summary.rowsProcessed
        rowsWritten += summary.rowsWritten
        rowsCorrected += summary.rowsCorrected
        lastProcessedAt = summary.lastProcessedAt
        lastProcessedId = summary.lastProcessedId
        if (!summary.rowsProcessed) break
      }
    } finally {
      await completeBatch({
        id: started.id,
        rowsProcessed,
        rowsWritten,
        rowsCorrected,
        lastProcessedAt,
        lastProcessedId,
        now: stamped,
      })
    }

    return {
      ok: true,
      batchId: started.batchId,
      rowsProcessed,
      rowsWritten,
      rowsCorrected,
      lastProcessedAt,
      lastProcessedId,
      cutoff: until,
    }
  })

  if (locked?.skipped) {
    return { ok: false, reason: locked.reason, rowsProcessed: 0, rowsWritten: 0, rowsCorrected: 0 }
  }
  return locked
}
