/**
 * CSV export helpers.
 *
 * All exports stream fully into memory today — safe for the sizes we
 * ship at (thousands of subscriptions max). If we grow to hundreds of
 * thousands, switch to streaming via pg's cursor + res.write chunks.
 *
 * CSV format: RFC 4180 with LF line endings. Fields quoted only when
 * necessary (contain comma, quote, or newline). Everything is UTF-8.
 */

import { query } from '../../db.js'

export function toCsvRow(values) {
  return values
    .map((v) => {
      if (v == null) return ''
      const str = String(v)
      if (/["\n,]/.test(str)) return `"${str.replace(/"/g, '""')}"`
      return str
    })
    .join(',')
}

export function toCsv(headers, rows) {
  const lines = [toCsvRow(headers)]
  for (const row of rows) lines.push(toCsvRow(row))
  return lines.join('\n')
}

export async function subscriptionsCsv() {
  const rows = await query(
    `SELECT s.id, s.tenant_id, s.status, bp.code AS product_code, s.product_version,
            bt.code AS tier_code, bt.name AS tier_name,
            s.resolved_plan_price_minor, s.resolved_plan_currency,
            bp.billing_cadence,
            s.billing_period_start, s.billing_period_end, s.next_renewal_at,
            s.trial_ends_at, s.cancelled_at, s.cancel_at_period_end,
            s.auto_renew, s.grandfathered_at,
            t.code AS territory_code,
            s.created_at
       FROM commercial.billing_subscriptions s
       LEFT JOIN commercial.billing_products bp ON bp.id = s.product_id
       LEFT JOIN commercial.billing_product_tiers bt ON bt.id = s.tier_id
       LEFT JOIN commercial.territories t ON t.id = s.territory_id
      ORDER BY s.created_at DESC`,
  )
  const headers = [
    'subscription_id', 'tenant_id', 'status', 'product_code', 'product_version',
    'tier_code', 'tier_name', 'plan_price_minor', 'currency', 'cadence',
    'period_start', 'period_end', 'next_renewal', 'trial_ends_at', 'cancelled_at',
    'cancel_at_period_end', 'auto_renew', 'grandfathered_at', 'territory_code',
    'created_at',
  ]
  const body = rows.map((r) => [
    r.id, r.tenant_id, r.status, r.product_code, r.product_version,
    r.tier_code, r.tier_name, r.resolved_plan_price_minor, r.resolved_plan_currency, r.billing_cadence,
    r.billing_period_start, r.billing_period_end, r.next_renewal_at, r.trial_ends_at, r.cancelled_at,
    r.cancel_at_period_end, r.auto_renew, r.grandfathered_at, r.territory_code,
    r.created_at,
  ])
  return toCsv(headers, body)
}

export async function creditNotesCsv({ status = null } = {}) {
  const params = []
  const where = []
  if (status) { params.push(status); where.push(`status = $${params.length}`) }
  const rows = await query(
    `SELECT id, tenant_id, subscription_id, type, amount_minor, currency,
            status, applied_at, applied_to_invoice_id, expires_at,
            reason, actor_id, actor_type, created_at
       FROM commercial.billing_credit_notes
       ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
       ORDER BY created_at DESC`,
    params,
  )
  const headers = [
    'id', 'tenant_id', 'subscription_id', 'type', 'amount_minor', 'currency',
    'status', 'applied_at', 'applied_to_invoice_id', 'expires_at',
    'reason', 'actor_id', 'actor_type', 'created_at',
  ]
  const body = rows.map((r) => [
    r.id, r.tenant_id, r.subscription_id, r.type, r.amount_minor, r.currency,
    r.status, r.applied_at, r.applied_to_invoice_id, r.expires_at,
    r.reason, r.actor_id, r.actor_type, r.created_at,
  ])
  return toCsv(headers, body)
}

export async function subscriptionHistoryCsv({ tenantId = null, sinceIso = null } = {}) {
  const params = []
  const where = []
  if (tenantId) {
    params.push(tenantId)
    where.push(`subscription_id IN (SELECT id FROM commercial.billing_subscriptions WHERE tenant_id = $${params.length})`)
  }
  if (sinceIso) { params.push(sinceIso); where.push(`created_at >= $${params.length}::timestamptz`) }
  const rows = await query(
    `SELECT id, subscription_id, event, actor_id, actor_type, reason, created_at
       FROM commercial.billing_subscription_history
       ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
       ORDER BY created_at DESC`,
    params,
  )
  const headers = ['event_id', 'subscription_id', 'event', 'actor_id', 'actor_type', 'reason', 'created_at']
  const body = rows.map((r) => [r.id, r.subscription_id, r.event, r.actor_id, r.actor_type, r.reason, r.created_at])
  return toCsv(headers, body)
}
