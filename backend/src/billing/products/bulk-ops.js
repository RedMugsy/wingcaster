/**
 * Bulk admin operations on subscriptions.
 *
 * Each function takes an array of subscription IDs + an operation-
 * specific payload and applies the operation to each ID, returning
 * per-ID { id, ok, error? } so the admin UI can render a per-row
 * result grid.
 *
 * Operations are NOT atomic across IDs — a failure on one subscription
 * does not roll back others. The audit trail (subscription_history)
 * captures every successful mutation as it lands.
 *
 * Concurrency: processes IDs sequentially. A parallel batch would
 * complete faster but would fan out N advisory-lock-guarded scheduler
 * queries and N notification dispatches — the sequential shape keeps
 * observability clean and avoids surprising the ops team when they
 * check the log.
 */

import {
  cancelSubscription,
  expireSubscription,
  migrateSubscription,
  pauseSubscription,
  resumeSubscription,
} from './lifecycle.js'
import { issueNote } from './credit-notes.js'

const MAX_BULK = 500

function guardIds(ids) {
  if (!Array.isArray(ids)) throw Object.assign(new Error('subscription_ids must be an array'), { code: 'INVALID_INPUT' })
  if (ids.length === 0) throw Object.assign(new Error('subscription_ids must not be empty'), { code: 'INVALID_INPUT' })
  if (ids.length > MAX_BULK) throw Object.assign(new Error(`bulk operations capped at ${MAX_BULK} ids`), { code: 'BULK_LIMIT' })
}

export async function bulkCancel({ subscriptionIds, reason = null, immediate = false, actorId = null }) {
  guardIds(subscriptionIds)
  const results = []
  for (const id of subscriptionIds) {
    try {
      const sub = await cancelSubscription(id, {
        reason,
        atPeriodEnd: !immediate,
        actorId,
        actorType: 'admin',
      })
      results.push({ id, ok: true, status: sub.status })
    } catch (err) {
      results.push({ id, ok: false, error: err?.message || String(err), code: err?.code || null })
    }
  }
  return { total: subscriptionIds.length, results }
}

export async function bulkExpire({ subscriptionIds, reason = null, actorId = null }) {
  guardIds(subscriptionIds)
  const results = []
  for (const id of subscriptionIds) {
    try {
      const sub = await expireSubscription(id, { reason, actorId, actorType: 'admin' })
      results.push({ id, ok: true, status: sub.status })
    } catch (err) {
      results.push({ id, ok: false, error: err?.message || String(err), code: err?.code || null })
    }
  }
  return { total: subscriptionIds.length, results }
}

export async function bulkMigrate({ subscriptionIds, targetTierId, targetProductId = null, prorate = true, reason = null, actorId = null }) {
  guardIds(subscriptionIds)
  if (!targetTierId) throw Object.assign(new Error('targetTierId is required'), { code: 'MISSING_FIELD' })
  const results = []
  for (const id of subscriptionIds) {
    try {
      const sub = await migrateSubscription(id, {
        targetTierId,
        targetProductId,
        prorate,
        reason,
        actorId,
        actorType: 'admin',
      })
      results.push({ id, ok: true, tier_id: sub.tier_id, product_version: sub.product_version })
    } catch (err) {
      results.push({ id, ok: false, error: err?.message || String(err), code: err?.code || null })
    }
  }
  return { total: subscriptionIds.length, results }
}

export async function bulkPause({ subscriptionIds, reason = null, actorId = null }) {
  guardIds(subscriptionIds)
  const results = []
  for (const id of subscriptionIds) {
    try {
      const sub = await pauseSubscription(id, { reason, actorId, actorType: 'admin' })
      results.push({ id, ok: true, status: sub.status })
    } catch (err) {
      results.push({ id, ok: false, error: err?.message || String(err), code: err?.code || null })
    }
  }
  return { total: subscriptionIds.length, results }
}

export async function bulkResume({ subscriptionIds, actorId = null }) {
  guardIds(subscriptionIds)
  const results = []
  for (const id of subscriptionIds) {
    try {
      const sub = await resumeSubscription(id, { actorId, actorType: 'admin' })
      results.push({ id, ok: true, status: sub.status })
    } catch (err) {
      results.push({ id, ok: false, error: err?.message || String(err), code: err?.code || null })
    }
  }
  return { total: subscriptionIds.length, results }
}

/**
 * Bulk-issue credit notes across a set of tenants. Each row in
 * `entries` is one credit note. Signed amount as usual.
 */
export async function bulkIssueCredits({ entries, actorId = null, actorType = 'admin' }) {
  if (!Array.isArray(entries) || entries.length === 0) {
    throw Object.assign(new Error('entries must be a non-empty array'), { code: 'INVALID_INPUT' })
  }
  if (entries.length > MAX_BULK) {
    throw Object.assign(new Error(`bulk operations capped at ${MAX_BULK} entries`), { code: 'BULK_LIMIT' })
  }
  const results = []
  for (const entry of entries) {
    try {
      const note = await issueNote({
        tenantId: entry.tenant_id,
        subscriptionId: entry.subscription_id || null,
        type: entry.type,
        amountMinor: entry.amount_minor,
        currency: entry.currency,
        reason: entry.reason || null,
        expiresAt: entry.expires_at || null,
        actorId,
        actorType,
        metadata: entry.metadata || {},
      })
      results.push({ tenant_id: entry.tenant_id, ok: true, note_id: note.id })
    } catch (err) {
      results.push({ tenant_id: entry.tenant_id, ok: false, error: err?.message || String(err), code: err?.code || null })
    }
  }
  return { total: entries.length, results }
}

export { MAX_BULK }
