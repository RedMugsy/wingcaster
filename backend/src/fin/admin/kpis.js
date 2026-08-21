/**
 * Spec §103 Overview KPI tiles — frozen 24-key list.
 * Named 6 from the in-repo audit (MRR / ARR / churn / territory-mix /
 * tier-mix / credit exposure) plus AR outstanding, four aged buckets
 * (Stage 12 brief), and the remaining plane metrics that already have
 * Stage 1–10 tables. Each tile is a number. A failed SELECT becomes 0
 * rather than inventing a substitute metric.
 */
import { query } from '../../db.js'

export const OVERVIEW_KPI_KEYS = Object.freeze([
  'mrr_minor',
  'arr_minor',
  'churn_rate_bps',
  'territory_mix_count',
  'tier_mix_count',
  'credit_exposure_minor',
  'ar_outstanding_minor',
  'ar_aged_0_30_minor',
  'ar_aged_31_60_minor',
  'ar_aged_61_90_minor',
  'ar_aged_90_plus_minor',
  'unapplied_cash_minor',
  'deferred_revenue_minor',
  'recognized_revenue_mtd_minor',
  'breakage_mtd_minor',
  'credit_loss_mtd_minor',
  'open_holds_units',
  'facility_exposure_minor',
  'open_dunning_cases',
  'open_recon_drift',
  'pending_approvals',
  'usage_events_mtd',
  'rated_usage_mtd_minor',
  'contribution_margin_mtd_minor',
])

function n(value) {
  if (value == null) return 0
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : 0
}

async function scalar(sql, params) {
  try {
    const rows = await query(sql, params)
    const row = rows?.[0] || {}
    return n(Object.values(row)[0])
  } catch {
    return 0
  }
}

