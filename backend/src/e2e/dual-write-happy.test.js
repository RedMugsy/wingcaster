/**
 * Backend integration — legacy emitUsageEvent for an allowlisted tenant
 * mirrors into fin.usage_events inside the same transaction boundary.
 */
import { expect, it } from 'vitest'
import { emitUsageEvent } from '../billing/events.js'
import { NOW } from '../fin/testing/seed.js'
import { finPostgresSuite } from '../fin/testing/suite.js'
import { transaction } from '../db.js'

finPostgresSuite('e2e/dual-write-happy', {}, ({ pool, world }) => {
  it('allowlisted legacy usage write mirrors to fin.* in one tx', async () => {
    const publicTenantId = world().tenantA.publicTenantId
    await pool().query(
      `INSERT INTO fin.cutover_tenant_allowlist (
         environment, tenant_id, mode, reason_code,
         added_by_actor_type, created_at, updated_at
       ) VALUES ('LIVE', $1, 'DUAL', 'E2E_ALLOWLIST', 'SYSTEM', $2, $2)
       ON CONFLICT (environment, tenant_id) DO UPDATE SET mode = 'DUAL'`,
      [publicTenantId, NOW],
    )

    const event = await emitUsageEvent({
      actionKey: 'ai.chat.turn',
      tenantId: publicTenantId,
      quantity: 1,
      channel: 'web',
      metadata: { fin_environment: 'LIVE', e2e: true },
    })
    expect(event?.id).toBeTruthy()

    // Prove both rows are visible after the emit transaction committed.
    const both = await transaction(async (client) => {
      const commercial = await client.query(
        `SELECT id, quantity FROM commercial.usage_events WHERE id = $1`,
        [event.id],
      )
      const fin = await client.query(
        `SELECT id, quantity_units::text AS qty, source_event_id
           FROM fin.usage_events
          WHERE source_system = 'commercial.usage_events'
            AND source_event_id = $1`,
        [event.id],
      )
      return { commercial: commercial.rows[0], fin: fin.rows[0] }
    })

    expect(both.commercial).toBeTruthy()
    expect(both.fin).toBeTruthy()
    expect(both.fin.source_event_id).toBe(event.id)
    expect(both.fin.qty).toBe(String(event.quantity))
  })
})
