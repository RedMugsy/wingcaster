/**
 * Shared claim / retry / facility xact lock for Stage 8 commands.
 * No HTTP / PSP / email inside transaction(fn) (I-14).
 */
import { randomUUID } from 'node:crypto'
import { transaction } from '../../db.js'
import { BusinessClock } from '../clock.js'
import { CATEGORY, finError } from '../errors.js'
import { FIN_CREDIT_FACILITY } from '../foundation/advisory-locks.js'
import { requestFingerprint } from '../idempotency/fingerprint.js'
import { claimIdempotency, completeIdempotency } from '../idempotency/claim.js'

export function iso(value) {
  if (!value) return BusinessClock.now()
  if (value instanceof Date) return value.toISOString()
  return String(value)
}

export function envelope(input) {
  return {
    now: iso(input.now || BusinessClock.now()),
    environment: input.environment || 'LIVE',
    actorType: input.actorType || 'SYSTEM',
    actorId: input.actorId || null,
    actorEmail: input.actorEmail || 'system@fin.local',
    reasonCode: input.reasonCode,
    tenantId: input.tenantId || null,
    idempotencyKey: input.idempotencyKey,
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
  if (!key) {
    throw finError('IDEMPOTENCY_KEY_REQUIRED', { category: CATEGORY.VALIDATION })
  }
  try {
    return await claimIdempotency(client, {
      environment: env.environment,
      tenantId: env.tenantId,
      key,
      fingerprint: requestFingerprint(fingerprintPayload),
      now: env.now,
      actorType: env.actorType,
      actorId: env.actorId,
    })
  } catch (error) {
    if (error.code === '23505') {
      throw finError('IDEMPOTENCY_KEY_IN_FLIGHT', {
        category: CATEGORY.IDEMPOTENCY,
        httpStatus: 409,
        retryable: true,
        retryAfter: 2,
      })
    }
    throw error
  }
}

export async function finish(client, claimResult, env, body) {
  await completeIdempotency(client, {
    id: claimResult.row.id,
    now: env.now,
    body,
  })
  return body
}

export async function lockFacility(client, facilityId) {
  await client.query(
    'SELECT pg_advisory_xact_lock($1, hashtext($2::text))',
    [FIN_CREDIT_FACILITY, facilityId],
  )
}

export function asMinor(value) {
  if (value == null || value === '') return 0n
  return BigInt(value)
}

export { randomUUID }
