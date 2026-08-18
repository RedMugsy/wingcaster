import { randomUUID } from 'node:crypto'
import { FIN_RECONCILIATION } from '../foundation/advisory-locks.js'
import { CHECKS } from './checks.js'

function qtyMap(rows) {
  const map = new Map()
  for (const row of rows) {
    map.set(String(row.entity_id), Number(row.qty))
  }
  return map
}

function compare(check, sourceRows, comparisonRows) {
  const source = qtyMap(sourceRows)
  const comparison = qtyMap(comparisonRows)
  const ids = new Set([...source.keys(), ...comparison.keys()])
  const drifts = []
  let observed = 0

  for (const id of ids) {
    const hasSource = source.has(id)
    const hasComparison = comparison.has(id)
    if (check.emptyComparisonIsDrift && hasSource && !hasComparison) {
      drifts.push({
        entityId: id,
        expected: { qty: 0 },
        actual: { qty: null, empty: true },
        delta: { qty: null },
      })
      continue
    }
    if (check.missingSourceIsCacheMissing && hasComparison && !hasSource) {
      drifts.push({
        entityId: id,
        expected: { qty: comparison.get(id) },
        actual: { qty: null, cache_missing: true },
        delta: { qty: -comparison.get(id) },
      })
      continue
    }
    const src = hasSource ? source.get(id) : 0
    const cmp = hasComparison ? comparison.get(id) : 0
    const delta = src - cmp
    observed += delta
    if (delta !== check.expected_delta_units) {
      drifts.push({
        entityId: id,
        expected: { qty: src },
        actual: { qty: cmp },
        delta: { qty: delta },
      })
    }
  }
  return { drifts, observed }
}

async function insertCheck(client, {
  runId, environment, check, result, observed, now,
}) {
  const id = randomUUID()
  await client.query(
    `INSERT INTO fin.reconciliation_checks (
       id, run_id, environment, check_code, severity, result,
       source_query_ref, comparison_query_ref,
       expected_delta_units, observed_delta_units, drift_action,
       advisory_lock_key, created_at
     ) VALUES (
       $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13
     )`,
    [
      id, runId, environment, check.check_code, check.severity, result,
      check.source_query, check.comparison_query,
      check.expected_delta_units, observed, result === 'DRIFT' ? check.drift_action : null,
      `fin.recon.${check.check_code}.${environment}.platform`, now,
    ],
  )
  return id
}

async function recordDrifts(client, {
  checkId, environment, check, drifts, now,
}) {
  for (const drift of drifts) {
    const driftId = randomUUID()
    await client.query(
      `INSERT INTO fin.reconciliation_drift (
         id, check_id, environment, entity_type, entity_id,
         expected, actual, delta, created_at
       ) VALUES ($1,$2,$3,$4,$5::uuid,$6::jsonb,$7::jsonb,$8::jsonb,$9)`,
      [
        driftId, checkId, environment, check.entity_type, drift.entityId,
        JSON.stringify(drift.expected), JSON.stringify(drift.actual),
        JSON.stringify(drift.delta), now,
      ],
    )
    await client.query(
      `INSERT INTO fin.reconciliation_resolution (
         id, drift_id, environment, action, created_at, updated_at
       ) VALUES ($1,$2,$3,$4,$5,$5)`,
      [randomUUID(), driftId, environment, check.drift_action, now],
    )
  }
}

export async function runReconciliation(pool, {
  environment = 'LIVE',
  scope = 'platform',
  scheduleKind = 'ON_DEMAND',
  now = new Date().toISOString(),
} = {}) {
  const lockClient = await pool.connect()
  try {
    const locked = await lockClient.query(
      'SELECT pg_try_advisory_lock($1, $2) AS ok',
      [FIN_RECONCILIATION, 0],
    )
    if (!locked.rows[0].ok) {
      return { skipped: true, reason: 'RECON_LOCK_HELD' }
    }

    const runId = randomUUID()
    await lockClient.query(
      `INSERT INTO fin.reconciliation_runs (
         id, environment, started_at, scope, status, schedule_kind,
         advisory_lock_key, created_at, updated_at
       ) VALUES ($1,$2,$3,$4,'STARTED',$5,$6,$3,$3)`,
      [runId, environment, now, scope, scheduleKind, `fin.recon.${environment}.${scope}`],
    )
    await lockClient.query(
      `UPDATE fin.reconciliation_runs SET status = 'RUNNING', updated_at = $2 WHERE id = $1`,
      [runId, now],
    )

    const results = []
    try {
      for (const check of CHECKS) {
        let sourceRows
        let comparisonRows
        try {
          sourceRows = (await lockClient.query(check.source_query)).rows
          comparisonRows = (await lockClient.query(check.comparison_query)).rows
        } catch (error) {
          if (error.code === '42P01') {
            const checkId = await insertCheck(lockClient, {
              runId, environment, check, result: 'ERROR', observed: null, now,
            })
            results.push({ check_code: check.check_code, result: 'ERROR', checkId })
            continue
          }
          throw error
        }

        const { drifts, observed } = compare(check, sourceRows, comparisonRows)
        const result = drifts.length ? 'DRIFT' : 'GREEN'
        const checkId = await insertCheck(lockClient, {
          runId, environment, check, result, observed, now,
        })
        if (drifts.length) {
          await recordDrifts(lockClient, { checkId, environment, check, drifts, now })
        }
        results.push({ check_code: check.check_code, result, checkId, driftCount: drifts.length })
      }

      await lockClient.query(
        `UPDATE fin.reconciliation_runs
            SET status = 'COMPLETED', finished_at = $2, updated_at = $2
          WHERE id = $1`,
        [runId, now],
      )
      return { skipped: false, runId, status: 'COMPLETED', results }
    } catch (error) {
      await lockClient.query(
        `UPDATE fin.reconciliation_runs
            SET status = 'FAILED', finished_at = $2, updated_at = $2
          WHERE id = $1`,
        [runId, now],
      ).catch(() => {})
      throw error
    } finally {
      await lockClient.query(
        'SELECT pg_advisory_unlock($1, $2)',
        [FIN_RECONCILIATION, 0],
      )
    }
  } finally {
    lockClient.release()
  }
}
