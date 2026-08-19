import { randomUUID } from 'node:crypto'
import { expect, it } from 'vitest'
import { ingestUsageEvent } from '../usage/ingest.js'
import { finPostgresSuite } from '../testing/suite.js'
import { meterPeriod } from './pipeline.js'
import { meterInput, seedMeter, usagePayload } from './test-support.js'

finPostgresSuite('metering correction-handling', {}, ({ pool, world }) => {
  it('CANCELLATION removes the original from the aggregate on re-meter', async () => {
    const { meterVersionId } = await seedMeter(pool(), { code: `cancel.${randomUUID()}` })
    const keep = await ingestUsageEvent(usagePayload(world(), { quantityUnits: 1_000_000 }))
    const drop = await ingestUsageEvent(usagePayload(world(), { quantityUnits: 2_000_000 }))
    const first = await meterPeriod(meterInput(world(), { meterVersionId }))
    expect(first.quantityUnits).toBe(3_000_000)

    await ingestUsageEvent(usagePayload(world(), {
      eventKind: 'CANCELLATION',
      correctsEventId: drop.id,
      correctsResidencyKey: 'ksa',
      quantityUnits: 2_000_000,
      occurredAt: '2026-08-20T00:00:00.000Z',
    }))
    const second = await meterPeriod(meterInput(world(), { meterVersionId }))
    expect(second.ok).toBe(true)
    expect(second.superseded).toBe(first.meteredUsageId)
    expect(second.quantityUnits).toBe(1_000_000)
    const remaining = await pool().query(
      `SELECT u.id FROM fin.metered_usage_sources s
         JOIN fin.usage_events u ON u.id = s.usage_event_id AND u.residency_key = s.residency_key
        WHERE s.metered_usage_id = $1 AND s.contribution_units <> 0`,
      [second.meteredUsageId],
    )
    expect(remaining.rows.map((row) => row.id)).toEqual([keep.id])
  })

  it('REPLACEMENT swaps the original quantity in-place on re-meter', async () => {
    const { meterVersionId } = await seedMeter(pool(), { code: `repl.${randomUUID()}` })
    const original = await ingestUsageEvent(usagePayload(world(), { quantityUnits: 1_000_000 }))
    const first = await meterPeriod(meterInput(world(), { meterVersionId }))
    expect(first.quantityUnits).toBe(1_000_000)

    await ingestUsageEvent(usagePayload(world(), {
      eventKind: 'REPLACEMENT',
      correctsEventId: original.id,
      correctsResidencyKey: 'ksa',
      quantityUnits: 4_000_000,
      occurredAt: '2026-08-21T00:00:00.000Z',
    }))
    const second = await meterPeriod(meterInput(world(), { meterVersionId }))
    expect(second.quantityUnits).toBe(4_000_000)
    expect(second.superseded).toBe(first.meteredUsageId)
    const kinds = await pool().query(
      `SELECT u.event_kind, s.contribution_units::text AS qty
         FROM fin.metered_usage_sources s
         JOIN fin.usage_events u ON u.id = s.usage_event_id AND u.residency_key = s.residency_key
        WHERE s.metered_usage_id = $1
        ORDER BY u.event_kind`,
      [second.meteredUsageId],
    )
    expect(kinds.rows).toEqual([
      { event_kind: 'REPLACEMENT', qty: '4000000' },
    ])
  })
})
