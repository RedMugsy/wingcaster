import { randomUUID } from 'node:crypto'
import { expect, it } from 'vitest'
import { NOW } from '../testing/seed.js'
import { finPostgresSuite } from '../testing/suite.js'
import { ingestUsageEvent } from './ingest.js'

finPostgresSuite('usage composite FK (M1 / DL-021)', {}, ({ pool, world }) => {
  it('metered_usage_sources rejects a residency_key that does not match the parent event', async () => {
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
    expect(ingested.ok).toBe(true)

    const meterId = randomUUID()
    const versionId = randomUUID()
    const meteredId = randomUUID()
    await pool().query(
      `INSERT INTO fin.meters (id, environment, code, name, created_at, updated_at)
       VALUES ($1, 'LIVE', 'test.meter', 'Test meter', $2, $2)`,
      [meterId, NOW],
    )
    await pool().query(
      `INSERT INTO fin.meter_versions (
         id, meter_id, environment, version_n, aggregation_type, filter_definition,
         effective_from
       ) VALUES ($1, $2, 'LIVE', 1, 'SUM', '{}'::jsonb, $3)`,
      [versionId, meterId, NOW],
    )
    await pool().query(
      `INSERT INTO fin.metered_usage (
         id, environment, tenant_id, meter_version_id, holder_id, period_key,
         quantity_units, computation_hash, status, metered_at
       ) VALUES ($1, 'LIVE', $2, $3, $4, '2026-08', 1, 'hash', 'ACTIVE', $5)`,
      [meteredId, world().tenantA.tenantId, versionId, world().tenantA.holderId, NOW],
    )

    await expect(pool().query(
      `INSERT INTO fin.metered_usage_sources (
         metered_usage_id, usage_event_id, residency_key, contribution_units
       ) VALUES ($1, $2, '__platform__', 1)`,
      [meteredId, ingested.id],
    )).rejects.toMatchObject({ code: '23503' })
  })

  it('usage_events correction rejects a corrects pair that does not match the parent', async () => {
    const original = await ingestUsageEvent({
      environment: 'LIVE',
      tenantId: world().tenantA.tenantId,
      sourceSystem: 'orchestrator',
      sourceEventId: randomUUID(),
      eventType: 'message.out.whatsapp.utility',
      quantityUnits: 1,
      occurredAt: NOW,
      receivedAt: NOW,
    })
    expect(original.ok).toBe(true)

    await expect(pool().query(
      `INSERT INTO fin.usage_events (
         id, environment, residency_key, tenant_id, source_system, source_event_id,
         event_type, event_kind, corrects_event_id, corrects_residency_key,
         quantity_units, dimensions, occurred_at, received_at, ingestion_version, created_at
       ) VALUES (
         $1, 'LIVE', 'ksa', $2, 'orchestrator', $3,
         'message.out.whatsapp.utility', 'CORRECTION', $4, '__platform__',
         1, '{}'::jsonb, $5, $5, 1, $5
       )`,
      [randomUUID(), world().tenantA.tenantId, randomUUID(), original.id, NOW],
    )).rejects.toMatchObject({ code: '23503' })

    await expect(pool().query(
      `INSERT INTO fin.usage_events (
         id, environment, residency_key, tenant_id, source_system, source_event_id,
         event_type, event_kind, corrects_event_id, corrects_residency_key,
         quantity_units, dimensions, occurred_at, received_at, ingestion_version, created_at
       ) VALUES (
         $1, 'LIVE', 'ksa', $2, 'orchestrator', $3,
         'message.out.whatsapp.utility', 'CORRECTION', $4, 'ksa',
         1, '{}'::jsonb, $5, $5, 1, $5
       )`,
      [randomUUID(), world().tenantA.tenantId, randomUUID(), randomUUID(), NOW],
    )).rejects.toMatchObject({ code: '23503' })
  })
})
