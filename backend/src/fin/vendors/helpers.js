/**
 * Shared claim / retry / OCC helpers for vendor commands.
 * No ledger_transactions writes (C §6). No HTTP in tx (I-14).
 */
import { randomUUID } from 'node:crypto'
import { transaction } from '../../db.js'
import { BusinessClock } from '../clock.js'
import { CATEGORY, finError } from '../errors.js'
import { FIN_VENDOR_STATEMENT_RECON } from '../foundation/advisory-locks.js'
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

export function mapVendorPgError(error) {
  const message = String(error?.message || '')
  const codes = [
    'VENDOR_STATEMENT_NOT_DRAFT',
    'VENDOR_STATEMENT_ALREADY_FINAL',
    'VENDOR_STATEMENT_MUTATE_AFTER_FINALIZE',
    'VENDOR_STATEMENT_NOT_FOUND',
  ]
  for (const code of codes) {
    if (message.includes(code)) {
      return finError(code, { category: CATEGORY.PRECONDITION, httpStatus: 409 })
    }
  }
  if (/illegal vendor_rate_version status transition/i.test(message)
    || /append-only except status/i.test(message)) {
    return finError('VENDOR_RATE_VERSION_ILLEGAL_TRANSITION', {
      category: CATEGORY.PRECONDITION,
      httpStatus: 409,
    })
  }
  if (/illegal transition/i.test(message)) {
    return finError('VENDOR_STATEMENT_ILLEGAL_TRANSITION', {
      category: CATEGORY.PRECONDITION,
      httpStatus: 409,
    })
  }
  return error
}

const HEADER_TABLES = {
  vendors: 'vendors',
  vendor_rate_cards: 'vendor_rate_cards',
  vendor_reported_usage: 'vendor_reported_usage',
  vendor_statements: 'vendor_statements',
  vendor_products: 'vendor_products',
  meter_vendor_map: 'meter_vendor_map',
}

export async function lockHeader(client, table, id) {
  const ident = HEADER_TABLES[table]
  if (!ident) throw new Error(`lockHeader: unknown table ${table}`)
  const { rows } = await client.query(
    `SELECT * FROM fin.${ident} WHERE id = $1 FOR UPDATE`,
    [id],
  )
  return rows[0] || null
}

export async function lockVendor(client, vendorId) {
  const header = await lockHeader(client, 'vendors', vendorId)
  await client.query(
    'SELECT pg_advisory_xact_lock(hashtext($1))',
    [`vendor:${vendorId}`],
  )
  return header
}

export async function lockVendorStatementRecon(client, statementId) {
  await client.query(
    'SELECT pg_advisory_xact_lock($1, hashtext($2::text))',
    [FIN_VENDOR_STATEMENT_RECON, statementId],
  )
}

export function assertIfMatch(header, expectedVersion) {
  if (expectedVersion == null) return
  if (Number(header.version) !== Number(expectedVersion)) {
    throw finError('PRECONDITION_FAILED', {
      category: CATEGORY.CONFLICT,
      httpStatus: 412,
      retryable: true,
      details: header,
    })
  }
}

export async function bumpHeader(client, {
  table, id, expectedVersion, now, actorType, actorId,
}) {
  const ident = HEADER_TABLES[table]
  if (!ident) throw new Error(`bumpHeader: unknown table ${table}`)
  const result = await client.query(
    `UPDATE fin.${ident}
        SET updated_at = $2,
            updated_by_actor_type = $3,
            updated_by_actor_id = $4
      WHERE id = $1 AND version = $5
      RETURNING *`,
    [id, now, actorType, actorId, expectedVersion],
  )
  if (result.rowCount === 0) {
    const current = await client.query(
      `SELECT * FROM fin.${ident} WHERE id = $1`,
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

export function nextKey(prefix) {
  return `${prefix}:${randomUUID()}`
}

export function asMinor(value) {
  if (value == null || value === '') return 0n
  return BigInt(value)
}

export function periodKeyFrom(occurredAt) {
  const isoStamp = iso(occurredAt)
  return isoStamp.slice(0, 7)
}
