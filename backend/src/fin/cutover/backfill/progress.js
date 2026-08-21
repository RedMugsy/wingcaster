/**
 * Stage 13b backfill progress (DL-182). APPEND_ONLY — start and complete
 * are separate INSERTs sharing batch_id.
 */
import { randomUUID } from 'node:crypto'
import { query } from '../../../db.js'
import { BusinessClock } from '../../clock.js'
import { rowsOf } from './session.js'

function execOf(client, injected) {
  return injected || (client
    ? (sql, params) => client.query(sql, params).then((r) => r.rows)
    : query)
}

/**
 * @param {{ source: string, environment?: string, actorType?: string, actorId?: string, now?: string, client?: import('pg').PoolClient, query?: Function }} args
 * @returns {Promise<{ id: string, batchId: string, startedAt: string }>}
 */
export async function startBatch({
  source,
  environment = 'LIVE',
  actorType = 'SYSTEM',
  actorId = null,
  now = null,
  client = null,
  query: injected = null,
} = {}) {
  const startedAt = now || BusinessClock.now()
  const id = randomUUID()
  const batchId = randomUUID()
  const env = environment === 'TEST' ? 'TEST' : 'LIVE'
  await rowsOf(execOf(client, injected),
    `INSERT INTO fin.cutover_backfill_progress (
       id, environment, source, last_processed_at, last_processed_id,
       rows_processed, rows_written, rows_corrected, batch_id,
       started_at, completed_at, actor_type, actor_id
     ) VALUES (
       $1,$2,$3,NULL,NULL,
       0,0,0,$4,
       $5,NULL,$6,$7
     )`,
    [id, env, source, batchId, startedAt, actorType, actorId],
  )
  return { id, batchId, startedAt }
}

/**
 * INSERT a completion row for the same batch_id (no UPDATE of the start row).
 */
export async function completeBatch({
  id,
  rowsProcessed = 0,
  rowsWritten = 0,
  rowsCorrected = 0,
  lastProcessedAt = null,
  lastProcessedId = null,
  now = null,
  client = null,
  query: injected = null,
} = {}) {
  const exec = execOf(client, injected)
  const started = await rowsOf(exec,
    `SELECT batch_id, environment, source, actor_type, actor_id, started_at
       FROM fin.cutover_backfill_progress
      WHERE id = $1`,
    [id],
  )
  const origin = started[0]
  if (!origin) {
    throw new Error(`cutover_backfill_progress start row not found: ${id}`)
  }
  const completedAt = now || BusinessClock.now()
  const completionId = randomUUID()
  await rowsOf(exec,
    `INSERT INTO fin.cutover_backfill_progress (
       id, environment, source, last_processed_at, last_processed_id,
       rows_processed, rows_written, rows_corrected, batch_id,
       started_at, completed_at, actor_type, actor_id
     ) VALUES (
       $1,$2,$3,$4,$5,
       $6,$7,$8,$9,
       $10,$11,$12,$13
     )`,
    [
      completionId,
      origin.environment,
      origin.source,
      lastProcessedAt,
      lastProcessedId,
      rowsProcessed,
      rowsWritten,
      rowsCorrected,
      origin.batch_id,
      origin.started_at,
      completedAt,
      origin.actor_type,
      origin.actor_id,
    ],
  )
  return { id: completionId, batchId: origin.batch_id, completedAt }
}

/**
 * Resume point: MAX(last_processed_at) among completed rows for the source.
 */
export async function latestCompletedAt({
  source,
  environment = 'LIVE',
  client = null,
  query: injected = null,
} = {}) {
  const env = environment === 'TEST' ? 'TEST' : 'LIVE'
  const rows = await rowsOf(execOf(client, injected),
    `SELECT MAX(last_processed_at) AS last_processed_at
       FROM fin.cutover_backfill_progress
      WHERE source = $1
        AND environment = $2
        AND completed_at IS NOT NULL`,
    [source, env],
  )
  return rows[0]?.last_processed_at || null
}

/**
 * Full resume cursor including last_processed_id (DL-185).
 */
export async function latestCompletedCursor({
  source,
  environment = 'LIVE',
  client = null,
  query: injected = null,
} = {}) {
  const env = environment === 'TEST' ? 'TEST' : 'LIVE'
  const rows = await rowsOf(execOf(client, injected),
    `SELECT last_processed_at, last_processed_id, rows_processed, rows_written, rows_corrected
       FROM fin.cutover_backfill_progress
      WHERE source = $1
        AND environment = $2
        AND completed_at IS NOT NULL
        AND last_processed_at IS NOT NULL
      ORDER BY last_processed_at DESC, completed_at DESC
      LIMIT 1`,
    [source, env],
  )
  return rows[0] || null
}
