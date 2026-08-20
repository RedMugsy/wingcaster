/**
 * Dunning worker. Advisory class FIN_DUNNING = 1006.
 * Eligible cases: prior step completed_at + policy_delay_ms <= now (or OPEN
 * created_at + delay). Failures log dunning_steps outcome=ERROR; do not auto-suspend.
 */
import { transaction } from '../../db.js'
import { BusinessClock } from '../clock.js'
import { FIN_DUNNING } from '../foundation/advisory-locks.js'
import { envelope } from '../postpaid/helpers.js'
import { advanceDunning, logDunningError } from './steps.js'

function iso(value) {
  if (!value) return BusinessClock.now()
  if (value instanceof Date) return value.toISOString()
  return String(value)
}

export async function runDunningTick({ pool, now, limit = 50 } = {}) {
  const clock = iso(now)
  const lockClient = await pool.connect()
  try {
    const locked = await lockClient.query(
      'SELECT pg_try_advisory_lock($1, $2) AS ok',
      [FIN_DUNNING, 0],
    )
    if (!locked.rows[0].ok) {
      return { skipped: true, processed: 0, results: [], reason: 'DUNNING_LOCK_HELD' }
    }
    try {
      const due = await lockClient.query(
        `SELECT c.id
           FROM fin.dunning_cases c
           LEFT JOIN LATERAL (
             SELECT completed_at FROM fin.dunning_steps s
              WHERE s.case_id = c.id AND s.step_kind <> 'ERROR'
              ORDER BY s.entered_at DESC, s.id DESC
              LIMIT 1
           ) last ON true
          WHERE c.status IN (
            'OPEN','REMINDING','REMIND_ESCALATED','CREDIT_PAUSED',
            'USAGE_SUSPENDED','LEGAL'
          )
            AND COALESCE(last.completed_at, c.created_at)
                + make_interval(secs => c.policy_delay_ms / 1000.0)
                <= $1::timestamptz
          ORDER BY c.created_at ASC, c.id ASC
          LIMIT $2`,
        [clock, limit],
      )
      const results = []
      let processed = 0
      for (const row of due.rows) {
        try {
          const advanced = await advanceDunning({
            caseId: row.id,
            now: clock,
            actorType: 'WORKER',
            reasonCode: 'DUNNING_TICK',
            idempotencyKey: `DUNNING:TICK:${row.id}:${clock}`,
          })
          results.push({ caseId: row.id, status: advanced.status })
          processed += 1
        } catch (error) {
          await transaction(async (client) => {
            const env = envelope({
              now: clock, actorType: 'WORKER', reasonCode: 'DUNNING_TICK',
            })
            await logDunningError(client, env, row.id, error)
          })
          results.push({ caseId: row.id, error: error.code || error.message })
        }
      }
      return { skipped: false, processed, results }
    } finally {
      await lockClient.query(
        'SELECT pg_advisory_unlock($1, $2)',
        [FIN_DUNNING, 0],
      )
    }
  } finally {
    lockClient.release()
  }
}
