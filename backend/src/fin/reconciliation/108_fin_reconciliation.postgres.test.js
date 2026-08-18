import { randomUUID } from 'node:crypto'
import { expect, it } from 'vitest'
import { NOW } from '../testing/seed.js'
import { finPostgresSuite } from '../testing/suite.js'

finPostgresSuite('108_fin_reconciliation', {}, ({ pool }) => {
  it('stores a run, an append-only check, drift, and a resolution', async () => {
    const runId = randomUUID()
    const checkId = randomUUID()
    const driftId = randomUUID()
    await pool().query(
      `INSERT INTO fin.reconciliation_runs (
         id, environment, started_at, scope, status, schedule_kind,
         advisory_lock_key, created_at, updated_at
       ) VALUES ($1, 'LIVE', $2, 'platform', 'RUNNING', 'ON_DEMAND',
                 'fin.recon.R001.LIVE.platform', $2, $2)`,
      [runId, NOW],
    )
    await pool().query(
      `INSERT INTO fin.reconciliation_checks (
         id, run_id, environment, check_code, severity, result,
         expected_delta_units, observed_delta_units, advisory_lock_key, created_at
       ) VALUES ($1, $2, 'LIVE', 'R001', 'HIGH', 'DRIFT', 0, 12, 'R001.LIVE', $3)`,
      [checkId, runId, NOW],
    )
    await pool().query(
      `INSERT INTO fin.reconciliation_drift (
         id, check_id, environment, entity_type, entity_id,
         expected, actual, delta, created_at
       ) VALUES ($1, $2, 'LIVE', 'ledger_transactions', $3,
                 '{"sum":0}'::jsonb, '{"sum":12}'::jsonb, '{"sum":12}'::jsonb, $4)`,
      [driftId, checkId, randomUUID(), NOW],
    )
    await pool().query(
      `INSERT INTO fin.reconciliation_resolution (
         id, drift_id, environment, action, created_at, updated_at
       ) VALUES ($1, $2, 'LIVE', 'WARN', $3, $3)`,
      [randomUUID(), driftId, NOW],
    )
    const checks = await pool().query(
      `SELECT result FROM fin.reconciliation_checks WHERE id = $1`,
      [checkId],
    )
    expect(checks.rows[0].result).toBe('DRIFT')
  })
})
