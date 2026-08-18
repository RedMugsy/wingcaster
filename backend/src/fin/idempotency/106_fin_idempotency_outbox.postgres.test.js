import { randomUUID } from 'node:crypto'
import { expect, it } from 'vitest'
import { NOW } from '../testing/seed.js'
import { finPostgresSuite } from '../testing/suite.js'

finPostgresSuite('106_fin_idempotency_outbox', {}, ({ pool, world }) => {
  it('enforces UNIQUE (environment, tenant_id, key)', async () => {
    const { tenantA } = world()
    const row = {
      environment: 'LIVE',
      tenantId: tenantA.tenantId,
      key: 'purchase:1',
      fingerprint: 'abc',
    }
    await pool().query(
      `INSERT INTO fin.idempotency_keys (
         id, environment, tenant_id, key, request_fingerprint, status,
         expires_at, created_at, updated_at
       ) VALUES ($1, $2, $3, $4, $5, 'IN_FLIGHT', $6, $6, $6)`,
      [randomUUID(), row.environment, row.tenantId, row.key, row.fingerprint, NOW],
    )
    await expect(pool().query(
      `INSERT INTO fin.idempotency_keys (
         id, environment, tenant_id, key, request_fingerprint, status,
         expires_at, created_at, updated_at
       ) VALUES ($1, $2, $3, $4, $5, 'IN_FLIGHT', $6, $6, $6)`,
      [randomUUID(), row.environment, row.tenantId, row.key, 'other', NOW],
    )).rejects.toMatchObject({ code: '23505' })
  })

  it('outbox dedupe_key is unique per topic when present', async () => {
    await pool().query(
      `INSERT INTO fin.outbox_events (
         id, environment, topic, dedupe_key, payload, status, attempts,
         created_at, updated_at
       ) VALUES ($1, 'LIVE', 'fin.lot.issued', 'lot-1', '{}'::jsonb, 'PENDING', 0, $2, $2)`,
      [randomUUID(), NOW],
    )
    await expect(pool().query(
      `INSERT INTO fin.outbox_events (
         id, environment, topic, dedupe_key, payload, status, attempts,
         created_at, updated_at
       ) VALUES ($1, 'LIVE', 'fin.lot.issued', 'lot-1', '{}'::jsonb, 'PENDING', 0, $2, $2)`,
      [randomUUID(), NOW],
    )).rejects.toMatchObject({ code: '23505' })
  })
})
