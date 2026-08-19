/**
 * Periodic metering tick. Scheduler wiring is out of Stage 3 scope.
 * Coarse lock: pg_try_advisory_lock(FIN_METERING, 0) — one tick cluster-wide.
 */
import { FIN_METERING } from '../foundation/advisory-locks.js'
import { filterToSql } from './filter.js'
import { meterPeriod } from './pipeline.js'

function iso(value) {
  if (!value) return new Date().toISOString()
  if (value instanceof Date) return value.toISOString()
  return String(value)
}

export function periodWindow(periodKey) {
  const month = /^(\d{4})-(\d{2})$/.exec(String(periodKey || ''))
  if (!month) {
    throw new Error(`unsupported periodKey ${periodKey}`)
  }
  const year = Number(month[1])
  const monthIndex = Number(month[2]) - 1
  const windowStart = new Date(Date.UTC(year, monthIndex, 1)).toISOString()
  const windowEnd = new Date(Date.UTC(year, monthIndex + 1, 1)).toISOString()
  return { windowStart, windowEnd }
}

export function periodKeyFromNow(now) {
  const date = new Date(iso(now))
  const year = date.getUTCFullYear()
  const month = String(date.getUTCMonth() + 1).padStart(2, '0')
  return `${year}-${month}`
}

export async function runMeteringTick({
  pool,
  now,
  environment = 'LIVE',
  meterVersionIds,
  holderIds,
  periodKey,
} = {}) {
  const clock = iso(now)
  const key = periodKey || periodKeyFromNow(clock)
  const { windowStart, windowEnd } = periodWindow(key)

  const lockClient = await pool.connect()
  try {
    const locked = await lockClient.query(
      'SELECT pg_try_advisory_lock($1, $2) AS ok',
      [FIN_METERING, 0],
    )
    if (!locked.rows[0].ok) {
      return { skipped: true, processed: 0, results: [], reason: 'METERING_LOCK_HELD' }
    }

    try {
      const versionParams = [environment, clock]
      let versionFilter = ''
      if (meterVersionIds?.length) {
        versionParams.push(meterVersionIds)
        versionFilter = `AND v.id = ANY($${versionParams.length}::uuid[])`
      }
      const versions = await lockClient.query(
        `SELECT v.id, v.filter_definition
           FROM fin.meter_versions v
          WHERE v.environment = $1
            AND v.effective_from <= $2::timestamptz
            AND (v.effective_to IS NULL OR v.effective_to > $2::timestamptz)
            ${versionFilter}
          ORDER BY v.id`,
        versionParams,
      )

      const results = []
      let processed = 0
      let skippedHeld = 0

      for (const version of versions.rows) {
        const holderParams = [environment, windowStart, windowEnd]
        let next = holderParams.length + 1
        let holderFilter = ''
        if (holderIds?.length) {
          holderParams.push(holderIds)
          holderFilter += `AND e.holder_id = ANY($${next}::uuid[]) `
          next += 1
        }
        const { where, params: filterParams } = filterToSql(version.filter_definition || {}, 'e', next)
        holderParams.push(...filterParams)
        const holders = await lockClient.query(
          `SELECT DISTINCT e.holder_id
             FROM fin.usage_events e
            WHERE e.environment = $1
              AND e.holder_id IS NOT NULL
              AND e.occurred_at >= $2::timestamptz
              AND e.occurred_at < $3::timestamptz
              ${holderFilter}
              AND (${where})
            ORDER BY e.holder_id`,
          holderParams,
        )

        for (const row of holders.rows) {
          const result = await meterPeriod({
            environment,
            meterVersionId: version.id,
            holderId: row.holder_id,
            periodKey: key,
            windowStart,
            windowEnd,
            now: clock,
            actorType: 'WORKER',
          })
          results.push({
            meterVersionId: version.id,
            holderId: row.holder_id,
            periodKey: key,
            ...result,
          })
          if (result.ok === false && result.error_code === 'METERING_LOCK_HELD') {
            skippedHeld += 1
            continue
          }
          if (result.ok) processed += 1
        }
      }

      return { skipped: false, processed, skippedHeld, results }
    } finally {
      await lockClient.query(
        'SELECT pg_advisory_unlock($1, $2)',
        [FIN_METERING, 0],
      )
    }
  } finally {
    lockClient.release()
  }
}
