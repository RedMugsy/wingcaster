import { randomUUID } from 'node:crypto'
import { expect, it } from 'vitest'
import { FinError } from '../errors.js'
import { NOW } from '../testing/seed.js'
import { finPostgresSuite } from '../testing/suite.js'
import { ingestUsageEvent } from './ingest.js'

function payload(world, extra = {}) {
  return {
    environment: 'LIVE',
    tenantId: world.tenantA.tenantId,
    sourceSystem: 'orchestrator',
    sourceEventId: randomUUID(),
    eventType: 'message.out.whatsapp.utility',
    quantityUnits: 1_000_000,
    occurredAt: NOW,
    receivedAt: NOW,
    ...extra,
  }
}

finPostgresSuite('usage ingest', {}, ({ pool, world }) => {
  it('inserts an ORIGINAL event and returns id', async () => {
    const result = await ingestUsageEvent(payload(world()))
    expect(result).toMatchObject({ ok: true, deduped: false })
    expect(result.id).toBeTruthy()
    const row = await pool().query(
      `SELECT event_kind, residency_key, quantity_units::text AS qty
         FROM fin.usage_events WHERE id = $1`,
      [result.id],
    )
    expect(row.rows[0].event_kind).toBe('ORIGINAL')
    expect(row.rows[0].residency_key).toBe('ksa')
    expect(row.rows[0].qty).toBe('1000000')
    const outbox = await pool().query(
      `SELECT topic, dedupe_key FROM fin.outbox_events
        WHERE topic = 'fin.usage.received' AND dedupe_key = $1`,
      [`usage:ksa:${result.id}`],
    )
    expect(outbox.rowCount).toBe(1)
  })

  it('dedups on (source_system, source_event_id, residency_key)', async () => {
    const sourceEventId = randomUUID()
    const first = await ingestUsageEvent(payload(world(), { sourceEventId }))
    const second = await ingestUsageEvent(payload(world(), {
      sourceEventId,
      quantityUnits: 9,
    }))
    expect(second).toEqual({ ok: true, id: first.id, deduped: true })
    const count = await pool().query(
      `SELECT count(*)::int AS n FROM fin.usage_events
        WHERE source_system = 'orchestrator' AND source_event_id = $1`,
      [sourceEventId],
    )
    expect(count.rows[0].n).toBe(1)
  })

  it('CORRECTION with matching composite FK', async () => {
    const original = await ingestUsageEvent(payload(world()))
    const correction = await ingestUsageEvent(payload(world(), {
      eventKind: 'CORRECTION',
      correctsEventId: original.id,
      correctsResidencyKey: 'ksa',
    }))
    expect(correction.ok).toBe(true)
    const row = await pool().query(
      `SELECT event_kind, corrects_event_id, corrects_residency_key
         FROM fin.usage_events WHERE id = $1`,
      [correction.id],
    )
    expect(row.rows[0]).toMatchObject({
      event_kind: 'CORRECTION',
      corrects_event_id: original.id,
      corrects_residency_key: 'ksa',
    })
  })

  it('ORIGINAL rejects when correctsEventId is set', async () => {
    await expect(ingestUsageEvent(payload(world(), {
      eventKind: 'ORIGINAL',
      correctsEventId: randomUUID(),
      correctsResidencyKey: 'ksa',
    }))).rejects.toBeInstanceOf(FinError)
    await expect(ingestUsageEvent(payload(world(), {
      eventKind: 'ORIGINAL',
      correctsEventId: randomUUID(),
      correctsResidencyKey: 'ksa',
    }))).rejects.toMatchObject({ code: 'EVENT_KIND_MISMATCH' })
  })

  it('non-ORIGINAL rejects when correctsEventId is missing', async () => {
    await expect(ingestUsageEvent(payload(world(), {
      eventKind: 'CANCELLATION',
    }))).rejects.toMatchObject({ code: 'EVENT_KIND_MISMATCH' })
  })

  it('resolves residency_key from tenant default vs __platform__', async () => {
    const withTenant = await ingestUsageEvent(payload(world()))
    const tenantRow = await pool().query(
      `SELECT residency_key FROM fin.usage_events WHERE id = $1`,
      [withTenant.id],
    )
    expect(tenantRow.rows[0].residency_key).toBe('ksa')

    const platform = await ingestUsageEvent(payload(world(), {
      tenantId: undefined,
      residencyKey: undefined,
    }))
    const platformRow = await pool().query(
      `SELECT residency_key, tenant_id FROM fin.usage_events WHERE id = $1`,
      [platform.id],
    )
    expect(platformRow.rows[0].residency_key).toBe('__platform__')
    expect(platformRow.rows[0].tenant_id).toBeNull()

    const explicit = await ingestUsageEvent(payload(world(), {
      residencyKey: '__platform__',
    }))
    const explicitRow = await pool().query(
      `SELECT residency_key FROM fin.usage_events WHERE id = $1`,
      [explicit.id],
    )
    expect(explicitRow.rows[0].residency_key).toBe('__platform__')
  })
})
