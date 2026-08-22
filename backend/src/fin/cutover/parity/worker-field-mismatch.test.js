/**
 * Real-Postgres — matched pair with a differing field → FIELD_MISMATCH + field_diffs.
 */
import { expect, it } from 'vitest'
import { NOW } from '../../testing/seed.js'
import { finPostgresSuite } from '../../testing/suite.js'
import { SOURCE_USAGE } from './comparator.js'
import { runParityTick } from './worker.js'
import { insertMatchingUsagePair, WINDOW_END, WINDOW_START } from './test-support.js'

finPostgresSuite('parity/worker-field-mismatch', {}, ({ pool, world }) => {
  it('records FIELD_MISMATCH and field_diffs when event_type differs', async () => {
    await insertMatchingUsagePair(pool(), world(), {
      eventType: 'webhook.received',
      finEventType: 'other.action',
      quantity: 1,
    })
    const result = await runParityTick({
      environment: 'LIVE',
      source: SOURCE_USAGE,
      windowStart: WINDOW_START,
      windowEnd: WINDOW_END,
      now: NOW,
    })
    expect(result.ok).toBe(true)
    expect(result.rowsDrifted).toBeGreaterThan(0)
    const drifts = await pool().query(
      `SELECT drift_kind, field_diffs FROM fin.cutover_parity_drift WHERE report_id = $1`,
      [result.reportId],
    )
    expect(drifts.rows.some((row) => row.drift_kind === 'FIELD_MISMATCH')).toBe(true)
    const mismatch = drifts.rows.find((row) => row.drift_kind === 'FIELD_MISMATCH')
    expect(mismatch.field_diffs.event_type).toBeTruthy()
    expect(mismatch.field_diffs.event_type.legacy).toBe('webhook.received')
    expect(mismatch.field_diffs.event_type.fin).toBe('other.action')
  })
})
