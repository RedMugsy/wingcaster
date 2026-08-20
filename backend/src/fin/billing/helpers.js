/**
 * Shared claim / retry / lock helpers for Stage 10 billing commands.
 * No HTTP / PSP / email / PDF / ZATCA inside transaction(fn) (I-14).
 */
import { transaction } from '../../db.js'
import { BusinessClock } from '../clock.js'
import { CATEGORY, finError } from '../errors.js'
import { FIN_BILLING_PERIOD_CLOSE } from '../foundation/advisory-locks.js'
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

export async function lockBillingPeriod(client, periodId) {
  await client.query(
    'SELECT pg_advisory_xact_lock($1, hashtext($2::text))',
    [FIN_BILLING_PERIOD_CLOSE, periodId],
  )
}

export function mapBillingPgError(error) {
  const message = String(error?.message || '')
  const codes = [
    'BILLING_PERIOD_SKIP',
    'BILLING_PERIOD_FINAL',
    'BILLING_PERIOD_REOPEN_AFTER_ISSUE',
    'INVOICE_NOT_DRAFT',
    'INVOICE_MUTATE_AFTER_ISSUE',
    'INVOICE_SEQUENCE_REUSE',
    'INVOICE_VOID_WITH_CASH',
    'INVOICE_ZATCA_FIELDS_MISSING',
    'NOTE_PARENT_NOT_ISSUED',
    'NOTE_EXCEEDS_INVOICE',
    'NOTE_VOID_FORBIDDEN',
    'NOTE_SEQUENCE_REUSE',
    'DUNNING_INVOICE_NOT_ELIGIBLE',
  ]
  for (const code of codes) {
    if (message.includes(code)) {
      return finError(code, { category: CATEGORY.PRECONDITION, httpStatus: 409 })
    }
  }
  return error
}

export async function loadLegalEntity(client, legalEntityId) {
  const { rows } = await client.query(
    `SELECT * FROM fin.platform_legal_entities WHERE id = $1`,
    [legalEntityId],
  )
  return rows[0] || null
}

export async function assignSequence(client, {
  environment, legalEntityId, jurisdiction, docType, fiscalContext, now,
}) {
  const { rows } = await client.query(
    `SELECT id, prefix, next_n
       FROM fin.invoice_sequences
      WHERE environment = $1
        AND legal_entity_id = $2
        AND jurisdiction = $3
        AND doc_type = $4
        AND fiscal_context = $5
      FOR UPDATE`,
    [environment, legalEntityId, jurisdiction, docType, fiscalContext],
  )
  if (!rows[0]) {
    throw finError('INVOICE_SEQUENCE_REUSE', {
      category: CATEGORY.PRECONDITION,
      details: { reason: 'sequence_not_found', docType, fiscalContext, jurisdiction },
    })
  }
  const updated = await client.query(
    `UPDATE fin.invoice_sequences
        SET next_n = next_n + 1, updated_at = $2
      WHERE id = $1
      RETURNING id, prefix, (next_n - 1) AS assigned`,
    [rows[0].id, now],
  )
  const row = updated.rows[0]
  return {
    sequenceId: row.id,
    assigned: Number(row.assigned),
    number: `${row.prefix}${row.assigned}`,
  }
}

export async function requireApproval(client, {
  approvalId, actionKind, actorType, missingCode = 'APPROVAL_NOT_APPROVED',
}) {
  if (actorType !== 'USER' && !approvalId) return null
  if (!approvalId) {
    throw finError(missingCode, { category: CATEGORY.APPROVAL })
  }
  const { rows } = await client.query(
    `SELECT * FROM fin.approval_requests WHERE id = $1`,
    [approvalId],
  )
  const approval = rows[0]
  if (
    !approval
    || approval.action_kind !== actionKind
    || !['APPROVED', 'EXECUTED'].includes(approval.status)
  ) {
    throw finError(missingCode, { category: CATEGORY.APPROVAL })
  }
  return approval
}

export const ISSUED_LIKE = ['ISSUED', 'PART_PAID', 'PAID', 'UNCOLLECTIBLE']
export const OPEN_INVOICE = ['ISSUED', 'PART_PAID']
