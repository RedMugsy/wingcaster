/**
 * Real-Postgres — matching commercial/fin pairs produce a GREEN report.
 */
import { expect, it } from 'vitest'
import { NOW } from '../../testing/seed.js'
import { finPostgresSuite } from '../../testing/suite.js'
import { SOURCE_USAGE } from './comparator.js'
import { runParityTick } from './worker.js'
import { insertMatchingUsagePair, WINDOW_END, WINDOW_START } from './test-support.js'

finPostgresSuite('parity/worker-happy', {}, ({ pool, world }) => {
  it('matching pairs produce GREEN with zero drift rows', async () => {
    for (let i = 0; i < 3; i += 1) {
      await insertMatchingUsagePair(pool(), world())
    }
    const result = await runParityTick({
      environment: 'LIVE',
      source: SOURCE_USAGE,
      windowStart: WINDOW_START,
      windowEnd: WINDOW_END,
      now: NOW,
    })
    expect(result.ok).toBe(true)
    expect(result.inserted).toBe(true)
    expect(result.status).toBe('GREEN')
    expect(result.rowsChecked).toBe(3)
    expect(result.rowsMatched).toBe(3)
    expect(result.rowsDrifted).toBe(0)
    const drifts = await pool().query(
      `SELECT COUNT(*)::int AS n FROM fin.cutover_parity_drift WHERE report_id = $1`,
      [result.reportId],
    )
    expect(drifts.rows[0].n).toBe(0)
  })
})
