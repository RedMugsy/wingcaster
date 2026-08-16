/**
 * Per-tenant reconciliation view.
 *
 * Answers the question "for this tenant, what's the current commercial
 * picture across the two ledgers?"
 *
 *   - Quota ledger (commercial.ledger_entries) — allowance granted vs
 *     consumption drawn, per quota_key, for the current period.
 *   - Credit-notes ledger (commercial.billing_credit_notes) — dollar-
 *     denominated pending balance per currency.
 *   - Subscription roll-up — what's their current plan, when does it
 *     renew, what's the daily rate.
 *
 * Read-only. The admin uses this to answer support requests and to
 * spot anomalies (negative balances, orphan entries) without stitching
 * three separate queries together.
 */

import { query } from '../../db.js'
import { currentBillingPeriod } from '../ledger.js'
import { pendingBalance } from '../products/credit-notes.js'

export async function tenantReconciliation(tenantId, { billingPeriod = null } = {}) {
  if (!tenantId) throw Object.assign(new Error('tenantId is required'), { code: 'MISSING_FIELD' })
  const period = billingPeriod || currentBillingPeriod()

  const [subs, quotas, credits, historyCounts] = await Promise.all([
    querySubscriptions(tenantId),
    queryQuotaLedger(tenantId, period),
    pendingBalance(tenantId),
    queryHistoryCounts(tenantId),
  ])

  const anomalies = detectAnomalies({ subs, quotas })

  return {
    tenant_id: tenantId,
    billing_period: period,
    subscriptions: subs,
    quota_ledger: quotas,
    credit_notes: { pending_by_currency: credits },
    history_counts: historyCounts,
    anomalies,
  }
}

async function querySubscriptions(tenantId) {
  return query(
    `SELECT s.id, s.status, s.product_id, s.product_version, s.tier_id,
            bp.code AS product_code, bp.name AS product_name, bp.billing_cadence,
            bt.name AS tier_name,
            s.resolved_plan_price_minor, s.resolved_plan_currency,
            s.billing_period_start, s.billing_period_end, s.next_renewal_at,
            s.trial_ends_at, s.cancel_at_period_end, s.auto_renew,
            s.grandfathered_at
       FROM commercial.billing_subscriptions s
       LEFT JOIN commercial.billing_products bp ON bp.id = s.product_id
       LEFT JOIN commercial.billing_product_tiers bt ON bt.id = s.tier_id
      WHERE s.tenant_id = $1
      ORDER BY s.created_at DESC`,
    [tenantId],
  )
}

async function queryQuotaLedger(tenantId, billingPeriod) {
  const rows = await query(
    `SELECT quota_key, type, COALESCE(SUM(amount), 0)::bigint AS total
       FROM commercial.ledger_entries
      WHERE tenant_id = $1 AND billing_period = $2
      GROUP BY quota_key, type
      ORDER BY quota_key, type`,
    [tenantId, billingPeriod],
  )
  const byQuota = new Map()
  for (const row of rows) {
    if (!byQuota.has(row.quota_key)) {
      byQuota.set(row.quota_key, {
        quota_key: row.quota_key,
        allowance_grant: 0,
        topup: 0,
        consumption: 0,
        overage: 0,
        adjustment: 0,
        balance: 0,
      })
    }
    const bucket = byQuota.get(row.quota_key)
    const type = row.type
    if (type in bucket) bucket[type] = Number(row.total)
    bucket.balance += Number(row.total)
  }
  return Array.from(byQuota.values()).sort((a, b) => a.quota_key.localeCompare(b.quota_key))
}

async function queryHistoryCounts(tenantId) {
  const rows = await query(
    `SELECT h.event, COUNT(*)::int AS n
       FROM commercial.billing_subscription_history h
       JOIN commercial.billing_subscriptions s ON s.id = h.subscription_id
      WHERE s.tenant_id = $1
      GROUP BY h.event
      ORDER BY n DESC`,
    [tenantId],
  )
  return rows.map((r) => ({ event: r.event, count: Number(r.n) }))
}

function detectAnomalies({ subs, quotas }) {
  const anomalies = []
  for (const q of quotas) {
    if (q.balance < 0) {
      anomalies.push({
        severity: 'high',
        kind: 'negative_quota_balance',
        detail: `Quota ${q.quota_key} has a negative balance of ${q.balance}. Consumption exceeded allowance without a top-up.`,
      })
    }
  }
  const activeLike = subs.filter((s) => ['trialing', 'active', 'past_due', 'paused'].includes(s.status))
  if (activeLike.length > 1) {
    const plans = activeLike.filter((s) => s.product_code) // heuristic: has product info
    if (plans.length > 1) {
      // May be add-ons — flag as info, not high.
      anomalies.push({
        severity: 'info',
        kind: 'multiple_active_subscriptions',
        detail: `Tenant has ${activeLike.length} live subscriptions. Expected: one plan + optional add-ons.`,
      })
    }
  }
  return anomalies
}
