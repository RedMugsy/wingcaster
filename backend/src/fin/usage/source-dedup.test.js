import { randomUUID } from 'node:crypto'
import { expect, it } from 'vitest'
import { NOW } from '../testing/seed.js'
import { finPostgresSuite } from '../testing/suite.js'
import { ingestUsageEvent } from './ingest.js'

finPostgresSuite('usage source-dedup E-T13', {}, ({ pool, world }) => {
  it('100 identical source events collapse to one usage fact', async () => {
    const sourceEventId = randomUUID()
    const input = {
      environment: 'LIVE',
      tenantId: world().tenantA.tenantId,
      sourceSystem: 'orchestrator',
      sourceEventId,
      eventType: 'message.out.whatsapp.utility',
      quantityUnits: 3,
      occurredAt: NOW,
      receivedAt: NOW,
    }
    const results = []
    for (let i = 0; i < 100; i += 1) {
      results.push(await ingestUsageEvent(input))
    }
    expect(results.every((r) => r.ok)).toBe(true)
    expect(results[0].deduped).toBe(false)
    expect(results.slice(1).every((r) => r.deduped && r.id === results[0].id)).toBe(true)
    const count = await pool().query(
      `SELECT count(*)::int AS n, (array_agg(quantity_units))[1]::text AS qty
         FROM fin.usage_events
        WHERE source_system = 'orchestrator' AND source_event_id = $1`,
      [sourceEventId],
    )
    expect(count.rows[0].n).toBe(1)
    expect(count.rows[0].qty).toBe('3')
  })
})
