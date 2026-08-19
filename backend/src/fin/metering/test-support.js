import { randomUUID } from 'node:crypto'
import { NOW } from '../testing/seed.js'

export const PERIOD_KEY = '2026-08'
export const WINDOW_START = '2026-08-01T00:00:00.000Z'
export const WINDOW_END = '2026-09-01T00:00:00.000Z'

export async function seedMeter(client, {
  environment = 'LIVE',
  code,
  name = code,
  aggregationType = 'SUM',
  filterDefinition = {},
  effectiveFrom = '2026-01-01T00:00:00.000Z',
  now = NOW,
} = {}) {
  const meterId = randomUUID()
  const meterVersionId = randomUUID()
  await client.query(
    `INSERT INTO fin.meters (id, environment, code, name, created_at, updated_at)
     VALUES ($1, $2, $3, $4, $5, $5)`,
    [meterId, environment, code, name, now],
  )
  await client.query(
    `INSERT INTO fin.meter_versions (
       id, meter_id, environment, version_n, aggregation_type, filter_definition,
       effective_from
     ) VALUES ($1, $2, $3, 1, $4, $5::jsonb, $6)`,
    [meterVersionId, meterId, environment, aggregationType, JSON.stringify(filterDefinition), effectiveFrom],
  )
  return { meterId, meterVersionId }
}

export function meterInput(world, { meterVersionId, extra = {} } = {}) {
  return {
    environment: 'LIVE',
    meterVersionId,
    holderId: world.tenantA.holderId,
    periodKey: PERIOD_KEY,
    windowStart: WINDOW_START,
    windowEnd: WINDOW_END,
    now: NOW,
    actorType: 'WORKER',
    actorEmail: 'metering@fin.local',
    ...extra,
  }
}

export function usagePayload(world, extra = {}) {
  return {
    environment: 'LIVE',
    tenantId: world.tenantA.tenantId,
    holderId: world.tenantA.holderId,
    sourceSystem: 'orchestrator',
    sourceEventId: randomUUID(),
    eventType: 'message.out.whatsapp.utility',
    quantityUnits: 1_000_000,
    occurredAt: NOW,
    receivedAt: NOW,
    dimensions: { channel: 'whatsapp', destination_country: 'SA' },
    ...extra,
  }
}
