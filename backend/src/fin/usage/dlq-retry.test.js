import { randomUUID } from 'node:crypto'
import { expect, it } from 'vitest'
import { NOW } from '../testing/seed.js'
import { finPostgresSuite } from '../testing/suite.js'
import { runUsageDlqWorker } from './dlq-worker.js'

async function insertDlq(pool, {
  residencyKey,
  sourceEventId,
  nextRetryAt,
  attempts = 0,
  quantityUnits = 1,
}) {
  const id = randomUUID()
  await pool.query(
    `INSERT INTO fin.usage_events_dlq (
       id, environment, residency_key, tenant_id, source_system, source_event_id,
       event_type, event_kind, quantity_units, dimensions, occurred_at, received_at,
       ingestion_version, payload, error_code, error_message, attempts,
       next_retry_at, created_at, updated_at
     ) VALUES (
       $1, 'LIVE', $2, $3, 'orchestrator', $4,
       'message.out.whatsapp.utility', 'ORIGINAL', $5, '{}'::jsonb, $6, $6,
       1, '{}'::jsonb, 'PARTITION_MISSING', 'test', $7,
       $8, $6, $6
     )`,
    [
      id, residencyKey, null, sourceEventId, quantityUnits, NOW,
      attempts, nextRetryAt,
    ],
  )
  return id
}

finPostgresSuite('usage DLQ replay worker', {}, ({ pool, world }) => {
  it('deletes a DLQ row after a successful retry once the partition exists', async () => {
    const sourceEventId = randomUUID()
    const dlqId = await insertDlq(pool(), {
      residencyKey: 'ksa',
      sourceEventId,
      nextRetryAt: '2026-08-18T11:00:00.000Z',
      tenantId: world().tenantA.tenantId,
    })
    await pool().query(
      `UPDATE fin.usage_events_dlq SET tenant_id = $2 WHERE id = $1`,
      [dlqId, world().tenantA.tenantId],
    )

    const ran = await runUsageDlqWorker(pool(), { now: NOW })
    expect(ran.skipped).toBe(false)
    expect(ran.results.some((r) => r.id === dlqId && r.result === 'ingested')).toBe(true)

    const leftover = await pool().query(
      `SELECT id FROM fin.usage_events_dlq WHERE id = $1`,
      [dlqId],
    )
    expect(leftover.rowCount).toBe(0)

    const event = await pool().query(
      `SELECT id FROM fin.usage_events
        WHERE source_system = 'orchestrator' AND source_event_id = $1 AND residency_key = 'ksa'`,
      [sourceEventId],
    )
    expect(event.rowCount).toBe(1)

    const outbox = await pool().query(
      `SELECT topic FROM fin.outbox_events WHERE topic = 'usage.dlq_replay' AND dedupe_key LIKE $1`,
      [`dlq:${dlqId}:%`],
    )
    expect(outbox.rowCount).toBe(1)
  })

  it('increments attempts, pushes next_retry_at, and dead-letters after 5 failures', async () => {
    const sourceEventId = randomUUID()
    const dlqId = await insertDlq(pool(), {
      residencyKey: 'no_such_cell',
      sourceEventId,
      nextRetryAt: '2026-01-01T00:00:00.000Z',
      attempts: 0,
    })

    for (let i = 0; i < 5; i += 1) {
      const tickNow = new Date(Date.parse(NOW) + i * 86_400_000).toISOString()
      await runUsageDlqWorker(pool(), { now: tickNow })
    }

    const row = await pool().query(
      `SELECT attempts, next_retry_at, dead_lettered_at, error_code
         FROM fin.usage_events_dlq WHERE id = $1`,
      [dlqId],
    )
    expect(row.rowCount).toBe(1)
    expect(Number(row.rows[0].attempts)).toBe(5)
    expect(row.rows[0].dead_lettered_at).toBeTruthy()
    expect(row.rows[0].error_code).toBe('PARTITION_MISSING')
    expect(new Date(row.rows[0].next_retry_at).getTime()).toBeGreaterThan(Date.parse(NOW))
  })
})
