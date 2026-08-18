import { randomUUID } from 'node:crypto'
import { expect, it } from 'vitest'
import { NOW } from '../testing/seed.js'
import { finPostgresSuite } from '../testing/suite.js'
import { ingestUsageEvent } from './ingest.js'

finPostgresSuite('usage ingest partition-missing (audit A-2)', {}, ({ pool, world }) => {
  it('unknown residency_key lands in DLQ with PARTITION_MISSING and is audited', async () => {
    const sourceEventId = randomUUID()
    const result = await ingestUsageEvent({
      environment: 'LIVE',
      tenantId: world().tenantA.tenantId,
      sourceSystem: 'orchestrator',
      sourceEventId,
      eventType: 'message.out.whatsapp.utility',
      quantityUnits: 1,
      occurredAt: NOW,
      receivedAt: NOW,
      residencyKey: 'no_such_cell',
    })
    expect(result.ok).toBe(false)
    expect(result.error_code).toBe('PARTITION_MISSING')
    expect(result.dlq_id).toBeTruthy()

    const dlq = await pool().query(
      `SELECT error_code, residency_key, source_event_id
         FROM fin.usage_events_dlq WHERE id = $1`,
      [result.dlq_id],
    )
    expect(dlq.rowCount).toBe(1)
    expect(dlq.rows[0]).toMatchObject({
      error_code: 'PARTITION_MISSING',
      residency_key: 'no_such_cell',
      source_event_id: sourceEventId,
    })

    const events = await pool().query(
      `SELECT count(*)::int AS n FROM fin.usage_events
        WHERE source_system = 'orchestrator' AND source_event_id = $1`,
      [sourceEventId],
    )
    expect(events.rows[0].n).toBe(0)

    const audit = await pool().query(
      `SELECT action, reason_code, target_id
         FROM fin.financial_audit_events
        WHERE action = 'USAGE_DLQ' AND target_id = $1`,
      [result.dlq_id],
    )
    expect(audit.rowCount).toBe(1)
    expect(audit.rows[0].reason_code).toBe('PARTITION_MISSING')
  })
})
