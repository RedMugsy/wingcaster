import { randomUUID } from 'node:crypto'
import { expect, it } from 'vitest'
import { FinError } from '../errors.js'
import { finPostgresSuite } from '../testing/suite.js'
import { ingestUsageEvent } from '../usage/ingest.js'
import { meterPeriod } from './pipeline.js'
import { countUsageByEventType, meterInput, seedIsolatedMeter, usagePayload } from './test-support.js'

finPostgresSuite('metering pipeline', {}, ({ pool, world }) => {
  it('SUM over 5 usage events → one metered_usage row and 5 sources', async () => {
    const { meterVersionId, eventType } = await seedIsolatedMeter(pool(), { label: 'sum' })
    for (let i = 0; i < 5; i += 1) {
      await ingestUsageEvent(usagePayload(world(), { eventType }))
    }
    expect(await countUsageByEventType(pool(), eventType)).toBe(5)
    const result = await meterPeriod(meterInput(world(), { meterVersionId }))
    expect(result).toMatchObject({ ok: true, quantityUnits: 5_000_000, sourceCount: 5 })
    expect(result.deduped).toBeUndefined()

    const usage = await pool().query(
      `SELECT quantity_units::text AS qty, status, supersedes_id
         FROM fin.metered_usage WHERE id = $1`,
      [result.meteredUsageId],
    )
    expect(usage.rows[0]).toMatchObject({ qty: '5000000', status: 'ACTIVE', supersedes_id: null })

    const sources = await pool().query(
      `SELECT usage_event_id, residency_key, contribution_units::text AS qty
         FROM fin.metered_usage_sources WHERE metered_usage_id = $1
         ORDER BY usage_event_id`,
      [result.meteredUsageId],
    )
    expect(sources.rowCount).toBe(5)
    expect(sources.rows.every((row) => row.residency_key === 'ksa')).toBe(true)
    expect(sources.rows.every((row) => row.qty === '1000000')).toBe(true)

    const outbox = await pool().query(
      `SELECT topic FROM fin.outbox_events
        WHERE topic = 'fin.metering.completed' AND dedupe_key = $1`,
      [`metering:${meterVersionId}:${world().tenantA.holderId}:2026-08:${result.computationHash}`],
    )
    expect(outbox.rowCount).toBe(1)

    const audit = await pool().query(
      `SELECT action, target_type FROM fin.financial_audit_events
        WHERE target_id = $1 AND action = 'METERED'`,
      [result.meteredUsageId],
    )
    expect(audit.rowCount).toBe(1)
    expect(audit.rows[0].target_type).toBe('METERED_USAGE')
  })

  it('COUNT aggregation', async () => {
    const { meterVersionId, eventType } = await seedIsolatedMeter(pool(), {
      label: 'count',
      aggregationType: 'COUNT',
    })
    for (let i = 0; i < 5; i += 1) {
      await ingestUsageEvent(usagePayload(world(), { eventType, quantityUnits: 9 }))
    }
    expect(await countUsageByEventType(pool(), eventType)).toBe(5)
    const result = await meterPeriod(meterInput(world(), { meterVersionId }))
    expect(result.quantityUnits).toBe(5)
    const sources = await pool().query(
      `SELECT contribution_units::text AS qty FROM fin.metered_usage_sources
        WHERE metered_usage_id = $1`,
      [result.meteredUsageId],
    )
    expect(sources.rows.every((row) => row.qty === '1')).toBe(true)
  })

  it('LATEST aggregation', async () => {
    const { meterVersionId, eventType } = await seedIsolatedMeter(pool(), {
      label: 'latest',
      aggregationType: 'LATEST',
    })
    await ingestUsageEvent(usagePayload(world(), {
      eventType,
      quantityUnits: 1,
      occurredAt: '2026-08-10T00:00:00.000Z',
    }))
    await ingestUsageEvent(usagePayload(world(), {
      eventType,
      quantityUnits: 42,
      occurredAt: '2026-08-18T12:00:00.000Z',
    }))
    await ingestUsageEvent(usagePayload(world(), {
      eventType,
      quantityUnits: 7,
      occurredAt: '2026-08-12T00:00:00.000Z',
    }))
    expect(await countUsageByEventType(pool(), eventType)).toBe(3)
    const result = await meterPeriod(meterInput(world(), { meterVersionId }))
    expect(result.quantityUnits).toBe(42)
    const sources = await pool().query(
      `SELECT contribution_units::text AS qty FROM fin.metered_usage_sources
        WHERE metered_usage_id = $1 ORDER BY contribution_units DESC`,
      [result.meteredUsageId],
    )
    expect(sources.rows.map((row) => row.qty)).toEqual(['42', '0', '0'])
  })

  it('UNIQUE_COUNT — 3 events with 2 distinct subject_ids → qty=2', async () => {
    const { meterVersionId, eventType } = await seedIsolatedMeter(pool(), {
      label: 'unique',
      aggregationType: 'UNIQUE_COUNT',
    })
    await ingestUsageEvent(usagePayload(world(), { eventType, subjectId: 's-a' }))
    await ingestUsageEvent(usagePayload(world(), { eventType, subjectId: 's-a' }))
    await ingestUsageEvent(usagePayload(world(), { eventType, subjectId: 's-b' }))
    expect(await countUsageByEventType(pool(), eventType)).toBe(3)
    const result = await meterPeriod(meterInput(world(), { meterVersionId }))
    expect(result.quantityUnits).toBe(2)
    expect(result.sourceCount).toBe(3)
    const sum = await pool().query(
      `SELECT SUM(contribution_units)::text AS qty FROM fin.metered_usage_sources
        WHERE metered_usage_id = $1`,
      [result.meteredUsageId],
    )
    expect(sum.rows[0].qty).toBe('2')
  })

  it('determinism: second meterPeriod with no new events is deduped and writes no row', async () => {
    const { meterVersionId, eventType } = await seedIsolatedMeter(pool(), { label: 'dedupe' })
    await ingestUsageEvent(usagePayload(world(), { eventType }))
    expect(await countUsageByEventType(pool(), eventType)).toBe(1)
    const first = await meterPeriod(meterInput(world(), { meterVersionId }))
    const second = await meterPeriod(meterInput(world(), { meterVersionId }))
    expect(second).toMatchObject({
      ok: true,
      deduped: true,
      meteredUsageId: first.meteredUsageId,
      computationHash: first.computationHash,
    })
    const count = await pool().query(
      `SELECT count(*)::int AS n FROM fin.metered_usage WHERE meter_version_id = $1`,
      [meterVersionId],
    )
    expect(count.rows[0].n).toBe(1)
  })

  it('supersession: correction after first metering inserts a successor and flips SUPERSEDED', async () => {
    const { meterVersionId, eventType } = await seedIsolatedMeter(pool(), { label: 'super' })
    const original = await ingestUsageEvent(usagePayload(world(), { eventType, quantityUnits: 1_000_000 }))
    expect(await countUsageByEventType(pool(), eventType)).toBe(1)
    const first = await meterPeriod(meterInput(world(), { meterVersionId }))
    expect(first.quantityUnits).toBe(1_000_000)

    await ingestUsageEvent(usagePayload(world(), {
      eventType,
      eventKind: 'CORRECTION',
      correctsEventId: original.id,
      correctsResidencyKey: 'ksa',
      quantityUnits: 3_000_000,
      occurredAt: '2026-08-19T00:00:00.000Z',
    }))
    expect(await countUsageByEventType(pool(), eventType)).toBe(2)
    const second = await meterPeriod(meterInput(world(), { meterVersionId }))
    expect(second.ok).toBe(true)
    expect(second.deduped).toBeUndefined()
    expect(second.superseded).toBe(first.meteredUsageId)
    expect(second.quantityUnits).toBe(3_000_000)
    expect(second.computationHash).not.toBe(first.computationHash)

    const rows = await pool().query(
      `SELECT id, status, supersedes_id FROM fin.metered_usage
        WHERE meter_version_id = $1 ORDER BY metered_at`,
      [meterVersionId],
    )
    expect(rows.rowCount).toBe(2)
    const previous = rows.rows.find((row) => row.id === first.meteredUsageId)
    const next = rows.rows.find((row) => row.id === second.meteredUsageId)
    expect(previous.status).toBe('SUPERSEDED')
    expect(next.status).toBe('ACTIVE')
    expect(next.supersedes_id).toBe(first.meteredUsageId)
  })

  it('rejects a missing meter_version with FIN_METER_VERSION_NOT_FOUND', async () => {
    await expect(meterPeriod(meterInput(world(), { meterVersionId: randomUUID() })))
      .rejects.toBeInstanceOf(FinError)
    await expect(meterPeriod(meterInput(world(), { meterVersionId: randomUUID() })))
      .rejects.toMatchObject({ code: 'FIN_METER_VERSION_NOT_FOUND' })
  })
})
