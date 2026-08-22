/**
 * Stage 13c parity orchestrator (DL-196 / DL-199).
 * Hourly last-hour window; daily UTC-day rollup used for burn-in.
 * BusinessClock.now() throughout.
 */
import { BusinessClock } from '../../clock.js'
import { PARITY_SOURCES, SOURCE_USAGE, SOURCE_CONSUMPTION } from './comparator.js'
import { runParityTick } from './worker.js'

/** Sources the hourly/daily workers always attempt. Optional tables skip. */
export const ORCHESTRATED_SOURCES = [
  SOURCE_USAGE,
  SOURCE_CONSUMPTION,
  ...PARITY_SOURCES.filter((s) => s !== SOURCE_USAGE && s !== SOURCE_CONSUMPTION),
]

function iso(value) {
  if (!value) return null
  if (value instanceof Date) return value.toISOString()
  return String(value)
}

export function lastHourWindow(now) {
  const end = new Date(iso(now) || BusinessClock.now())
  const start = new Date(end.getTime() - 60 * 60 * 1000)
  return { windowStart: start.toISOString(), windowEnd: end.toISOString() }
}

/**
 * Full UTC day [00:00, next 00:00). When `day` is omitted, uses the previous
 * UTC day relative to `now` (the 02:00 UTC rollup target).
 */
export function utcDayWindow(now, day = null) {
  const stamped = new Date(iso(day || now) || BusinessClock.now())
  let y = stamped.getUTCFullYear()
  let m = stamped.getUTCMonth()
  let d = stamped.getUTCDate()
  if (!day) {
    const prev = new Date(Date.UTC(y, m, d - 1))
    y = prev.getUTCFullYear()
    m = prev.getUTCMonth()
    d = prev.getUTCDate()
  }
  const start = new Date(Date.UTC(y, m, d, 0, 0, 0, 0))
  const end = new Date(Date.UTC(y, m, d + 1, 0, 0, 0, 0))
  return { windowStart: start.toISOString(), windowEnd: end.toISOString() }
}

export async function runHourlyTick({
  environment = 'LIVE',
  now = null,
  sources = ORCHESTRATED_SOURCES,
  batchSize = 1000,
} = {}) {
  const stamped = now || BusinessClock.now()
  const { windowStart, windowEnd } = lastHourWindow(stamped)
  const results = []
  for (const source of sources) {
    results.push(await runParityTick({
      environment, source, windowStart, windowEnd, batchSize, now: stamped,
    }))
  }
  return { windowStart, windowEnd, results }
}

export async function runDailyRollup({
  environment = 'LIVE',
  day = null,
  now = null,
  sources = ORCHESTRATED_SOURCES,
  batchSize = 1000,
} = {}) {
  const stamped = now || BusinessClock.now()
  const { windowStart, windowEnd } = utcDayWindow(stamped, day)
  const results = []
  for (const source of sources) {
    results.push(await runParityTick({
      environment, source, windowStart, windowEnd, batchSize, now: stamped,
    }))
  }
  return { windowStart, windowEnd, results }
}
