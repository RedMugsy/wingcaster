import { randomUUID } from 'node:crypto'
import { CATEGORY, finError } from '../errors.js'

const DEFAULT_TTL_MS = 24 * 60 * 60 * 1000

export async function claimIdempotency(client, {
  environment,
  tenantId = null,
  key,
  fingerprint,
  now,
  actorType,
  actorId,
  expiresAt,
}) {
  const clock = new Date(now)
  const exp = expiresAt || new Date(clock.getTime() + DEFAULT_TTL_MS).toISOString()

  const existing = await client.query(
    `SELECT * FROM fin.idempotency_keys
      WHERE environment = $1
        AND key = $2
        AND (
          ($3::uuid IS NULL AND tenant_id IS NULL)
          OR tenant_id = $3
        )
      FOR UPDATE`,
    [environment, key, tenantId],
  )

  if (existing.rowCount) {
    const row = existing.rows[0]
    const expired = row.status === 'EXPIRED' || new Date(row.expires_at) <= clock
    if (expired) {
      throw finError('IDEMPOTENCY_KEY_EXPIRED', {
        category: CATEGORY.IDEMPOTENCY,
        httpStatus: 409,
      })
    }
    if (row.request_fingerprint !== fingerprint) {
      throw finError('IDEMPOTENCY_FINGERPRINT_CONFLICT', {
        category: CATEGORY.IDEMPOTENCY,
        httpStatus: 409,
      })
    }
    if (row.status === 'COMPLETED') {
      return { kind: 'replay', row }
    }
    if (row.status === 'IN_FLIGHT') {
      throw finError('IDEMPOTENCY_KEY_IN_FLIGHT', {
        category: CATEGORY.IDEMPOTENCY,
        httpStatus: 409,
        retryable: true,
        retryAfter: 2,
      })
    }
    if (row.status === 'FAILED') {
      await client.query(
        `UPDATE fin.idempotency_keys
            SET status = 'IN_FLIGHT', updated_at = $2
          WHERE id = $1 AND version = $3`,
        [row.id, now, row.version],
      )
      return { kind: 'claimed', row: { ...row, status: 'IN_FLIGHT' } }
    }
  }

  const id = randomUUID()
  await client.query(
    `INSERT INTO fin.idempotency_keys (
       id, environment, tenant_id, key, request_fingerprint, status,
       expires_at, created_at, created_by_actor_type, created_by_actor_id,
       updated_at
     ) VALUES ($1, $2, $3, $4, $5, 'IN_FLIGHT', $6, $7, $8, $9, $7)`,
    [id, environment, tenantId, key, fingerprint, exp, now, actorType, actorId],
  )
  return { kind: 'claimed', row: { id, status: 'IN_FLIGHT' } }
}

export async function completeIdempotency(client, { id, now, status = 200, body }) {
  await client.query(
    `UPDATE fin.idempotency_keys
        SET status = 'COMPLETED',
            response_status = $2,
            response_body = $3::jsonb,
            updated_at = $4
      WHERE id = $1 AND status = 'IN_FLIGHT'`,
    [id, status, JSON.stringify(body), now],
  )
}
