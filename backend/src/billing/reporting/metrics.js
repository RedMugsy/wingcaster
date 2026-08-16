/**
 * Recurring-revenue metrics service.
 *
 * Everything is computed from commercial.billing_subscriptions +
 * commercial.billing_subscription_history + commercial.billing_credit_notes.
 * No cached counters, no reporting snapshot table — every number is a
 * SUM over the source of truth so it survives any state cleanup /
 * corrections.
 *
 * All amounts are minor units. Callers who want a display currency
 * pair with a currency picker (the subscriptions themselves carry
 * resolved_plan_currency).
 *
 * "MRR" for annual subscribers = annual_price / 12; for quarterly =
 * price / 3; for one_off = 0 (not recurring). We normalize to a
 * monthly rate so the numbers add up.
 */

import { query } from '../../db.js'

const CADENCE_TO_MONTHS = {
  monthly: 1,
  annual: 12,
  '90_days': 3,
  one_off: null,
  custom: null,
}

/**
 * Live MRR + subscriber count grouped by (currency, territory, tier).
 * Only counts subscriptions in states that produce revenue:
 * trialing (counted as MRR pipeline), active, past_due, paused.
 *
 * Trialing subs are reported separately as `trialing_mrr` — they will
 * flip to `active_mrr` once trial ends, so the two together are the
 * committed pipeline.
 *
 * @returns {Promise<{
 *   as_of: string,
 *   by_currency: Array<{
 *     currency: string,
 *     active_mrr_minor: number,
 *     trialing_mrr_minor: number,
 *     past_due_mrr_minor: number,
 *     paused_mrr_minor: number,
 *     total_committed_mrr_minor: number,
 *     arr_minor: number,
 *     subscribers: number,
 *   }>
 * }>}
 */
export async function mrrByCurrency({ now = new Date() } = {}) {
  const rows = await query(
    `SELECT
        COALESCE(s.resolved_plan_currency, 'USD') AS currency,
        s.status,
        COALESCE(bp.billing_cadence, 'monthly') AS billing_cadence,
        s.metadata->>'custom_period_days' AS custom_period_days,
        COALESCE(s.resolved_plan_price_minor, 0)::bigint AS price_minor
       FROM commercial.billing_subscriptions s
       LEFT JOIN commercial.billing_products bp ON bp.id = s.product_id
      WHERE s.status IN ('trialing','active','past_due','paused')`,
  )

  const byCurrency = new Map()
  for (const row of rows) {
    const currency = row.currency
    const cadence = row.billing_cadence
    const monthlyMinor = toMonthlyMinor(Number(row.price_minor), cadence, row.custom_period_days ? Number(row.custom_period_days) : null)
    if (!byCurrency.has(currency)) {
      byCurrency.set(currency, {
        currency,
        active_mrr_minor: 0,
        trialing_mrr_minor: 0,
        past_due_mrr_minor: 0,
        paused_mrr_minor: 0,
        total_committed_mrr_minor: 0,
        arr_minor: 0,
        subscribers: 0,
      })
    }
    const bucket = byCurrency.get(currency)
    bucket.subscribers += 1
    if (row.status === 'active') bucket.active_mrr_minor += monthlyMinor
    if (row.status === 'trialing') bucket.trialing_mrr_minor += monthlyMinor
    if (row.status === 'past_due') bucket.past_due_mrr_minor += monthlyMinor
    if (row.status === 'paused') bucket.paused_mrr_minor += monthlyMinor
  }
  for (const bucket of byCurrency.values()) {
    bucket.total_committed_mrr_minor = bucket.active_mrr_minor + bucket.trialing_mrr_minor + bucket.past_due_mrr_minor
    bucket.arr_minor = bucket.active_mrr_minor * 12
  }
  return {
    as_of: now.toISOString(),
    by_currency: Array.from(byCurrency.values()).sort((a, b) => b.active_mrr_minor - a.active_mrr_minor),
  }
}

/**
 * Churn for the last N days, computed against the history log.
 *
 * Denominator: subscribers that were active at the START of the window.
 * Numerator: subscribers that entered a terminal cancelled/expired
 * state during the window (from the history log).
 *
 * @returns {Promise<{
 *   window_days: number,
 *   started_at: string,
 *   ended_at: string,
 *   opening_subscribers: number,
 *   churned: number,
 *   churn_rate: number,   // 0..1
 * }>}
 */
export async function churnRate({ windowDays = 30, now = new Date() } = {}) {
  const endedAt = now
  const startedAt = new Date(now.getTime() - windowDays * 24 * 60 * 60 * 1000)

  // Opening subs = subs whose created_at <= window start AND (cancelled_at
  // IS NULL OR cancelled_at > window start).
  const openingRows = await query(
    `SELECT COUNT(*)::int AS n
       FROM commercial.billing_subscriptions
      WHERE created_at <= $1::timestamptz
        AND (cancelled_at IS NULL OR cancelled_at > $1::timestamptz)
        AND status IN ('trialing','active','past_due','paused','cancelled','expired')`,
    [startedAt.toISOString()],
  )
  const opening = openingRows?.[0]?.n || 0

  const churnedRows = await query(
    `SELECT COUNT(DISTINCT subscription_id)::int AS n
       FROM commercial.billing_subscription_history
      WHERE event IN ('cancelled_at_period_end','cancelled_immediately','expired')
        AND created_at > $1::timestamptz
        AND created_at <= $2::timestamptz`,
    [startedAt.toISOString(), endedAt.toISOString()],
  )
  const churned = churnedRows?.[0]?.n || 0

  return {
    window_days: windowDays,
    started_at: startedAt.toISOString(),
    ended_at: endedAt.toISOString(),
    opening_subscribers: opening,
    churned,
    churn_rate: opening > 0 ? churned / opening : 0,
  }
}

