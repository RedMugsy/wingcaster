/**
 * Stage 13c parity session helpers.
 * Offline batch — not a request-serving path. Sets the same GUCs as 13b
 * backfill so FORCE RLS platform_admin_bypass admits the worker.
 */
import { getPool } from '../../../persistence/postgres-adapter.js'
import { FIN_CUTOVER_PARITY } from '../../foundation/advisory-locks.js'

export async function applyParitySession(client, environment = 'LIVE') {
  const env = environment === 'TEST' ? 'TEST' : 'LIVE'
  await client.query(`SELECT set_config('fin.environment', $1, true)`, [env])
  await client.query(`SELECT set_config('fin.platform_admin', 'on', true)`)
  await client.query(`SELECT set_config('fin.elevated', 'on', true)`)
}

/**
 * Per-source mutex. Session-scoped on a dedicated client so the tick can
 * span multiple short transactions; key2 = hashtext(source) so sources
 * may run in parallel (DL-196).
 */
export async function withParityLock(source, fn) {
  const client = await getPool().connect()
  try {
    const locked = await client.query(
      'SELECT pg_try_advisory_lock($1, hashtext($2::text)) AS ok',
      [FIN_CUTOVER_PARITY, source],
    )
    if (!locked.rows[0].ok) {
      return { skipped: true, reason: 'PARITY_LOCK_HELD' }
    }
    try {
      return await fn(client)
    } finally {
      await client.query(
        'SELECT pg_advisory_unlock($1, hashtext($2::text))',
        [FIN_CUTOVER_PARITY, source],
      ).catch(() => {})
    }
  } finally {
    client.release()
  }
}
