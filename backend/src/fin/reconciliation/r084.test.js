/**
 * Real-Postgres — R084 DRIFT when dual-write errors exceed 100 in 24h.
 */
import { randomUUID } from 'node:crypto'
import { expect, it } from 'vitest'
import { BusinessClock } from '../clock.js'
import { finPostgresSuite } from '../testing/suite.js'
import { runReconciliation } from '../reconciliation/runner.js'

finPostgresSuite('reconciliation R084', {}, ({ pool }) => {
  it('R084 is GREEN when error count is below 100', async () => {
    const run = await runReconciliation(pool(), { now: BusinessClock.now() })
    const r084 = run.results.find((r) => r.check_code === 'R084')
    expect(r084).toBeTruthy()
    expect(r084.result).toBe('GREEN')
  })

  it('R084 DRIFT when 101 errors occurred in the last 24h', async () => {
    const nowIso = BusinessClock.now()
    for (let i = 0; i < 101; i += 1) {
      await pool().query(
        `INSERT INTO fin.cutover_dual_write_errors (
           id, environment, tenant_id, legacy_source, legacy_row_id,
           fin_command, error_code, error_message, payload, occurred_at, created_at
         ) VALUES (
           $1, 'LIVE', 'pt-r084', 'commercial.usage_events', $2,
           'ingestUsageEventWithClient', 'TEST_SEED', 'seed', '{}'::jsonb, $3::timestamptz, $3::timestamptz
         )`,
        [randomUUID(), `row-${i}`, nowIso],
      )
    }

    const run = await runReconciliation(pool(), { now: nowIso })
    const r084 = run.results.find((r) => r.check_code === 'R084')
    expect(r084.result).toBe('DRIFT')
    const stored = await pool().query(
      `SELECT drift_action FROM fin.reconciliation_checks WHERE id = $1`,
      [r084.checkId],
    )
    expect(stored.rows[0].drift_action).toBe('WARN')
  })
})
