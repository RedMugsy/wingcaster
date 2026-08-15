/**
 * Credit-notes ledger — commercial.billing_credit_notes.
 *
 * A dollar-denominated (minor-units) sibling of the quota ledger. Every
 * proration event on subscription migration writes a row here. Manual
 * courtesy credits, refunds, and promo redemptions also land here.
 *
 * amount_minor is SIGNED:
 *   positive → credit owed to the tenant
 *   negative → charge owed by the tenant
 *
 * Rows are append-only from the outside: mutations only via applyNote,
 * voidNote, expireNote (each of which is a status transition, not a
 * data rewrite).
 *
 * Phase 7e will consume pending notes at invoice time.
 */

import { randomUUID } from 'crypto'
import { findAll, findOne, insert, query } from '../../db.js'

const COLLECTION = 'billing_credit_notes'

const VALID_TYPES = new Set([
  'proration_credit',
  'proration_debit',
  'refund',
  'courtesy',
  'promo',
  'manual_adjustment',
])

const VALID_ACTOR_TYPES = new Set(['tenant', 'admin', 'system', 'api'])

/**
 * Issue a new credit note.
 *
 * @param {object} input
 * @param {string} input.tenantId
 * @param {string} [input.subscriptionId]
 * @param {string} input.type              one of VALID_TYPES
 * @param {number} input.amountMinor       signed integer
 * @param {string} input.currency          3-letter ISO
 * @param {string} [input.reason]
 * @param {string} [input.expiresAt]       ISO string; null → never expires
 * @param {string} [input.actorId]
 * @param {string} [input.actorType]
 * @param {object} [input.metadata]
 */
export async function issueNote(input) {
  if (!input?.tenantId) throw Object.assign(new Error('tenantId is required'), { code: 'MISSING_FIELD' })
  if (!VALID_TYPES.has(input.type)) {
    throw Object.assign(new Error(`type must be one of: ${[...VALID_TYPES].join(', ')}`), { code: 'INVALID_TYPE' })
  }
  const amountMinor = Number(input.amountMinor)
  if (!Number.isFinite(amountMinor) || amountMinor === 0) {
    throw Object.assign(new Error('amountMinor must be a non-zero integer'), { code: 'INVALID_AMOUNT' })
  }
  const currency = String(input.currency || '').toUpperCase()
  if (!/^[A-Z]{3}$/.test(currency)) {
    throw Object.assign(new Error('currency must be a 3-letter uppercase code'), { code: 'INVALID_CURRENCY' })
  }
  if (input.actorType && !VALID_ACTOR_TYPES.has(input.actorType)) {
    throw Object.assign(new Error(`actorType must be one of: ${[...VALID_ACTOR_TYPES].join(', ')}`), { code: 'INVALID_ACTOR_TYPE' })
  }

  const row = {
    id: randomUUID(),
    tenant_id: input.tenantId,
    subscription_id: input.subscriptionId || null,
    type: input.type,
    amount_minor: Math.round(amountMinor),
    currency,
    status: 'pending',
    applied_at: null,
    applied_to_invoice_id: null,
    expires_at: input.expiresAt || null,
    reason: input.reason ? String(input.reason).slice(0, 2000) : null,
    actor_id: input.actorId || null,
    actor_type: input.actorType || null,
    metadata: input.metadata && typeof input.metadata === 'object' ? input.metadata : {},
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  }
  await insert(COLLECTION, row)
  return row
}

export async function listNotes({ tenantId, subscriptionId, status, limit = 100 } = {}) {
  const rows = await findAll(COLLECTION, (n) => {
    if (tenantId && n.tenant_id !== tenantId) return false
    if (subscriptionId && n.subscription_id !== subscriptionId) return false
    if (status && n.status !== status) return false
    return true
  })
  return rows
    .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())
    .slice(0, limit)
}

export async function getNote(id) {
  return findOne(COLLECTION, (n) => n.id === id)
}

/**
 * Sum of pending credit-note amounts for a tenant, grouped by currency.
 * Positive total = platform owes tenant; negative total = tenant owes
 * platform. Callers pick the currency that matches the tenant's
 * territory.
 */
export async function pendingBalance(tenantId) {
  const rows = await query(
    `SELECT currency, COALESCE(SUM(amount_minor), 0)::int AS balance
       FROM commercial.billing_credit_notes
      WHERE tenant_id = $1 AND status = 'pending'
      GROUP BY currency`,
    [tenantId],
  )
  const byCurrency = {}
  for (const row of rows) byCurrency[row.currency] = Number(row.balance)
  return byCurrency
}

export async function voidNote(id, { reason = null, actorId = null, actorType = 'admin' } = {}) {
  const note = await getNote(id)
  if (!note) throw Object.assign(new Error('Credit note not found'), { code: 'NOT_FOUND' })
  if (note.status !== 'pending') {
    throw Object.assign(new Error(`Only pending credit notes may be voided (current: ${note.status})`), { code: 'INVALID_TRANSITION' })
  }
  const nextMeta = { ...(note.metadata || {}), voided_reason: reason, voided_by: actorId, voided_actor_type: actorType }
  await query(
    `UPDATE commercial.billing_credit_notes
        SET status = 'voided', updated_at = CURRENT_TIMESTAMP, metadata = $2::jsonb
      WHERE id = $1`,
    [id, JSON.stringify(nextMeta)],
  )
  return await getNote(id)
}

/**
 * Mark a note as applied against an invoice. Phase 7e's invoice-generation
 * job is the primary caller; also usable by admin correction flow.
 */
export async function applyNote(id, { invoiceId, actorId = null, actorType = 'system' } = {}) {
  const note = await getNote(id)
  if (!note) throw Object.assign(new Error('Credit note not found'), { code: 'NOT_FOUND' })
  if (note.status !== 'pending') {
    throw Object.assign(new Error(`Only pending credit notes may be applied (current: ${note.status})`), { code: 'INVALID_TRANSITION' })
  }
  const nextMeta = { ...(note.metadata || {}), applied_by: actorId, applied_actor_type: actorType }
  await query(
    `UPDATE commercial.billing_credit_notes
        SET status = 'applied',
            applied_at = CURRENT_TIMESTAMP,
            applied_to_invoice_id = $2,
            updated_at = CURRENT_TIMESTAMP,
            metadata = $3::jsonb
      WHERE id = $1`,
    [id, invoiceId || null, JSON.stringify(nextMeta)],
  )
  return await getNote(id)
}

/**
 * Bulk-expire notes past their expires_at. Called by the renewal scanner
 * (safe to call frequently — it's a targeted UPDATE with a WHERE guard).
 */
export async function sweepExpiredNotes({ now = new Date() } = {}) {
  const result = await query(
    `UPDATE commercial.billing_credit_notes
        SET status = 'expired', updated_at = CURRENT_TIMESTAMP
      WHERE status = 'pending'
        AND expires_at IS NOT NULL
        AND expires_at <= $1::timestamptz
      RETURNING id`,
    [new Date(now).toISOString()],
  )
  return { expired: result.length }
}
