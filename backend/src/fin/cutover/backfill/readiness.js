/**
 * Stage 13b cutover readiness (DL-184). Read-only operator JSON.
 */
import { BusinessClock } from '../../clock.js'
import { CHECKS } from '../../reconciliation/checks.js'

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

  const codes = ['R090', 'R091', 'R092']
  const recon = {}
  for (const code of codes) {
    const check = CHECKS.find((c) => c.check_code === code)
    const source = await pool.query(check.source_query)
    const comparison = await pool.query(check.comparison_query)
    recon[code] = statusOf(check, source.rows, comparison.rows)
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

  const readyForCutover = recon.R090 === 'GREEN'
    && recon.R091 === 'GREEN'
    && recon.R092 === 'GREEN'
    && dualWriteErrorCount24h < 100

  return {
    dual_write_error_count_24h: dualWriteErrorCount24h,
    R090: recon.R090,
    R091: recon.R091,
    R092: recon.R092,
    backfill_status: progress.rows,
    corrections_total: corrections.rows[0]?.n || 0,
    ready_for_cutover: readyForCutover,
  }
}
