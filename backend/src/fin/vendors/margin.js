/**
 * Contribution margin. Units are NEVER an input (spec §125 / DL-156).
 * recognized_revenue_minor − attributable_provider_cost_minor.
 */
import { asMinor } from './helpers.js'

export function contributionMargin({
  recognizedRevenueMinor,
  attributableProviderCostMinor,
}) {
  return asMinor(recognizedRevenueMinor) - asMinor(attributableProviderCostMinor)
}

/**
 * Attributable cost is vendor_actual_costs ⋈ rated_usage ⋈ revenue_allocation_lines
 * (Stage 9 DL-128). This function never reads lot.remaining_units.
 */
export async function computeMargin(client, {
  tenantId, from, to, environment = 'LIVE',
}) {
  const recognized = (await client.query(
    `SELECT COALESCE(SUM(amount_minor), 0)::bigint AS qty
       FROM fin.accounting_events
      WHERE environment = $1
        AND tenant_id = $2
        AND event_kind = 'REVENUE_RECOGNIZED'
        AND event_at >= $3::timestamptz
        AND event_at < $4::timestamptz`,
    [environment, tenantId, from, to],
  )).rows[0].qty

  const cost = (await client.query(
    `SELECT COALESCE(SUM(a.amount_minor), 0)::bigint AS qty
       FROM fin.vendor_actual_costs a
       JOIN fin.rated_usage ru ON ru.id = a.rated_usage_id
       JOIN fin.revenue_allocation_lines l ON l.rated_usage_id = ru.id
      WHERE a.environment = $1
        AND ru.tenant_id = $2
        AND ru.rated_at >= $3::timestamptz
        AND ru.rated_at < $4::timestamptz`,
    [environment, tenantId, from, to],
  )).rows[0].qty

  const margin = contributionMargin({
    recognizedRevenueMinor: recognized,
    attributableProviderCostMinor: cost,
  })
  return {
    recognizedRevenueMinor: String(recognized),
    attributableProviderCostMinor: String(cost),
    contributionMarginMinor: margin.toString(),
  }
}
