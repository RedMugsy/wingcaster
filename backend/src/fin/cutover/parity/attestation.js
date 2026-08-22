/**
 * Stage 13c parity attestation (DL-198 / DL-199 / DL-201).
 * Hash = SHA-256 of canonical JCS over the evidence set.
 * Signing is gated by the same eligibility the readiness endpoint exposes.
 */
import { randomUUID } from 'node:crypto'
import { transaction } from '../../../db.js'
import { BusinessClock } from '../../clock.js'
import { CATEGORY, finError } from '../../errors.js'
import { sha256Canonical } from '../../metering/hash.js'
import { CHECKS } from '../../reconciliation/checks.js'
import { applyParitySession } from './session.js'

export const BURN_IN_DAYS_DEFAULT = 30
export const ATTESTATION_FRESH_DAYS = 7
const DAILY_WINDOW_HOURS = 23

function iso(value) {
  if (!value) return null
  if (value instanceof Date) return value.toISOString()
  return String(value)
}

function qtyMap(rows) {
  const map = new Map()
  for (const row of rows) {
    map.set(String(row.entity_id), Number(row.qty))
  }
  return map
}

function statusOf(check, sourceRows, comparisonRows) {
  const source = qtyMap(sourceRows)
  const comparison = qtyMap(comparisonRows)
  const ids = new Set([...source.keys(), ...comparison.keys()])
  for (const id of ids) {
    const src = source.has(id) ? source.get(id) : 0
    const cmp = comparison.has(id) ? comparison.get(id) : 0
    if (src - cmp !== check.expected_delta_units) return 'DRIFT'
  }
  return 'GREEN'
}

