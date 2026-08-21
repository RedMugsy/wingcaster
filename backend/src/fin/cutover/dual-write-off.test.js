/**
 * Real-Postgres — tenant not on allowlist writes legacy only.
 */
import { expect, it } from 'vitest'
import { emitUsageEvent } from '../../billing/events.js'
import { finPostgresSuite } from '../testing/suite.js'

finPostgresSuite('cutover dual-write off', {}, ({ pool, world }) => {
  it('writes commercial.usage_events only when mode is OFF', async () => {
    const publicTenantId = world().tenantB.publicTenantId

    const before = await pool().query(
      `SELECT count(*)::int AS n FROM fin.usage_events
        WHERE source_system = 'commercial.usage_events'`,
    )

    const event = await emitUsageEvent({
      actionKey: 'webhook.received',
      tenantId: publicTenantId,
      quantity: 1,
      channel: 'instagram',
    })
    expect(event).toBeTruthy()

    const commercial = await pool().query(
      `SELECT id FROM commercial.usage_events WHERE id = $1`,
      [event.id],
    )
    expect(commercial.rowCount).toBe(1)

    const fin = await pool().query(
      `SELECT id FROM fin.usage_events
        WHERE source_system = 'commercial.usage_events'
          AND source_event_id = $1`,
      [event.id],
    )
    expect(fin.rowCount).toBe(0)

    const after = await pool().query(
      `SELECT count(*)::int AS n FROM fin.usage_events
        WHERE source_system = 'commercial.usage_events'`,
    )
    expect(after.rows[0].n).toBe(before.rows[0].n)
  })
})
