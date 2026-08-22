/**
 * Real-Postgres — same window twice is ON CONFLICT DO NOTHING; drifts not duplicated.
 */
import { expect, it } from 'vitest'
import { NOW } from '../../testing/seed.js'
import { finPostgresSuite } from '../../testing/suite.js'
import { insertCommercialUsage } from '../backfill/test-support.js'
import { SOURCE_USAGE } from './comparator.js'
import { runParityTick } from './worker.js'
import { WINDOW_END, WINDOW_START } from './test-support.js'

finPostgresSuite('parity/worker-idempotent', {}, ({ pool, world }) => {
  it('second tick of the same window does not duplicate the report or drift rows', async () => {
    await insertCommercialUsage(pool(), {
      tenantId: world().tenantA.publicTenantId,
      occurredAt: NOW,
      createdAt: NOW,
    })
    const first = await runParityTick({
      environment: 'LIVE',
      source: SOURCE_USAGE,
      windowStart: WINDOW_START,
      windowEnd: WINDOW_END,
      now: NOW,
    })
    expect(first.inserted).toBe(true)
    const second = await runParityTick({
      environment: 'LIVE',
      source: SOURCE_USAGE,
      windowStart: WINDOW_START,
      windowEnd: WINDOW_END,
      now: NOW,
    })
    expect(second.inserted).toBe(false)
    expect(second.reportId).toBe(first.reportId)
    const reports = await pool().query(
      `SELECT COUNT(*)::int AS n FROM fin.cutover_parity_reports
        WHERE environment = 'LIVE' AND source = $1
          AND window_start = $2::timestamptz AND window_end = $3::timestamptz`,
      [SOURCE_USAGE, WINDOW_START, WINDOW_END],
    )
    expect(reports.rows[0].n).toBe(1)
    const drifts = await pool().query(
      `SELECT COUNT(*)::int AS n FROM fin.cutover_parity_drift WHERE report_id = $1`,
      [first.reportId],
    )
    expect(drifts.rows[0].n).toBe(1)
  })
})
