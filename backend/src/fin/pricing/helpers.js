/**
 * Shared claim / retry / OCC helpers for pricing + contract commands.
 * No ledger_transactions writes live here (C §6).
 */
import { randomUUID } from 'node:crypto'
import { transaction } from '../../db.js'
import { CATEGORY, finError } from '../errors.js'
import { requestFingerprint } from '../idempotency/fingerprint.js'
import { claimIdempotency, completeIdempotency } from '../idempotency/claim.js'

export function iso(value) {
  if (!value) return new Date().toISOString()
  if (value instanceof Date) return value.toISOString()
  return String(value)
}

export function envelope(input) {
  return {
    now: iso(input.now),
    environment: input.environment || 'LIVE',
    actorType: input.actorType || 'SYSTEM',
    actorId: input.actorId || null,
    actorEmail: input.actorEmail || 'system@fin.local',
    reasonCode: input.reasonCode,
    tenantId: input.tenantId || null,
    idempotencyKey: input.idempotencyKey,
    expectedVersion: input.expectedVersion,
  }
}

export function requireReason(reasonCode) {
  if (!reasonCode) {
    throw finError('REASON_CODE_REQUIRED', { category: CATEGORY.VALIDATION })
  }
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

export async function withRetry(work) {
  let last
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    try {
      return await transaction(work)
    } catch (error) {
      last = error
      if (error.code === '40P01' && attempt < 3) {
        await sleep(20 + Math.random() * 60)
        continue
      }
      throw error
    }
  }
  throw last
}

export async function claim(client, env, key, fingerprintPayload) {
  requireReason(env.reasonCode)
  return claimIdempotency(client, {
    environment: env.environment,
    tenantId: env.tenantId,
    key,
    fingerprint: requestFingerprint(fingerprintPayload),
    now: env.now,
    actorType: env.actorType,
    actorId: env.actorId,
  })
}

export async function finish(client, claimResult, env, body) {
  await completeIdempotency(client, {
    id: claimResult.row.id,
    now: env.now,
    body,
  })
  return body
}

export function mapExclusion(error, code) {
  if (error?.code === '23P01' || error?.code === '23505') {
    throw finError(code, { category: CATEGORY.CONFLICT, httpStatus: 409 })
  }
  throw error
}

export async function lockHeader(client, table, id) {
  const { rows } = await client.query(
    `SELECT * FROM fin.${table} WHERE id = $1 FOR UPDATE`,
    [id],
  )
  return rows[0] || null
}

export function assertIfMatch(header, expectedVersion) {
  if (expectedVersion == null) return
  if (Number(header.version) !== Number(expectedVersion)) {
    const error = finError('PRECONDITION_FAILED', {
      category: CATEGORY.CONFLICT,
      httpStatus: 412,
      retryable: true,
      details: header,
    })
    throw error
  }
}

export async function bumpHeader(client, {
  table, id, expectedVersion, now, actorType, actorId,
}) {
  const result = await client.query(
    `UPDATE fin.${table}
        SET updated_at = $2,
            updated_by_actor_type = $3,
            updated_by_actor_id = $4
      WHERE id = $1 AND version = $5
      RETURNING *`,
    [id, now, actorType, actorId, expectedVersion],
  )
  if (result.rowCount === 0) {
    const current = await client.query(
      `SELECT * FROM fin.${table} WHERE id = $1`,
      [id],
    )
    throw finError('PRECONDITION_FAILED', {
      category: CATEGORY.CONFLICT,
      httpStatus: 412,
      retryable: true,
      details: current.rows[0],
    })
  }
  return result.rows[0]
}

export async function requireBackdatedApproval(client, {
  approvalRequestId, now, effectiveFrom,
}) {
  if (new Date(effectiveFrom) >= new Date(now)) return null
  if (!approvalRequestId) {
    throw finError('BACKDATED_AMENDMENT_REQUIRED', {
      category: CATEGORY.APPROVAL,
      httpStatus: 409,
    })
  }
  const approval = (await client.query(
    `SELECT * FROM fin.approval_requests WHERE id = $1 FOR UPDATE`,
    [approvalRequestId],
  )).rows[0]
  if (
    !approval
    || approval.action_kind !== 'BACKDATED_AMENDMENT'
    || !['APPROVED', 'EXECUTED'].includes(approval.status)
  ) {
    throw finError('BACKDATED_AMENDMENT_REQUIRED', {
      category: CATEGORY.APPROVAL,
      httpStatus: 409,
    })
  }
  if (approval.status === 'APPROVED') {
    await client.query(
      `UPDATE fin.approval_requests
          SET status = 'EXECUTED', updated_at = $2
        WHERE id = $1 AND version = $3`,
      [approvalRequestId, now, approval.version],
    )
  }
  return approval
}

export function nextKey(prefix) {
  return `${prefix}:${randomUUID()}`
}
