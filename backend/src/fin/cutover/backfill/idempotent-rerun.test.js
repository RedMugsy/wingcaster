/**
 * Real-Postgres — rerunning the same backfill window writes zero new rows.
 */
import { expect, it } from 'vitest'
import { NOW } from '../../testing/seed.js'
import { finPostgresSuite } from '../../testing/suite.js'
import { runBackfill } from './orchestrator.js'
import { USAGE_SOURCE, USAGE_SOURCE_SYSTEM } from './usage-events.js'
import {
  allowlistDual, insertCutoffMarker, insertCommercialUsage, HISTORICAL,
} from './test-support.js'

finPostgresSuite('backfill/idempotent-rerun', {}, ({ pool, world }) => {
  it('second run writes zero new fin.usage_events', async () => {
    const publicTenantId = world().tenantA.publicTenantId
    await allowlistDual(pool(), publicTenantId)
    await insertCutoffMarker(world())
    for (let i = 0; i < 7; i += 1) {
      await insertCommercialUsage(pool(), {
        tenantId: publicTenantId,
        occurredAt: HISTORICAL,
      })
    }

    const first = await runBackfill({
      environment: 'LIVE', source: USAGE_SOURCE, now: NOW,
    })
    expect(first.ok).toBe(true)
    expect(first.rowsWritten).toBe(7)

    const second = await runBackfill({
      environment: 'LIVE', source: USAGE_SOURCE, now: NOW,
    })
    expect(second.ok).toBe(true)
    expect(second.rowsWritten).toBe(0)

    const fin = await pool().query(
      `SELECT count(*)::int AS n FROM fin.usage_events WHERE source_system = $1`,
      [USAGE_SOURCE_SYSTEM],
    )
    expect(fin.rows[0].n).toBe(7)
  })
})
