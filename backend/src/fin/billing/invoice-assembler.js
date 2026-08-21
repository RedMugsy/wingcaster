/**
 * Pure grouping of a period's rated_usage into invoice draft lines.
 * No sourceless lines (spec §129). Called from draftInvoice.
 */
export function groupRatedUsage(rows, { lateClasses = ['OPEN_PERIOD', 'PRE_INVOICE'] } = {}) {
  const allowed = new Set(lateClasses)
  const groups = new Map()
  for (const row of rows) {
    if (!allowed.has(row.late_class || row.lateClass)) continue
    const sourceId = row.id || row.sourceId
    if (!sourceId) continue
    const meterKey = row.meter_version_id || row.meterVersionId || row.price_version_id || row.priceVersionId || 'none'
    const key = String(meterKey)
    const quantity = BigInt(row.billable_units ?? row.quantity_units ?? row.quantity ?? 0)
    const amount = BigInt(row.amount_minor ?? row.amountMinor ?? 0)
    const unitRate = quantity === 0n
      ? 0n
      : (row.unit_rate_minor != null || row.unitRateMinor != null
        ? BigInt(row.unit_rate_minor ?? row.unitRateMinor)
        : amount / quantity)
    const existing = groups.get(key) || {
      sourceType: 'RATED_USAGE',
      sourceIds: [],
      quantity: 0n,
      amount: 0n,
      unitRate,
      description: row.description || `meter:${key}`,
    }
    existing.sourceIds.push(sourceId)
    existing.quantity += quantity
    existing.amount += amount
    groups.set(key, existing)
  }
  const lines = []
  for (const group of groups.values()) {
    for (const sourceId of group.sourceIds) {
      const row = rows.find((r) => (r.id || r.sourceId) === sourceId)
      const quantity = BigInt(row.billable_units ?? row.quantity_units ?? row.quantity ?? 0)
      const amount = BigInt(row.amount_minor ?? row.amountMinor ?? 0)
      const unitRate = quantity === 0n
        ? 0n
        : (row.unit_rate_minor != null || row.unitRateMinor != null
          ? BigInt(row.unit_rate_minor ?? row.unitRateMinor)
          : amount / quantity)
      lines.push({
        sourceType: 'RATED_USAGE',
        sourceId,
        quantity: quantity.toString(),
        unit_rate_minor: unitRate.toString(),
        amount_minor: amount.toString(),
        description: row.description || `rated_usage:${sourceId}`,
      })
    }
  }
  return lines
}

export async function assembleInvoiceForPeriod(client, { billingPeriodId }) {
  const period = (await client.query(
    `SELECT * FROM fin.billing_periods WHERE id = $1`,
    [billingPeriodId],
  )).rows[0]
  if (!period) {
    return { invoiceDraftId: null, lines: [], period: null }
  }
  const { rows } = await client.query(
    `SELECT r.id, r.amount_minor, r.billable_units, r.late_class,
            r.price_version_id, r.metered_usage_id, m.meter_version_id,
            pv.unit_rate_minor
       FROM fin.rated_usage r
       JOIN fin.metered_usage m ON m.id = r.metered_usage_id
       LEFT JOIN fin.price_versions pv ON pv.id = r.price_version_id
      WHERE r.environment = $1
        AND r.tenant_id = $2
        AND (
          r.billing_period_id = $3
          OR (
            r.billing_period_id IS NULL
            AND r.metered_at >= $4::timestamptz
            AND r.metered_at < $5::timestamptz
          )
        )
      ORDER BY r.metered_at ASC, r.id ASC`,
    [
      period.environment, period.tenant_id, period.id,
      period.starts_at, period.ends_at,
    ],
  )
  const lines = groupRatedUsage(rows)
  return {
    invoiceDraftId: null,
    lines,
    period,
    subtotalMinor: lines.reduce((sum, line) => sum + BigInt(line.amount_minor), 0n).toString(),
  }
}
