import { randomUUID } from 'node:crypto'
import { NOW, insertUser, insertPublicTenant } from '../../testing/seed.js'
import { ingestUsageEvent } from '../../usage/ingest.js'

export const HISTORICAL = '2026-08-10T00:00:00.000Z'

export async function allowlistDual(pool, publicTenantId, now = NOW) {
  await pool.query(
    `INSERT INTO fin.cutover_tenant_allowlist (
       environment, tenant_id, mode, reason_code,
       added_by_actor_type, added_by_actor_id, created_at, updated_at
     ) VALUES ('LIVE', $1, 'DUAL', 'TEST_ALLOWLIST', 'SYSTEM', null, $2, $2)
     ON CONFLICT (environment, tenant_id) DO UPDATE
       SET mode = 'DUAL', updated_at = EXCLUDED.updated_at`,
    [publicTenantId, now],
  )
}

export async function insertCutoffMarker(world, now = NOW) {
  return ingestUsageEvent({
    environment: 'LIVE',
    tenantId: world.tenantA.tenantId,
    holderId: world.tenantA.holderId,
    billingAccountId: world.tenantA.billingAccountId,
    sourceSystem: 'commercial.usage_events',
    sourceEventId: `cutoff-${randomUUID()}`,
    eventType: 'cutover.cutoff_marker',
    quantityUnits: 1,
    occurredAt: now,
    receivedAt: now,
    now,
  })
}

export async function insertCommercialUsage(pool, {
  tenantId,
  actionKey = 'webhook.received',
  quantity = 1,
  occurredAt = HISTORICAL,
  createdAt = HISTORICAL,
  id = null,
} = {}) {
  const eventId = id || randomUUID()
  await pool.query(
    `INSERT INTO commercial.usage_events (
       id, tenant_id, action_key, quantity, territory_id, metadata,
       occurred_at, created_at, updated_at
     ) VALUES (
       $1,$2,$3,$4,'__platform__','{}'::jsonb,
       $5::timestamptz,$6::timestamptz,$6::timestamptz
     )`,
    [eventId, tenantId, actionKey, quantity, occurredAt, createdAt],
  )
  return eventId
}

export async function insertLedgerEntry(pool, {
  tenantId,
  type,
  quotaKey = 'outbound_whatsapp',
  amount,
  billingPeriod = '2026-08',
  createdAt = HISTORICAL,
  id = null,
  sourceEventId = null,
} = {}) {
  const entryId = id || randomUUID()
  await pool.query(
    `INSERT INTO commercial.ledger_entries (
       id, tenant_id, billing_period, type, quota_key, amount,
       source_event_id, metadata, created_at, updated_at
     ) VALUES (
       $1,$2,$3,$4,$5,$6,$7,'{}'::jsonb,$8::timestamptz,$8::timestamptz
     )`,
    [entryId, tenantId, billingPeriod, type, quotaKey, amount, sourceEventId, createdAt],
  )
  return entryId
}

export async function insertUnmappedPublicTenant(pool, suffix = 'ghost') {
  const userId = `u-${suffix}-${randomUUID().slice(0, 8)}`
  const publicTenantId = `pt-${suffix}-${randomUUID().slice(0, 8)}`
  await insertUser(pool, {
    id: userId,
    email: `${suffix}@example.test`,
    name: `Ghost ${suffix}`,
  })
  await insertPublicTenant(pool, {
    id: publicTenantId,
    ownerUserId: userId,
    name: `Ghost ${suffix}`,
  })
  return { userId, publicTenantId }
}
