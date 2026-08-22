/**
 * Stage 13b+13c cutover readiness (DL-184 / DL-201). Read-only operator JSON.
 */
import { BusinessClock } from '../../clock.js'
import { CHECKS } from '../../reconciliation/checks.js'
import {
  ATTESTATION_FRESH_DAYS,
  BURN_IN_DAYS_DEFAULT,
  computeAttestation,
  latestAttestation,
  listDailyParityReports,
} from '../parity/attestation.js'

function qtyMap(rows) {
  const map = new Map()
  for (const row of rows) {
    map.set(String(row.entity_id), Number(row.qty))
  }
  return map
}

function bindNow(sql, now) {
  if (!sql.includes(':now')) return { text: sql, values: [] }
  return { text: sql.replaceAll(':now', '$1::timestamptz'), values: [now] }
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

async function evalCheck(pool, code, now) {
  const check = CHECKS.find((c) => c.check_code === code)
  if (!check) return 'GREEN'
  const sourceSql = bindNow(check.source_query, now)
  const comparisonSql = bindNow(check.comparison_query, now)
  const source = await pool.query(sourceSql.text, sourceSql.values)
  const comparison = await pool.query(comparisonSql.text, comparisonSql.values)
  return statusOf(check, source.rows, comparison.rows)
}

function r093Display(checkResult, lastDriftRateBps) {
  if (checkResult === 'DRIFT') return 'DRIFT'
  if (Number(lastDriftRateBps) > 0) return 'AMBER'
  return 'GREEN'
}

function r095Display(checkResult) {
  if (checkResult === 'DRIFT') return 'WARN'
  return 'GREEN'
}

export async function loadCutoverReadiness(pool, {
  environment = 'LIVE',
  now = null,
} = {}) {
  const env = environment === 'TEST' ? 'TEST' : 'LIVE'
  const stamped = now || BusinessClock.now()

  const errors = await pool.query(
    `SELECT COUNT(*)::int AS n
       FROM fin.cutover_dual_write_errors
      WHERE environment = $1
        AND occurred_at > $2::timestamptz - interval '24 hours'`,
    [env, stamped],
  )
  const dualWriteErrorCount24h = errors.rows[0]?.n || 0

  const recon = {}
  for (const code of ['R090', 'R091', 'R092', 'R093', 'R094', 'R095']) {
    recon[code] = await evalCheck(pool, code, stamped)
  }

  const progress = await pool.query(
    `SELECT DISTINCT ON (source)
            source,
            last_processed_at AS latest_completed_at,
            rows_processed,
            rows_corrected
       FROM fin.cutover_backfill_progress
      WHERE environment = $1
        AND completed_at IS NOT NULL
      ORDER BY source, completed_at DESC`,
    [env],
  )

  const corrections = await pool.query(
    `SELECT COUNT(*)::int AS n
       FROM fin.cutover_backfill_corrections
      WHERE environment = $1`,
    [env],
  )

  const lastReport = await pool.query(
    `SELECT generated_at, drift_rate_bps
       FROM fin.cutover_parity_reports
      WHERE environment = $1
      ORDER BY generated_at DESC
      LIMIT 1`,
    [env],
  )

  const latestDaily = await pool.query(
    `SELECT MAX(drift_rate_bps)::bigint AS bps
       FROM (
         SELECT DISTINCT ON (source) drift_rate_bps
           FROM fin.cutover_parity_reports
          WHERE environment = $1
            AND window_end - window_start >= interval '23 hours'
            AND window_end <= $2::timestamptz
          ORDER BY source, generated_at DESC
       ) latest`,
    [env, stamped],
  )
  const lastDriftRateBps = Number(latestDaily.rows[0]?.bps || lastReport.rows[0]?.drift_rate_bps || 0)

  const computed = await computeAttestation(pool, {
    environment: env,
    burnInDays: BURN_IN_DAYS_DEFAULT,
    now: stamped,
  })
  const signed = await latestAttestation(pool, env)
  const signedAt = signed?.signed_at ? new Date(signed.signed_at).toISOString() : null
  const attestationFresh = Boolean(signedAt)
    && (Date.parse(stamped) - Date.parse(signedAt)) <= ATTESTATION_FRESH_DAYS * 24 * 60 * 60 * 1000

  const r093 = r093Display(recon.R093, lastDriftRateBps)
  const r094 = recon.R094
  const r095 = r095Display(recon.R095)

  const readyForCutover = recon.R090 === 'GREEN'
    && recon.R091 === 'GREEN'
    && recon.R092 === 'GREEN'
    && recon.R093 === 'GREEN'
    && recon.R094 === 'GREEN'
    && dualWriteErrorCount24h < 100
    && attestationFresh

  return {
    dual_write_error_count_24h: dualWriteErrorCount24h,
    R090: recon.R090,
    R091: recon.R091,
    R092: recon.R092,
    R093: r093,
    R094: r094,
    R095: r095,
    backfill_status: progress.rows,
    corrections_total: corrections.rows[0]?.n || 0,
    parity: {
      last_report_at: lastReport.rows[0]?.generated_at
        ? new Date(lastReport.rows[0].generated_at).toISOString()
        : null,
      last_drift_rate_bps: lastDriftRateBps,
      consecutive_green_days: computed.consecutive_green_days,
      burn_in_days_required: BURN_IN_DAYS_DEFAULT,
      burn_in_met: computed.consecutive_green_days >= BURN_IN_DAYS_DEFAULT,
    },
    attestation: {
      last_signed_at: signedAt,
      signed_by_email: signed?.signed_by_email || null,
      eligible_to_sign: computed.eligible,
    },
    ready_for_cutover: readyForCutover,
  }
}

export async function loadParityReports(pool, {
  environment = 'LIVE',
  now = null,
} = {}) {
  const env = environment === 'TEST' ? 'TEST' : 'LIVE'
  const stamped = now || BusinessClock.now()
  const reports = await listDailyParityReports(pool, { environment: env, now: stamped, limit: 120 })
  return { reports }
}
