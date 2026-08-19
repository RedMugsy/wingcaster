import { randomUUID } from 'node:crypto'
import { expect, it } from 'vitest'
import { asRole, NOW } from '../testing/seed.js'
import { finPostgresSuite } from '../testing/suite.js'

finPostgresSuite('usage_events pre-attribution RLS H §1.2', {}, ({ pool, world }) => {
  it('fin_app_role can INSERT a NULL-tenant __platform__ row and cannot SELECT it without bypass', async () => {
    const id = randomUUID()
    const client = await pool().connect()
    try {
      await asRole(client, 'fin_app_role', { 'fin.environment': 'LIVE' }, (c) => c.query(
        `INSERT INTO fin.usage_events (
           id, environment, residency_key, source_system, source_event_id,
           event_type, event_kind, quantity_units, dimensions, occurred_at, received_at,
           ingestion_version, created_at
         ) VALUES (
           $1, 'LIVE', '__platform__', 'webhooks', $2,
           'webhook.received', 'ORIGINAL', 0, '{}'::jsonb, $3, $3, 1, $3
         )`,
        [id, randomUUID(), NOW],
      ))

      const hidden = await asRole(client, 'fin_app_role', {
        'fin.environment': 'LIVE',
        'fin.tenant_id': world().tenantA.tenantId,
      }, (c) => c.query(`SELECT id FROM fin.usage_events WHERE id = $1`, [id]))
      expect(hidden.rows).toEqual([])

      const viaBypass = await asRole(client, 'fin_app_role', {
        'fin.environment': 'LIVE',
        'fin.tenant_id': world().tenantA.tenantId,
        'fin.platform_admin': 'on',
        'fin.elevated': 'on',
      }, (c) => c.query(`SELECT id FROM fin.usage_events WHERE id = $1`, [id]))
      expect(viaBypass.rows.map((r) => r.id)).toEqual([id])
    } finally {
      client.release()
    }
  })
})
