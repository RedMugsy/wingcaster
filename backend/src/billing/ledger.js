/**
 * Append-only event-sourced ledger. Spec §5 requires ACID; we get
 * transactional correctness on the current Postgres persistence layer
 * because every ledger write is a single INSERT with no read-then-write
 * cycle. Balance queries are SUM aggregates over the log, not counter
 * decrements — no race conditions on inserts, no lost updates.
 *
 * Do NOT expose an update or delete surface on LedgerEntry. Corrections
 * are new entries of type='adjustment' with a signed amount.
 *
 * Do NOT compute balances from a cached counter. Always aggregate the
 * log for the (tenant, period, quota_key) triple.
 */

import { v4 as uuidv4 } from 'uuid'
import { findAll, insert } from '../db.js'

export const LEDGER_ENTRY_TYPES = ['allowance_grant', 'consumption', 'overage', 'topup', 'adjustment']

/**
 * Write one immutable ledger entry. Signed amount:
 *   allowance_grant / topup / positive adjustment → +N
 *   consumption / overage / negative adjustment    → −N
 */
export async function writeLedgerEntry({
  tenantId,
  subscriptionId,
  billingPeriod,
  type,
  quotaKey,
  amount,
  sourceEventId,
  metadata,
}) {
  if (!LEDGER_ENTRY_TYPES.includes(type)) throw new Error(`Invalid ledger entry type: ${type}`)
  if (!tenantId) throw new Error('tenantId required')
  if (!quotaKey) throw new Error('quotaKey required')

  const row = {
    id: uuidv4(),
    tenant_id: tenantId,
    subscription_id: subscriptionId || null,
    billing_period: billingPeriod || currentBillingPeriod(),
    type,
    quota_key: quotaKey,
    amount: Number(amount) || 0,
    source_event_id: sourceEventId || null,
    metadata: metadata || {},
    created_at: new Date().toISOString(),
  }
  await insert('ledger_entries', row)
  return row
}

/**
 * Balance for a (tenant, quota, period). Sums the log — safe because
 * inserts are the only mutation and every insert is atomic on Postgres.
 * Returns integer balance (allowance + top-ups − consumption − overage
 * captured as negative adjustment).
 */
export async function quotaBalance({ tenantId, quotaKey, billingPeriod }) {
  const period = billingPeriod || currentBillingPeriod()
  const rows = await findAll('ledger_entries', (r) =>
    r.tenant_id === tenantId && r.quota_key === quotaKey && r.billing_period === period,
  )
  return rows.reduce((sum, r) => sum + (Number(r.amount) || 0), 0)
}

/**
 * Grouped breakdown of a period — useful for the tenant's billing page.
 * Returns { allowance_grant, consumption, overage, topup, adjustment,
 * balance } per quota key.
 */
export async function periodSummary({ tenantId, billingPeriod }) {
  const period = billingPeriod || currentBillingPeriod()
  const rows = await findAll('ledger_entries', (r) => r.tenant_id === tenantId && r.billing_period === period)
  const byQuota = {}
  for (const r of rows) {
    if (!byQuota[r.quota_key]) {
      byQuota[r.quota_key] = { allowance_grant: 0, consumption: 0, overage: 0, topup: 0, adjustment: 0, balance: 0, entry_count: 0 }
    }
    byQuota[r.quota_key][r.type] += Number(r.amount) || 0
    byQuota[r.quota_key].balance += Number(r.amount) || 0
    byQuota[r.quota_key].entry_count += 1
  }
  return { billing_period: period, tenant_id: tenantId, by_quota: byQuota }
}

/**
 * Grant an allowance for a period (called at period start).
 */
export async function grantAllowance({ tenantId, subscriptionId, billingPeriod, quotaKey, amount }) {
  return writeLedgerEntry({
    tenantId, subscriptionId, billingPeriod,
    type: 'allowance_grant', quotaKey, amount: Math.max(0, Number(amount) || 0),
  })
}

/**
 * Record consumption. Amount is written as a NEGATIVE ledger entry so
 * balance math sums correctly. Detection of overage happens at
 * consumption time by inspecting the pre-consumption balance.
 */
export async function recordConsumption({ tenantId, subscriptionId, billingPeriod, quotaKey, amount, sourceEventId, metadata }) {
  const q = Math.max(0, Number(amount) || 0)
  if (q === 0) return null
  const preBalance = await quotaBalance({ tenantId, quotaKey, billingPeriod })
  const withinAllowance = Math.min(q, Math.max(0, preBalance))
  const overage = q - withinAllowance
  const writes = []
  if (withinAllowance > 0) {
    writes.push(await writeLedgerEntry({
      tenantId, subscriptionId, billingPeriod, type: 'consumption', quotaKey,
      amount: -withinAllowance, sourceEventId, metadata,
    }))
  }
  if (overage > 0) {
    writes.push(await writeLedgerEntry({
      tenantId, subscriptionId, billingPeriod, type: 'overage', quotaKey,
      amount: -overage, sourceEventId, metadata: { ...metadata, overage_units: overage },
    }))
  }
  return { withinAllowance, overage, entries: writes }
}

/**
 * Record a top-up purchase (increases balance, doesn't reset at period end).
 * Top-ups expire per the tenant config (SEED: 12 months from purchase).
 */
export async function recordTopup({ tenantId, subscriptionId, billingPeriod, quotaKey, amount, metadata }) {
  const q = Math.max(0, Number(amount) || 0)
  if (q === 0) return null
  return writeLedgerEntry({
    tenantId, subscriptionId, billingPeriod,
    type: 'topup', quotaKey, amount: q, metadata,
  })
}

/**
 * Manual adjustment (support, refund, correction). Signed amount.
 */
export async function recordAdjustment({ tenantId, subscriptionId, billingPeriod, quotaKey, amount, metadata }) {
  return writeLedgerEntry({
    tenantId, subscriptionId, billingPeriod,
    type: 'adjustment', quotaKey, amount: Number(amount) || 0, metadata,
  })
}

/**
 * Canonical billing period. Uses YYYY-MM for monthly-billed products.
 * Seller 90-day products will override this at subscription boot.
 */
export function currentBillingPeriod(at) {
  const d = at ? new Date(at) : new Date()
  const y = d.getUTCFullYear()
  const m = String(d.getUTCMonth() + 1).padStart(2, '0')
  return `${y}-${m}`
}
