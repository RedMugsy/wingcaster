/**
 * Real-Postgres — historical consumption → rated_usage + accounting_events
 * with event_at = legacy created_at.
 */
import { expect, it } from 'vitest'
import { NOW } from '../../testing/seed.js'
import { finPostgresSuite } from '../../testing/suite.js'
import { runBackfill } from './orchestrator.js'
import { CONSUMPTION_SOURCE, CONSUMPTION_SOURCE_SYSTEM } from './consumption.js'
import {
  allowlistDual, insertCutoffMarker, insertLedgerEntry, HISTORICAL,
} from './test-support.js'

const GRANT_AT = '2026-08-09T00:00:00.000Z'
const CONSUME_AT = '2026-08-10T00:00:00.000Z'

finPostgresSuite('backfill/consumption-backfill', {}, ({ pool, world }) => {
  it('writes rated_usage and accounting_events stamped at legacy created_at', async () => {
    await allowlistDual(pool(), world().tenantA.publicTenantId)
    await insertCutoffMarker(world())
    await insertLedgerEntry(pool(), {
      tenantId: world().tenantA.publicTenantId,
      type: 'allowance_grant',
      amount: 10,
      createdAt: GRANT_AT,
    })
    const consumptionId = await insertLedgerEntry(pool(), {
      tenantId: world().tenantA.publicTenantId,
      type: 'consumption',
      amount: -4,
      createdAt: CONSUME_AT,
    })

    const result = await runBackfill({
      environment: 'LIVE', source: CONSUMPTION_SOURCE, now: NOW,
    })
    expect(result.ok).toBe(true)
    expect(result.rowsWritten).toBe(1)

    const rated = await pool().query(
      `SELECT id, source_system, source_row_id, occurred_at
         FROM fin.rated_usage
        WHERE source_system = $1 AND source_row_id = $2`,
      [CONSUMPTION_SOURCE_SYSTEM, consumptionId],
    )
    expect(rated.rowCount).toBe(1)
    expect(new Date(rated.rows[0].occurred_at).toISOString()).toBe(CONSUME_AT)

    const events = await pool().query(
      `SELECT event_kind, event_at, source_type
         FROM fin.accounting_events
        WHERE source_id = $1
        ORDER BY event_kind`,
      [rated.rows[0].id],
    )
    expect(events.rows.map((r) => r.event_kind).sort()).toEqual([
      'DEFERRED_REVENUE_CREATED',
      'REVENUE_RECOGNIZED',
    ])
    for (const row of events.rows) {
      expect(row.source_type).toBe('RATED_USAGE')
      expect(new Date(row.event_at).toISOString()).toBe(CONSUME_AT)
    }
  })
})
