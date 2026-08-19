import { randomUUID } from 'node:crypto'
import { expect, it } from 'vitest'
import { NOW } from '../testing/seed.js'
import { finPostgresSuite } from '../testing/suite.js'
import { ingestUsageEvent } from './ingest.js'

finPostgresSuite('usage ingest no-double-charge (F R030)', {}, ({ pool, world }) => {
  it('two ingests with the same source key produce one row and the same id', async () => {
    const sourceEventId = randomUUID()
    const input = {
      environment: 'LIVE',
      tenantId: world().tenantA.tenantId,
      sourceSystem: 'webhooks',
      sourceEventId,
      eventType: 'webhook.received',
      quantityUnits: 2,
      occurredAt: NOW,
      receivedAt: NOW,
    }
    const first = await ingestUsageEvent(input)
    const second = await ingestUsageEvent({ ...input, quantityUnits: 99 })
    expect(first.ok).toBe(true)
    expect(second.ok).toBe(true)
    expect(second.id).toBe(first.id)
    expect(second.deduped).toBe(true)
    const rows = await pool().query(
      `SELECT id, quantity_units::text AS qty FROM fin.usage_events
        WHERE source_system = 'webhooks' AND source_event_id = $1 AND residency_key = 'ksa'`,
      [sourceEventId],
    )
    expect(rows.rowCount).toBe(1)
    expect(rows.rows[0].id).toBe(first.id)
    expect(rows.rows[0].qty).toBe('2')
  })
})