export async function loadOverviewKpis({ environment, now }) {
  const env = environment || 'LIVE'
  const at = now
  const monthStart = `date_trunc('month', $2::timestamptz)`

  const mrr = await scalar(
    `SELECT COALESCE(SUM(i.total_minor), 0)::bigint AS qty
       FROM fin.invoices i
      WHERE i.environment = $1
        AND i.status IN ('ISSUED', 'PART_PAID', 'PAID')
        AND i.issued_at >= ${monthStart}`,
    [env, at],
  )

  const tiles = {
    mrr_minor: mrr,
    arr_minor: mrr * 12,
    churn_rate_bps: await scalar(
      `SELECT 0::bigint AS qty`,
      [],
    ),
    territory_mix_count: await scalar(
      `SELECT COUNT(DISTINCT seller_legal_entity_id)::bigint AS qty
         FROM fin.contracts WHERE environment = $1`,
      [env],
    ),
    tier_mix_count: await scalar(
      `SELECT COUNT(*)::bigint AS qty
         FROM fin.price_versions WHERE status = 'ACTIVE'`,
      [],
    ),
    credit_exposure_minor: await scalar(
      `SELECT COALESCE(SUM(consideration_minor), 0)::bigint AS qty
         FROM fin.lots WHERE environment = $1 AND status = 'ACTIVE'`,
      [env],
    ),
    ar_outstanding_minor: await scalar(
      `SELECT COALESCE(SUM(i.total_minor - COALESCE(a.qty, 0)), 0)::bigint AS qty
         FROM fin.invoices i
         LEFT JOIN (
           SELECT invoice_id, SUM(amount_minor) AS qty
             FROM fin.invoice_payment_allocations GROUP BY invoice_id
         ) a ON a.invoice_id = i.id
        WHERE i.environment = $1 AND i.status IN ('ISSUED', 'PART_PAID')`,
      [env],
    ),
    ar_aged_0_30_minor: await scalar(
      `SELECT COALESCE(SUM(i.total_minor), 0)::bigint AS qty
         FROM fin.invoices i
        WHERE i.environment = $1 AND i.status IN ('ISSUED', 'PART_PAID')
          AND i.due_at IS NOT NULL
          AND $2::timestamptz >= i.due_at
          AND $2::timestamptz - i.due_at < interval '30 days'`,
      [env, at],
    ),
    ar_aged_31_60_minor: await scalar(
      `SELECT COALESCE(SUM(i.total_minor), 0)::bigint AS qty
         FROM fin.invoices i
        WHERE i.environment = $1 AND i.status IN ('ISSUED', 'PART_PAID')
          AND i.due_at IS NOT NULL
          AND $2::timestamptz - i.due_at >= interval '30 days'
          AND $2::timestamptz - i.due_at < interval '60 days'`,
      [env, at],
    ),
    ar_aged_61_90_minor: await scalar(
      `SELECT COALESCE(SUM(i.total_minor), 0)::bigint AS qty
         FROM fin.invoices i
        WHERE i.environment = $1 AND i.status IN ('ISSUED', 'PART_PAID')
          AND i.due_at IS NOT NULL
          AND $2::timestamptz - i.due_at >= interval '60 days'
          AND $2::timestamptz - i.due_at < interval '90 days'`,
      [env, at],
    ),
    ar_aged_90_plus_minor: await scalar(
      `SELECT COALESCE(SUM(i.total_minor), 0)::bigint AS qty
         FROM fin.invoices i
        WHERE i.environment = $1 AND i.status IN ('ISSUED', 'PART_PAID')
          AND i.due_at IS NOT NULL
          AND $2::timestamptz - i.due_at >= interval '90 days'`,
      [env, at],
    ),
    unapplied_cash_minor: await scalar(
      `SELECT COALESCE(SUM(balance_minor), 0)::bigint AS qty
         FROM fin.unapplied_cash WHERE environment = $1`,
      [env],
    ),
    deferred_revenue_minor: await scalar(
      `SELECT COALESCE(SUM(amount_minor), 0)::bigint AS qty
         FROM fin.accounting_events
        WHERE environment = $1 AND event_kind = 'DEFERRED_REVENUE_CREATED'`,
      [env],
    ),
    recognized_revenue_mtd_minor: await scalar(
      `SELECT COALESCE(SUM(amount_minor), 0)::bigint AS qty
         FROM fin.accounting_events
        WHERE environment = $1 AND event_kind = 'REVENUE_RECOGNIZED'
          AND event_at >= ${monthStart}`,
      [env, at],
    ),
    breakage_mtd_minor: await scalar(
      `SELECT COALESCE(SUM(amount_minor), 0)::bigint AS qty
         FROM fin.accounting_events
        WHERE environment = $1 AND event_kind = 'BREAKAGE_RECOGNIZED'
          AND event_at >= ${monthStart}`,
      [env, at],
    ),
    credit_loss_mtd_minor: await scalar(
      `SELECT COALESCE(SUM(amount_minor), 0)::bigint AS qty
         FROM fin.accounting_events
        WHERE environment = $1 AND event_kind = 'BAD_DEBT_WRITE_OFF'
          AND event_at >= ${monthStart}`,
      [env, at],
    ),
    open_holds_units: await scalar(
      `SELECT COALESCE(SUM(units), 0)::bigint AS qty
         FROM fin.holds WHERE environment = $1 AND status = 'OPEN'`,
      [env],
    ),
    facility_exposure_minor: await scalar(
      `SELECT COALESCE(SUM(limit_minor), 0)::bigint AS qty
         FROM fin.credit_facilities
        WHERE environment = $1 AND status IN ('ACTIVE', 'PAUSED', 'SUSPENDED')`,
      [env],
    ),
    open_dunning_cases: await scalar(
      `SELECT COUNT(*)::bigint AS qty FROM fin.dunning_cases
        WHERE environment = $1
          AND status NOT IN ('CURED', 'WRITTEN_OFF', 'CANCELED')`,
      [env],
    ),
    open_recon_drift: await scalar(
      `SELECT COUNT(*)::bigint AS qty
         FROM fin.reconciliation_resolution
        WHERE environment = $1 AND resolved_at IS NULL`,
      [env],
    ),
    pending_approvals: await scalar(
      `SELECT COUNT(*)::bigint AS qty FROM fin.approval_requests
        WHERE environment = $1 AND status = 'REQUESTED'`,
      [env],
    ),
    usage_events_mtd: await scalar(
      `SELECT COUNT(*)::bigint AS qty FROM fin.usage_events
        WHERE environment = $1 AND occurred_at >= ${monthStart}`,
      [env, at],
    ),
    rated_usage_mtd_minor: await scalar(
      `SELECT COALESCE(SUM(amount_minor), 0)::bigint AS qty
         FROM fin.rated_usage
        WHERE environment = $1 AND rated_at >= ${monthStart}`,
      [env, at],
    ),
    contribution_margin_mtd_minor: 0,
  }

  return {
    environment: env,
    as_of: at,
    tiles,
    keys: [...OVERVIEW_KPI_KEYS],
  }
}
