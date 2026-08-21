/**
 * Real-Postgres — commercial rows for an unmapped tenant become
 * MISSING_TENANT_MAP corrections and no fin.usage_events.
 */
import { expect, it } from 'vitest'
import { NOW } from '../../testing/seed.js'
import { finPostgresSuite } from '../../testing/suite.js'
import { runBackfill } from './orchestrator.js'
import { USAGE_SOURCE, USAGE_SOURCE_SYSTEM } from './usage-events.js'
import {
  allowlistDual, insertCutoffMarker, insertCommercialUsage,
  insertUnmappedPublicTenant, HISTORICAL,
} from './test-support.js'

finPostgresSuite('backfill/correction-missing-tenant', {}, ({ pool, world }) => {
  it('logs MISSING_TENANT_MAP and writes zero fin.usage_events', async () => {
    await allowlistDual(pool(), world().tenantA.publicTenantId)
    await insertCutoffMarker(world())
    const ghost = await insertUnmappedPublicTenant(pool())
    await insertCommercialUsage(pool(), {
      tenantId: ghost.publicTenantId,
      occurredAt: HISTORICAL,
    })

    const result = await runBackfill({
      environment: 'LIVE', source: USAGE_SOURCE, now: NOW,
    })
    expect(result.ok).toBe(true)
    expect(result.rowsWritten).toBe(0)
    expect(result.rowsCorrected).toBe(1)

    const fin = await pool().query(
      `SELECT count(*)::int AS n FROM fin.usage_events WHERE source_system = $1`,
      [USAGE_SOURCE_SYSTEM],
    )
    expect(fin.rows[0].n).toBe(0)

    const corrections = await pool().query(
      `SELECT correction_kind FROM fin.cutover_backfill_corrections
        WHERE source = $1`,
      [USAGE_SOURCE],
    )
    expect(corrections.rows.map((r) => r.correction_kind)).toEqual(['MISSING_TENANT_MAP'])
  })
})
