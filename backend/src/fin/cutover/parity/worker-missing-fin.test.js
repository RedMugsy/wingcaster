/**
 * Real-Postgres — legacy rows with no fin mirror → MISSING_FIN; RED over threshold.
 */
import { expect, it } from 'vitest'
import { NOW } from '../../testing/seed.js'
import { finPostgresSuite } from '../../testing/suite.js'
import { insertCommercialUsage } from '../backfill/test-support.js'
import { SOURCE_USAGE } from './comparator.js'
import { runParityTick } from './worker.js'
import { WINDOW_END, WINDOW_START } from './test-support.js'

finPostgresSuite('parity/worker-missing-fin', {}, ({ pool, world }) => {
  it('MISSING_FIN drift is captured and report is RED when rate ≥ 50 bps', async () => {
    await insertCommercialUsage(pool(), {
      tenantId: world().tenantA.publicTenantId,
      occurredAt: NOW,
      createdAt: NOW,
    })
    const result = await runParityTick({
      environment: 'LIVE',
      source: SOURCE_USAGE,
      windowStart: WINDOW_START,
      windowEnd: WINDOW_END,
      now: NOW,
    })
    expect(result.ok).toBe(true)
    expect(result.status).toBe('RED')
    expect(result.rowsMissingFin).toBe(1)
    expect(result.driftRateBps).toBe(10000)
    const drifts = await pool().query(
      `SELECT drift_kind, source_row_id FROM fin.cutover_parity_drift WHERE report_id = $1`,
      [result.reportId],
    )
    expect(drifts.rows).toHaveLength(1)
    expect(drifts.rows[0].drift_kind).toBe('MISSING_FIN')
  })
})
