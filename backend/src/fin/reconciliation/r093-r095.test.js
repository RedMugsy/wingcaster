/**
 * Real-Postgres — R093–R095 DRIFT then GREEN.
 */
import { randomUUID } from 'node:crypto'
import { expect, it } from 'vitest'
import { NOW } from '../testing/seed.js'
import { finPostgresSuite } from '../testing/suite.js'
import { runReconciliation } from './runner.js'
import { SOURCE_USAGE } from '../cutover/parity/comparator.js'
import { insertParityReport, utcDayRange } from '../cutover/parity/test-support.js'

function resultOf(run, code) {
  return run.results.find((r) => r.check_code === code)
}

async function resetParity(pool) {
  await pool.query('ALTER TABLE fin.cutover_parity_drift DISABLE TRIGGER trg_cutover_parity_drift_append_only')
  await pool.query('ALTER TABLE fin.cutover_parity_reports DISABLE TRIGGER trg_cutover_parity_reports_append_only')
  await pool.query('DELETE FROM fin.cutover_parity_drift')
  await pool.query('DELETE FROM fin.cutover_parity_reports')
  await pool.query('DELETE FROM fin.cutover_backfill_corrections')
  await pool.query('ALTER TABLE fin.cutover_parity_drift ENABLE TRIGGER trg_cutover_parity_drift_append_only')
  await pool.query('ALTER TABLE fin.cutover_parity_reports ENABLE TRIGGER trg_cutover_parity_reports_append_only')
}

finPostgresSuite('reconciliation/r093-r095', {}, ({ pool }) => {
  it('R093 DRIFT when latest daily drift_rate_bps > 50 then GREEN after a clean report', async () => {
    await insertParityReport(pool(), {
      source: SOURCE_USAGE,
      windowStart: '2026-08-17T00:00:00.000Z',
      windowEnd: '2026-08-18T00:00:00.000Z',
      status: 'RED',
      driftRateBps: 120,
      rowsChecked: 100,
      rowsMatched: 98,
      rowsDrifted: 2,
      generatedAt: NOW,
    })
    const drifted = await runReconciliation(pool(), { now: NOW })
    expect(resultOf(drifted, 'R093').result).toBe('DRIFT')

    await resetParity(pool())
    await insertParityReport(pool(), {
      source: SOURCE_USAGE,
      windowStart: '2026-08-17T00:00:00.000Z',
      windowEnd: '2026-08-18T00:00:00.000Z',
      status: 'GREEN',
      driftRateBps: 0,
      generatedAt: NOW,
    })
    const clean = await runReconciliation(pool(), { now: NOW })
    expect(resultOf(clean, 'R093').result).toBe('GREEN')
  })

  it('R094 DRIFT on a calendar gap then GREEN when days are consecutive', async () => {
    await resetParity(pool())
    const { windowStart: aStart, windowEnd: aEnd } = utcDayRange('2026-08-10')
    const { windowStart: bStart, windowEnd: bEnd } = utcDayRange('2026-08-12')
    await insertParityReport(pool(), {
      source: SOURCE_USAGE, windowStart: aStart, windowEnd: aEnd,
      status: 'GREEN', generatedAt: '2026-08-10T02:00:00.000Z',
    })
    await insertParityReport(pool(), {
      source: SOURCE_USAGE, windowStart: bStart, windowEnd: bEnd,
      status: 'GREEN', generatedAt: '2026-08-12T02:00:00.000Z',
    })
    const drifted = await runReconciliation(pool(), { now: NOW })
    expect(resultOf(drifted, 'R094').result).toBe('DRIFT')

    await resetParity(pool())
    const { windowStart: cStart, windowEnd: cEnd } = utcDayRange('2026-08-11')
    await insertParityReport(pool(), {
      source: SOURCE_USAGE, windowStart: aStart, windowEnd: aEnd,
      status: 'GREEN', generatedAt: '2026-08-10T02:00:00.000Z',
    })
    await insertParityReport(pool(), {
      source: SOURCE_USAGE, windowStart: cStart, windowEnd: cEnd,
      status: 'GREEN', generatedAt: '2026-08-11T02:00:00.000Z',
    })
    await insertParityReport(pool(), {
      source: SOURCE_USAGE, windowStart: bStart, windowEnd: bEnd,
      status: 'GREEN', generatedAt: '2026-08-12T02:00:00.000Z',
    })
    const clean = await runReconciliation(pool(), { now: NOW })
    expect(resultOf(clean, 'R094').result).toBe('GREEN')
  })

  it('R095 DRIFT when corrections trend up during burn-in then GREEN when flat', async () => {
    await resetParity(pool())
    await insertParityReport(pool(), {
      source: SOURCE_USAGE,
      windowStart: '2026-08-17T00:00:00.000Z',
      windowEnd: '2026-08-18T00:00:00.000Z',
      status: 'GREEN',
      generatedAt: NOW,
    })
    for (let i = 0; i < 3; i += 1) {
      await pool().query(
        `INSERT INTO fin.cutover_backfill_corrections (
           id, environment, source, source_row_id, correction_kind,
           reason, legacy_payload, created_at
         ) VALUES (
           $1,'LIVE','commercial.usage_events',$2,'OTHER',
           'seed','{}'::jsonb,$3::timestamptz
         )`,
        [randomUUID(), `row-${i}`, NOW],
      )
    }
    const drifted = await runReconciliation(pool(), { now: NOW })
    expect(resultOf(drifted, 'R095').result).toBe('DRIFT')

    const previousWindow = '2026-08-16T18:00:00.000Z'
    for (let i = 0; i < 3; i += 1) {
      await pool().query(
        `INSERT INTO fin.cutover_backfill_corrections (
           id, environment, source, source_row_id, correction_kind,
           reason, legacy_payload, created_at
         ) VALUES (
           $1,'LIVE','commercial.usage_events',$2,'OTHER',
           'seed-prev','{}'::jsonb,$3::timestamptz
         )`,
        [randomUUID(), `row-prev-${i}`, previousWindow],
      )
    }
    const clean = await runReconciliation(pool(), { now: NOW })
    expect(resultOf(clean, 'R095').result).toBe('GREEN')
  })
})
