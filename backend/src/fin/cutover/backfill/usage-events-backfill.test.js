/**
 * Real-Postgres — 100 commercial.usage_events backfill into fin.usage_events.
 */
import { expect, it } from 'vitest'
import { NOW } from '../../testing/seed.js'
import { finPostgresSuite } from '../../testing/suite.js'
import { runBackfill } from './orchestrator.js'
import { USAGE_SOURCE, USAGE_SOURCE_SYSTEM } from './usage-events.js'
import {
  allowlistDual, insertCutoffMarker, insertCommercialUsage, HISTORICAL,
} from './test-support.js'

finPostgresSuite('backfill/usage-events-backfill', {}, ({ pool, world }) => {
  it('backfills 100 commercial.usage_events with source_system=commercial', async () => {
    const publicTenantId = world().tenantA.publicTenantId
    await allowlistDual(pool(), publicTenantId)
    await insertCutoffMarker(world())

    for (let i = 0; i < 100; i += 1) {
      await insertCommercialUsage(pool(), {
        tenantId: publicTenantId,
        quantity: 1,
        occurredAt: HISTORICAL,
      })
    }

    const result = await runBackfill({
      environment: 'LIVE',
      source: USAGE_SOURCE,
      batchSize: 40,
      now: NOW,
    })
    expect(result.ok).toBe(true)
    expect(result.rowsProcessed).toBe(100)
    expect(result.rowsWritten).toBe(100)

    const fin = await pool().query(
      `SELECT count(*)::int AS n FROM fin.usage_events
        WHERE source_system = $1 AND tenant_id = $2`,
      [USAGE_SOURCE_SYSTEM, world().tenantA.tenantId],
    )
    expect(fin.rows[0].n).toBe(100)
  })
})
