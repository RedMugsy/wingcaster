/**
 * Proration math for mid-period subscription migrations.
 *
 * Model:
 *   - Period length is billing_period_end - billing_period_start (days).
 *   - Days used = now - period_start.
 *   - Days remaining = period_end - now.
 *   - Old refund = old_price × (days_remaining / days_in_period)
 *     (tenant should get money back for the unused portion of what they
 *     already committed to.)
 *   - New charge = new_price × (days_remaining / days_in_period)
 *     (tenant should pay for the portion of the new plan they're about
 *     to consume.)
 *   - Net credit to tenant = old_refund - new_charge
 *     Positive → credit_note owed to tenant (proration_credit).
 *     Negative → debit owed by tenant (proration_debit).
 *
 * The function is a pure computation: pass in the numbers, get back
 * a plan. No side effects. Rounding is Math.round to the nearest
 * minor unit; the maximum-per-migration rounding error is 1 minor
 * unit, which is acceptable.
 *
 * For subscriptions with no billing_period_end (one_off cadence) or
 * where period_start >= now, prorateMigration returns netCreditMinor=0
 * and issue=false — the migration is treated as effective immediately
 * with no money movement.
 */

const MS_PER_DAY = 24 * 60 * 60 * 1000

export function daysBetween(a, b) {
  const start = a instanceof Date ? a : new Date(a)
  const end = b instanceof Date ? b : new Date(b)
  return (end.getTime() - start.getTime()) / MS_PER_DAY
}

/**
 * @param {object} input
 * @param {number} input.oldPriceMinor        what the tenant is paying today
 * @param {number} input.newPriceMinor        what the tenant will pay from now
 * @param {Date|string} input.periodStart     current billing_period_start
 * @param {Date|string} input.periodEnd       current billing_period_end
 *                                            (null → no proration possible)
 * @param {Date|string} [input.now=new Date()]
 * @returns {{
 *   issue: boolean,              // whether to create a credit_note
 *   netCreditMinor: number,      // signed amount for the credit_note
 *   oldRefundMinor: number,      // money owed to tenant from old plan
 *   newChargeMinor: number,      // money owed by tenant for new plan
 *   daysInPeriod: number,
 *   daysRemaining: number,
 *   ratioRemaining: number,      // 0..1
 * }}
 */
export function prorateMigration(input) {
  const oldPrice = Math.max(0, Math.round(Number(input.oldPriceMinor) || 0))
  const newPrice = Math.max(0, Math.round(Number(input.newPriceMinor) || 0))
  const periodStart = input.periodStart ? new Date(input.periodStart) : null
  const periodEnd = input.periodEnd ? new Date(input.periodEnd) : null
  const now = input.now ? new Date(input.now) : new Date()

  if (!periodStart || !periodEnd) {
    return zero({ oldPrice, newPrice })
  }
  const daysInPeriod = daysBetween(periodStart, periodEnd)
  if (daysInPeriod <= 0) return zero({ oldPrice, newPrice })

  // If we're at or past period end, nothing to prorate — new tier just
  // takes effect on the next period.
  if (now >= periodEnd) return zero({ oldPrice, newPrice })
  // If we're before period start (schedule anomaly), treat as 0 elapsed.
  const daysUsed = Math.max(0, daysBetween(periodStart, now))
  const daysRemaining = Math.max(0, daysInPeriod - daysUsed)
  const ratioRemaining = daysRemaining / daysInPeriod

  const oldRefundMinor = Math.round(oldPrice * ratioRemaining)
  const newChargeMinor = Math.round(newPrice * ratioRemaining)
  const netCreditMinor = oldRefundMinor - newChargeMinor

  return {
    issue: netCreditMinor !== 0,
    netCreditMinor,
    oldRefundMinor,
    newChargeMinor,
    daysInPeriod,
    daysRemaining,
    ratioRemaining,
  }
}

function zero({ oldPrice, newPrice }) {
  return {
    issue: false,
    netCreditMinor: 0,
    oldRefundMinor: 0,
    newChargeMinor: 0,
    daysInPeriod: 0,
    daysRemaining: 0,
    ratioRemaining: 0,
    _oldPrice: oldPrice,
    _newPrice: newPrice,
  }
}
