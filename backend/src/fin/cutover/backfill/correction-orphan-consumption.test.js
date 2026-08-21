/**
 * Real-Postgres — consumption with no prior allowance_grant is
 * ORPHAN_CONSUMPTION and does not write fin.rated_usage.
 */
import { expect, it } from 'vitest'
import { NOW } from '../../testing/seed.js'
import { finPostgresSuite } from '../../testing/suite.js'
import { runBackfill } from './orchestrator.js'
import { CONSUMPTION_SOURCE, CONSUMPTION_SOURCE_SYSTEM } from './consumption.js'
import {
  allowlistDual, insertCutoffMarker, insertLedgerEntry, HISTORICAL,
} from './test-support.js'

finPostgresSuite('backfill/correction-orphan-consumption', {}, ({ pool, world }) => {
  it('logs ORPHAN_CONSUMPTION and writes no fin.rated_usage', async () => {
    await allowlistDual(pool(), world().tenantA.publicTenantId)
    await insertCutoffMarker(world())
    await insertLedgerEntry(pool(), {
      tenantId: world().tenantA.publicTenantId,
      type: 'consumption',
      amount: -3,
      createdAt: HISTORICAL,
    })

    const result = await runBackfill({
      environment: 'LIVE', source: CONSUMPTION_SOURCE, now: NOW,
    })
    expect(result.ok).toBe(true)
    expect(result.rowsWritten).toBe(0)
    expect(result.rowsCorrected).toBe(1)

    const rated = await pool().query(
      `SELECT count(*)::int AS n FROM fin.rated_usage WHERE source_system = $1`,
      [CONSUMPTION_SOURCE_SYSTEM],
    )
    expect(rated.rows[0].n).toBe(0)

    const corrections = await pool().query(
      `SELECT correction_kind FROM fin.cutover_backfill_corrections
        WHERE source = $1`,
      [CONSUMPTION_SOURCE],
    )
    expect(corrections.rows[0].correction_kind).toBe('ORPHAN_CONSUMPTION')
  })
})