function utcDate(value) {
  const d = new Date(iso(value))
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`
}

function addUtcDays(day, n) {
  const [y, m, d] = day.split('-').map(Number)
  const next = new Date(Date.UTC(y, m - 1, d + n))
  return utcDate(next.toISOString())
}

export function attestationEvidence({
  environment,
  firstGreenAt,
  lastGreenAt,
  reportIds,
  totalRowsChecked,
  totalRowsDrifted,
  outstandingCorrections,
}) {
  return {
    environment,
    first_green_at: firstGreenAt,
    last_green_at: lastGreenAt,
    reports: [...reportIds].sort(),
    total_rows_checked: Number(totalRowsChecked || 0),
    total_rows_drifted: Number(totalRowsDrifted || 0),
    outstanding_corrections: Number(outstandingCorrections || 0),
  }
}

export function hashAttestation(evidence) {
  return sha256Canonical(attestationEvidence(evidence))
}

export function consecutiveGreenDays(dailyReports, now, { burnInDays = BURN_IN_DAYS_DEFAULT } = {}) {
  const bySourceDay = new Map()
  for (const row of dailyReports) {
    const source = row.source
    const day = utcDate(row.window_start)
    if (!bySourceDay.has(source)) bySourceDay.set(source, new Map())
    bySourceDay.get(source).set(day, row)
  }
  const yesterday = addUtcDays(utcDate(now), -1)
  const sources = [...bySourceDay.keys()]
  if (!sources.length) {
    return { consecutive: 0, gaps: [], firstGreenAt: null, lastGreenAt: null, reportIds: [] }
  }

  let minStreak = Infinity
  const gaps = []
  let firstGreenAt = null
  let lastGreenAt = null
  const reportIds = []

  for (const source of sources) {
    const days = bySourceDay.get(source)
    let streak = 0
    let cursor = yesterday
    for (;;) {
      const row = days.get(cursor)
      if (!row || row.status !== 'GREEN') {
        if (!row) gaps.push({ source, day: cursor, reason: 'MISSING' })
        else gaps.push({ source, day: cursor, reason: row.status })
        break
      }
      streak += 1
      reportIds.push(row.id)
      const generated = iso(row.generated_at) || iso(row.window_end)
      if (!lastGreenAt || generated > lastGreenAt) lastGreenAt = generated
      if (!firstGreenAt || generated < firstGreenAt) firstGreenAt = generated
      if (streak >= burnInDays) break
      cursor = addUtcDays(cursor, -1)
    }
    if (streak < minStreak) minStreak = streak
  }

  return {
    consecutive: Number.isFinite(minStreak) ? minStreak : 0,
    gaps: gaps.filter((g) => {
      const oldest = addUtcDays(yesterday, -(burnInDays - 1))
      return g.day >= oldest
    }),
    firstGreenAt,
    lastGreenAt,
    reportIds: [...new Set(reportIds)],
  }
}

async function loadDailyReports(client, { environment, now, burnInDays }) {
  const { rows } = await client.query(
    `SELECT id, source, status, window_start, window_end, generated_at,
            rows_checked, rows_drifted, drift_rate_bps
       FROM fin.cutover_parity_reports
      WHERE environment = $1
        AND window_end - window_start >= interval '23 hours'
        AND window_end <= $2::timestamptz
        AND window_start >= $2::timestamptz - ($3::int * interval '1 day')
      ORDER BY window_start ASC, source ASC`,
    [environment, now, burnInDays + 1],
  )
  return rows
}

function bindNow(sql, now) {
  if (!sql.includes(':now')) return { text: sql, values: [] }
  return { text: sql.replaceAll(':now', '$1::timestamptz'), values: [now] }
}

async function reconStatus(client, code, now) {
  const check = CHECKS.find((c) => c.check_code === code)
  if (!check) return 'GREEN'
  const sourceSql = bindNow(check.source_query, now)
  const comparisonSql = bindNow(check.comparison_query, now)
  const source = await client.query(sourceSql.text, sourceSql.values)
  const comparison = await client.query(comparisonSql.text, comparisonSql.values)
  return statusOf(check, source.rows, comparison.rows)
}

async function dualWriteErrorCount24h(client, environment, now) {
  const { rows } = await client.query(
    `SELECT COUNT(*)::int AS n
       FROM fin.cutover_dual_write_errors
      WHERE environment = $1
        AND occurred_at > $2::timestamptz - interval '24 hours'`,
    [environment, now],
  )
  return rows[0]?.n || 0
}

async function outstandingCorrections(client, environment) {
  const { rows } = await client.query(
    `SELECT COUNT(*)::int AS n
       FROM fin.cutover_backfill_corrections
      WHERE environment = $1`,
    [environment],
  )
  return rows[0]?.n || 0
}

/**
 * @returns {{
 *   eligible: boolean,
 *   first_green_at: string|null,
 *   last_green_at: string|null,
 *   gaps: Array<object>,
 *   hash: string|null,
 *   outstanding_corrections: number,
 *   consecutive_green_days: number,
 *   reports: string[],
 *   total_rows_checked: number,
 *   total_rows_drifted: number,
 *   r084_errors_24h: number,
 *   R090: string, R091: string, R092: string,
 * }}
 */
export async function computeAttestation(poolOrClient, {
  environment = 'LIVE',
  burnInDays = BURN_IN_DAYS_DEFAULT,
  now = null,
} = {}) {
  const env = environment === 'TEST' ? 'TEST' : 'LIVE'
  const stamped = now || BusinessClock.now()
  const days = Number(burnInDays) > 0 ? Number(burnInDays) : BURN_IN_DAYS_DEFAULT

  const run = async (client) => {
    await applyParitySession(client, env)
    const daily = await loadDailyReports(client, { environment: env, now: stamped, burnInDays: days })
    const streak = consecutiveGreenDays(daily, stamped, { burnInDays: days })
    const r084 = await dualWriteErrorCount24h(client, env, stamped)
    const r090 = await reconStatus(client, 'R090', stamped)
    const r091 = await reconStatus(client, 'R091', stamped)
    const r092 = await reconStatus(client, 'R092', stamped)
    const corrections = await outstandingCorrections(client, env)
    const windowReports = daily.filter((row) => streak.reportIds.includes(row.id))
    const totalRowsChecked = windowReports.reduce((s, r) => s + Number(r.rows_checked || 0), 0)
    const totalRowsDrifted = windowReports.reduce((s, r) => s + Number(r.rows_drifted || 0), 0)
    const burnInMet = streak.consecutive >= days
    const noNonGreen = !daily.some((row) => {
      const day = utcDate(row.window_start)
      const oldest = addUtcDays(addUtcDays(utcDate(stamped), -1), -(days - 1))
      return day >= oldest && row.status !== 'GREEN'
    })
    const eligible = burnInMet
      && noNonGreen
      && r084 < 100
      && r090 === 'GREEN'
      && r091 === 'GREEN'
      && r092 === 'GREEN'

    const evidence = attestationEvidence({
      environment: env,
      firstGreenAt: streak.firstGreenAt,
      lastGreenAt: streak.lastGreenAt,
      reportIds: streak.reportIds,
      totalRowsChecked,
      totalRowsDrifted,
      outstandingCorrections: corrections,
    })
    const hash = eligible || streak.reportIds.length
      ? hashAttestation({
        environment: env,
        firstGreenAt: streak.firstGreenAt,
        lastGreenAt: streak.lastGreenAt,
        reportIds: streak.reportIds,
        totalRowsChecked,
        totalRowsDrifted,
        outstandingCorrections: corrections,
      })
      : null

    const sorted = [...streak.reportIds].sort()
    return {
      eligible,
      first_green_at: streak.firstGreenAt,
      last_green_at: streak.lastGreenAt,
      gaps: streak.gaps,
      hash,
      outstanding_corrections: corrections,
      consecutive_green_days: streak.consecutive,
      burn_in_days: days,
      reports: sorted,
      reports_included_from: sorted[0] || null,
      reports_included_to: sorted[sorted.length - 1] || null,
      total_rows_checked: totalRowsChecked,
      total_rows_drifted: totalRowsDrifted,
      r084_errors_24h: r084,
      R090: r090,
      R091: r091,
      R092: r092,
      evidence,
    }
  }

  if (poolOrClient && typeof poolOrClient.query === 'function' && typeof poolOrClient.release === 'function') {
    return run(poolOrClient)
  }
  return transaction(run)
}

export async function signAttestation({
  environment = 'LIVE',
  burnInDays = BURN_IN_DAYS_DEFAULT,
  actor = {},
  now = null,
} = {}) {
  const env = environment === 'TEST' ? 'TEST' : 'LIVE'
  const stamped = now || BusinessClock.now()
  const days = Number(burnInDays) > 0 ? Number(burnInDays) : BURN_IN_DAYS_DEFAULT

  return transaction(async (client) => {
    await applyParitySession(client, env)
    const computed = await computeAttestation(client, {
      environment: env, burnInDays: days, now: stamped,
    })
    if (!computed.eligible) {
      throw finError('ATTESTATION_NOT_ELIGIBLE', {
        category: CATEGORY.CONFLICT,
        httpStatus: 409,
        details: {
          consecutive_green_days: computed.consecutive_green_days,
          burn_in_days: days,
          gaps: computed.gaps,
          R090: computed.R090,
          R091: computed.R091,
          R092: computed.R092,
          r084_errors_24h: computed.r084_errors_24h,
        },
      })
    }

    const id = randomUUID()
    const inserted = await client.query(
      `INSERT INTO fin.cutover_parity_attestations (
         id, environment, burn_in_days, first_green_at, last_green_at,
         reports_included_from, reports_included_to,
         total_rows_checked, total_rows_drifted, outstanding_corrections,
         attestation_hash, signed_by_actor_type, signed_by_actor_id,
         signed_by_email, signed_at, created_at
       ) VALUES (
         $1,$2,$3,$4::timestamptz,$5::timestamptz,
         $6,$7,
         $8,$9,$10,
         $11,$12,$13,
         $14,$15::timestamptz,$15::timestamptz
       )
       ON CONFLICT (environment, attestation_hash) DO NOTHING
       RETURNING *`,
      [
        id, env, days, computed.first_green_at, computed.last_green_at,
        computed.reports_included_from, computed.reports_included_to,
        computed.total_rows_checked, computed.total_rows_drifted,
        computed.outstanding_corrections,
        computed.hash,
        actor.actorType || 'USER',
        actor.actorId || null,
        actor.actorEmail || actor.email || null,
        stamped,
      ],
    )
    if (inserted.rowCount) {
      return { inserted: true, attestation: inserted.rows[0], hash: computed.hash }
    }
    const existing = await client.query(
      `SELECT * FROM fin.cutover_parity_attestations
        WHERE environment = $1 AND attestation_hash = $2`,
      [env, computed.hash],
    )
    return { inserted: false, attestation: existing.rows[0], hash: computed.hash }
  })
}

export async function latestAttestation(client, environment) {
  const { rows } = await client.query(
    `SELECT signed_at, signed_by_email, attestation_hash
       FROM fin.cutover_parity_attestations
      WHERE environment = $1
      ORDER BY signed_at DESC
      LIMIT 1`,
    [environment],
  )
  return rows[0] || null
}

export async function listDailyParityReports(client, {
  environment = 'LIVE',
  now = null,
  limit = 30,
} = {}) {
  const stamped = now || BusinessClock.now()
  const { rows } = await client.query(
    `SELECT id, environment, source, window_start, window_end,
            tenants_covered, rows_checked, rows_matched, rows_drifted,
            rows_missing_fin, rows_missing_legacy, drift_rate_bps,
            status, generated_at
       FROM fin.cutover_parity_reports
      WHERE environment = $1
        AND window_end - window_start >= interval '23 hours'
        AND generated_at <= $2::timestamptz
      ORDER BY window_start DESC, source ASC
      LIMIT $3`,
    [environment, stamped, limit],
  )
  return rows
}

export { DAILY_WINDOW_HOURS }
