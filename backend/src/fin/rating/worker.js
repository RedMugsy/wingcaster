/**
 * Periodic rating tick. Scheduler wiring is out of Stage 5 scope.
 * Coarse lock: pg_try_advisory_lock(FIN_RATING, 0) — one tick cluster-wide.
 * No rating DLQ (DL-081): missing contract/price leaves the row un-rated.
 */
import { FinError } from '../errors.js'
import { FIN_RATING } from '../foundation/advisory-locks.js'
import { rateMeteredUsage } from './engine.js'

function iso(value) {
  if (!value) return new Date().toISOString()
  if (value instanceof Date) return value.toISOString()
  return String(value)
}

const SKIP_CODES = new Set(['FIN_NO_ACTIVE_CONTRACT', 'FIN_NO_ACTIVE_PRICE'])

export async function runRatingTick({
  pool,
  now,
  environment = 'LIVE',
  meteredUsageIds,
  limit = 100,
  logger,
} = {}) {
  const clock = iso(now)
  const log = logger || { warn: (...args) => console.warn(...args) }

  const lockClient = await pool.connect()
  try {
    const locked = await lockClient.query(
      'SELECT pg_try_advisory_lock($1, $2) AS ok',
      [FIN_RATING, 0],
    )
    if (!locked.rows[0].ok) {
      return { skipped: true, processed: 0, results: [], reason: 'RATING_LOCK_HELD' }
    }

    try {
      const unratedSql = meteredUsageIds?.length
        ? `SELECT m.id
             FROM fin.metered_usage m
             LEFT JOIN fin.rated_usage r
               ON r.metered_usage_id = m.id
              AND r.adjustment_of_id IS NULL
            WHERE m.environment = $1
              AND m.status = 'ACTIVE'
              AND r.id IS NULL
              AND m.id = ANY($2::uuid[])
            ORDER BY m.metered_at ASC, m.id ASC
            LIMIT $3`
        : `SELECT m.id
             FROM fin.metered_usage m
             LEFT JOIN fin.rated_usage r
               ON r.metered_usage_id = m.id
              AND r.adjustment_of_id IS NULL
            WHERE m.environment = $1
              AND m.status = 'ACTIVE'
              AND r.id IS NULL
            ORDER BY m.metered_at ASC, m.id ASC
            LIMIT $2`
      const unratedParams = meteredUsageIds?.length
        ? [environment, meteredUsageIds, limit]
        : [environment, limit]
      const { rows } = await lockClient.query(unratedSql, unratedParams)

      const results = []
      let processed = 0
      let skippedHeld = 0
      let skippedNoContract = 0
      let skippedNoPrice = 0

      for (const row of rows) {
        try {
          const result = await rateMeteredUsage({
            environment,
            meteredUsageId: row.id,
            now: clock,
            actorType: 'WORKER',
          })
          results.push({ meteredUsageId: row.id, ...result })
          if (result.ok === false && result.error_code === 'RATING_LOCK_HELD') {
            skippedHeld += 1
            continue
          }
          if (result.ok) processed += 1
        } catch (error) {
          const code = error instanceof FinError ? error.code : null
          if (SKIP_CODES.has(code)) {
            log.warn({ meteredUsageId: row.id, error_code: code }, 'rating skipped')
            results.push({ meteredUsageId: row.id, ok: false, error_code: code })
            if (code === 'FIN_NO_ACTIVE_CONTRACT') skippedNoContract += 1
            if (code === 'FIN_NO_ACTIVE_PRICE') skippedNoPrice += 1
            continue
          }
          throw error
        }
      }

      return {
        skipped: false,
        processed,
        skippedHeld,
        skippedNoContract,
        skippedNoPrice,
        results,
      }
    } finally {
      await lockClient.query(
        'SELECT pg_advisory_unlock($1, $2)',
        [FIN_RATING, 0],
      )
    }
  } finally {
    lockClient.release()
  }
}
