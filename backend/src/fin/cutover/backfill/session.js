/**
 * Stage 13b backfill session helpers.
 * Offline workers are not I-14 request-serving; they still use transaction(fn).
 */
import { getPool } from '../../../persistence/postgres-adapter.js'
import { FIN_CUTOVER_BACKFILL } from '../../foundation/advisory-locks.js'

export async function applyBackfillSession(client, environment = 'LIVE') {
  const env = environment === 'TEST' ? 'TEST' : 'LIVE'
  await client.query(`SELECT set_config('fin.environment', $1, true)`, [env])
  await client.query(`SELECT set_config('fin.platform_admin', 'on', true)`)
  await client.query(`SELECT set_config('fin.elevated', 'on', true)`)
}

export async function withBackfillLock(fn) {
  const client = await getPool().connect()
  try {
    const locked = await client.query(
      'SELECT pg_try_advisory_lock($1, $2) AS ok',
      [FIN_CUTOVER_BACKFILL, 0],
    )
    if (!locked.rows[0].ok) {
      return { skipped: true, reason: 'BACKFILL_LOCK_HELD' }
    }
    try {
      return await fn(client)
    } finally {
      await client.query(
        'SELECT pg_advisory_unlock($1, $2)',
        [FIN_CUTOVER_BACKFILL, 0],
      ).catch(() => {})
    }
  } finally {
    client.release()
  }
}

export async function rowsOf(exec, sql, params = []) {
  if (typeof exec === 'function') {
    const result = await exec(sql, params)
    if (Array.isArray(result)) return result
    return result?.rows || []
  }
  if (exec?.query) {
    const result = await exec.query(sql, params)
    return result.rows || []
  }
  throw new Error('rowsOf requires a query function or pg client')
}