/**
 * Revenue by territory. Sums monthly-normalized prices for active
 * subscriptions grouped by territory (or "unassigned" when NULL).
 */
export async function mrrByTerritory({ now = new Date() } = {}) {
  const rows = await query(
    `SELECT
        COALESCE(t.code, 'UNASSIGNED') AS territory_code,
        COALESCE(pt.name, 'Unassigned') AS territory_name,
        COALESCE(s.resolved_plan_currency, 'USD') AS currency,
        COALESCE(bp.billing_cadence, 'monthly') AS billing_cadence,
        s.metadata->>'custom_period_days' AS custom_period_days,
        COALESCE(s.resolved_plan_price_minor, 0)::bigint AS price_minor
       FROM commercial.billing_subscriptions s
       LEFT JOIN commercial.billing_products bp ON bp.id = s.product_id
       LEFT JOIN commercial.territories t ON t.id = s.territory_id
       -- A territory's display name lives on the public row; the commercial
       -- row carries only pricing/launch fields and shares its id.
       LEFT JOIN public.territories pt ON pt.id = t.id
      WHERE s.status IN ('trialing','active','past_due','paused')`,
  )
  const byTerritory = new Map()
  for (const row of rows) {
    const key = `${row.territory_code}|${row.currency}`
    if (!byTerritory.has(key)) {
      byTerritory.set(key, {
        territory_code: row.territory_code,
        territory_name: row.territory_name,
        currency: row.currency,
        active_mrr_minor: 0,
        subscribers: 0,
      })
    }
    const bucket = byTerritory.get(key)
    bucket.subscribers += 1
    const monthlyMinor = toMonthlyMinor(Number(row.price_minor), row.billing_cadence, row.custom_period_days ? Number(row.custom_period_days) : null)
    bucket.active_mrr_minor += monthlyMinor
  }
  return {
    as_of: now.toISOString(),
    by_territory: Array.from(byTerritory.values()).sort((a, b) => b.active_mrr_minor - a.active_mrr_minor),
  }
}

/**
 * Subscription counts by (status, tier). Powers the admin dashboard
 * status chips + tier-mix charts.
 */
export async function subscriptionsByStatusAndTier() {
  const rows = await query(
    `SELECT
        s.status,
        COALESCE(bp.code, 'unknown') AS product_code,
        COALESCE(bp.version::text, '?') AS product_version,
        COALESCE(bt.code, 'unassigned') AS tier_code,
        COALESCE(bt.name, 'Unassigned') AS tier_name,
        COUNT(*)::int AS subscribers,
        COALESCE(SUM(s.resolved_plan_price_minor), 0)::bigint AS total_price_minor,
        COALESCE(s.resolved_plan_currency, 'USD') AS currency
       FROM commercial.billing_subscriptions s
       LEFT JOIN commercial.billing_products bp ON bp.id = s.product_id
       LEFT JOIN commercial.billing_product_tiers bt ON bt.id = s.tier_id
      GROUP BY s.status, bp.code, bp.version, bt.code, bt.name, s.resolved_plan_currency
      ORDER BY subscribers DESC`,
  )
  return rows.map((r) => ({ ...r, total_price_minor: Number(r.total_price_minor) }))
}

/**
 * Pending-credit exposure across every tenant, grouped by currency.
 * Positive amounts = money owed to tenants (liability). Negative =
 * money owed by tenants (receivable).
 */
export async function pendingCreditExposure() {
  const rows = await query(
    `SELECT currency,
            COALESCE(SUM(amount_minor) FILTER (WHERE amount_minor > 0), 0)::bigint AS credit_owed_minor,
            COALESCE(SUM(amount_minor) FILTER (WHERE amount_minor < 0), 0)::bigint AS debit_owed_minor,
            COUNT(*)::int AS pending_count
       FROM commercial.billing_credit_notes
      WHERE status = 'pending'
      GROUP BY currency
      ORDER BY currency`,
  )
  return rows.map((r) => ({
    currency: r.currency,
    credit_owed_minor: Number(r.credit_owed_minor),
    debit_owed_minor: Math.abs(Number(r.debit_owed_minor)),
    net_liability_minor: Number(r.credit_owed_minor) + Number(r.debit_owed_minor),
    pending_count: r.pending_count,
  }))
}

/**
 * Normalize a per-period price to per-month minor units.
 * one_off / custom without a period → 0 (not recurring for MRR
 * purposes). Custom cadence with custom_period_days uses that; treated
 * as `price × 30 / customPeriodDays`.
 */
export function toMonthlyMinor(priceMinor, cadence, customPeriodDays = null) {
  if (!Number.isFinite(priceMinor) || priceMinor <= 0) return 0
  if (cadence === 'one_off') return 0
  if (cadence === 'custom') {
    if (!customPeriodDays || customPeriodDays <= 0) return 0
    return Math.round((priceMinor * 30) / customPeriodDays)
  }
  const months = CADENCE_TO_MONTHS[cadence]
  if (!months) return 0
  return Math.round(priceMinor / months)
}
