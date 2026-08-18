import { randomUUID } from 'node:crypto'
import { expect, it } from 'vitest'
import { asRole, NOW } from '../testing/seed.js'
import { finPostgresSuite } from '../testing/suite.js'
import { ingestUsageEvent } from './ingest.js'

finPostgresSuite('111_fin_usage_events', {}, ({ pool, world }) => {
  it('creates the default __platform__ partition and a ksa partition from the legal entity', async () => {
    const parts = await pool().query(
      `SELECT c.relname
         FROM pg_class c
         JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE n.nspname = 'fin'
          AND c.relispartition
          AND c.relname LIKE 'usage_events%'
        ORDER BY c.relname`,
    )
    expect(parts.rows.map((r) => r.relname)).toEqual([
      'usage_events_default',
      'usage_events_ksa',
    ])
  })

  it('A §18 #1 — ON CONFLICT DO NOTHING leaves the original quantity unchanged', async () => {
    const sourceEventId = randomUUID()
    const id = randomUUID()
    await pool().query(
      `INSERT INTO fin.usage_events (
         id, environment, residency_key, tenant_id, source_system, source_event_id,
         event_type, event_kind, quantity_units, dimensions, occurred_at, received_at,
         ingestion_version, created_at
       ) VALUES (
         $1, 'LIVE', 'ksa', $2, 'orchestrator', $3,
         'message.out.whatsapp.utility', 'ORIGINAL', 7, '{}'::jsonb, $4, $4, 1, $4
       )`,
      [id, world().tenantA.tenantId, sourceEventId, NOW],
    )
    const conflict = await pool().query(
      `INSERT INTO fin.usage_events (
         id, environment, residency_key, tenant_id, source_system, source_event_id,
         event_type, event_kind, quantity_units, dimensions, occurred_at, received_at,
         ingestion_version, created_at
       ) VALUES (
         $1, 'LIVE', 'ksa', $2, 'orchestrator', $3,
         'message.out.whatsapp.utility', 'ORIGINAL', 99, '{}'::jsonb, $4, $4, 1, $4
       )
       ON CONFLICT (environment, source_system, source_event_id, residency_key)
       DO NOTHING
       RETURNING id`,
      [randomUUID(), world().tenantA.tenantId, sourceEventId, NOW],
    )
    expect(conflict.rowCount).toBe(0)
    const row = await pool().query(
      `SELECT id, quantity_units::text AS qty FROM fin.usage_events
        WHERE source_event_id = $1`,
      [sourceEventId],
    )
    expect(row.rows[0].id).toBe(id)
    expect(row.rows[0].qty).toBe('7')
  })

  it('APPEND_ONLY — fin_app_role cannot UPDATE or DELETE usage_events', async () => {
    const ingested = await ingestUsageEvent({
      environment: 'LIVE',
      tenantId: world().tenantA.tenantId,
      sourceSystem: 'orchestrator',
      sourceEventId: randomUUID(),
      eventType: 'message.out.whatsapp.utility',
      quantityUnits: 1,
      occurredAt: NOW,
      receivedAt: NOW,
    })
    const client = await pool().connect()
    try {
      const gucs = {
        'fin.environment': 'LIVE',
        'fin.tenant_id': world().tenantA.tenantId,
      }
      await expect(asRole(client, 'fin_app_role', gucs, (c) => c.query(
        `UPDATE fin.usage_events SET quantity_units = 0 WHERE id = $1`,
        [ingested.id],
      ))).rejects.toThrow(/permission denied|insufficient privilege/i)
      await expect(asRole(client, 'fin_app_role', gucs, (c) => c.query(
        `DELETE FROM fin.usage_events WHERE id = $1`,
        [ingested.id],
      ))).rejects.toThrow(/permission denied|insufficient privilege/i)
    } finally {
      client.release()
    }
  })
})
