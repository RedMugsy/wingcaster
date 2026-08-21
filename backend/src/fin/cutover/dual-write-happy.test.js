/**
 * Real-Postgres — allowlisted tenant dual-writes commercial + fin usage.
 */
import { expect, it } from 'vitest'
import { emitUsageEvent } from '../../billing/events.js'
import { NOW } from '../testing/seed.js'
import { finPostgresSuite } from '../testing/suite.js'

async function allowlistDual(pool, publicTenantId) {
  await pool.query(
    `INSERT INTO fin.cutover_tenant_allowlist (
       environment, tenant_id, mode, reason_code,
       added_by_actor_type, added_by_actor_id, created_at, updated_at
     ) VALUES ('LIVE', $1, 'DUAL', 'TEST_ALLOWLIST', 'SYSTEM', null, $2, $2)
     ON CONFLICT (environment, tenant_id) DO UPDATE
       SET mode = 'DUAL', updated_at = EXCLUDED.updated_at`,
    [publicTenantId, NOW],
  )
}

finPostgresSuite('cutover dual-write happy', {}, ({ pool, world }) => {
  it('writes commercial.usage_events and matching fin.usage_events', async () => {
    const publicTenantId = world().tenantA.publicTenantId
    await allowlistDual(pool(), publicTenantId)

    const event = await emitUsageEvent({
      actionKey: 'webhook.received',
      tenantId: publicTenantId,
      quantity: 2,
      channel: 'whatsapp',
      metadata: { fin_environment: 'LIVE' },
    })
    expect(event).toBeTruthy()
    expect(event.id).toBeTruthy()

    const commercial = await pool().query(
      `SELECT id, quantity, action_key FROM commercial.usage_events WHERE id = $1`,
      [event.id],
    )
    expect(commercial.rowCount).toBe(1)
    expect(Number(commercial.rows[0].quantity)).toBe(2)

    const fin = await pool().query(
      `SELECT id, tenant_id, source_system, source_event_id, event_type,
              quantity_units::text AS qty
         FROM fin.usage_events
        WHERE source_system = 'commercial.usage_events'
          AND source_event_id = $1`,
      [event.id],
    )
    expect(fin.rowCount).toBe(1)
    expect(fin.rows[0]).toMatchObject({
      tenant_id: world().tenantA.tenantId,
      source_system: 'commercial.usage_events',
      source_event_id: event.id,
      event_type: 'webhook.received',
      qty: '2',
    })
  })
})
