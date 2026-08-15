import { describe, expect, it } from 'vitest'
import { daysBetween, prorateMigration } from './proration.js'

describe('prorateMigration — happy paths', () => {
  const periodStart = new Date('2026-08-01T00:00:00Z')
  const periodEnd = new Date('2026-08-31T00:00:00Z') // 30-day period

  it('exact midpoint upgrade $10 → $30 yields a $10 debit owed by tenant', () => {
    const now = new Date('2026-08-16T00:00:00Z') // 15 days used, 15 remaining
    const result = prorateMigration({ oldPriceMinor: 1000, newPriceMinor: 3000, periodStart, periodEnd, now })
    expect(result.daysInPeriod).toBe(30)
    expect(result.daysRemaining).toBe(15)
    expect(result.oldRefundMinor).toBe(500)
    expect(result.newChargeMinor).toBe(1500)
    expect(result.netCreditMinor).toBe(-1000)
    expect(result.issue).toBe(true)
  })

  it('exact midpoint downgrade $30 → $10 yields a $10 credit owed to tenant', () => {
    const now = new Date('2026-08-16T00:00:00Z')
    const result = prorateMigration({ oldPriceMinor: 3000, newPriceMinor: 1000, periodStart, periodEnd, now })
    expect(result.oldRefundMinor).toBe(1500)
    expect(result.newChargeMinor).toBe(500)
    expect(result.netCreditMinor).toBe(1000)
  })

  it('lateral migration (same price) yields no credit note', () => {
    const now = new Date('2026-08-16T00:00:00Z')
    const result = prorateMigration({ oldPriceMinor: 2000, newPriceMinor: 2000, periodStart, periodEnd, now })
    expect(result.netCreditMinor).toBe(0)
    expect(result.issue).toBe(false)
  })
})

describe('prorateMigration — edge cases', () => {
  it('returns issue=false when period_end is null (one_off cadence)', () => {
    const result = prorateMigration({ oldPriceMinor: 1000, newPriceMinor: 2000, periodStart: new Date(), periodEnd: null })
    expect(result.issue).toBe(false)
    expect(result.netCreditMinor).toBe(0)
  })

  it('returns issue=false when now is at or past period_end', () => {
    const periodStart = new Date('2026-01-01T00:00:00Z')
    const periodEnd = new Date('2026-02-01T00:00:00Z')
    const now = new Date('2026-02-15T00:00:00Z')
    const result = prorateMigration({ oldPriceMinor: 1000, newPriceMinor: 2000, periodStart, periodEnd, now })
    expect(result.issue).toBe(false)
  })

  it('treats now-before-period-start as 0 days used', () => {
    const periodStart = new Date('2026-09-01T00:00:00Z')
    const periodEnd = new Date('2026-10-01T00:00:00Z') // 30 days
    const now = new Date('2026-08-25T00:00:00Z')
    const result = prorateMigration({ oldPriceMinor: 1000, newPriceMinor: 3000, periodStart, periodEnd, now })
    // Full remaining ratio applies to both refund and charge.
    expect(result.ratioRemaining).toBe(1)
    expect(result.oldRefundMinor).toBe(1000)
    expect(result.newChargeMinor).toBe(3000)
    expect(result.netCreditMinor).toBe(-2000)
  })

  it('rounds to nearest minor unit', () => {
    // 7-day period, 3 days remaining, $10 → $17 upgrade.
    const periodStart = new Date('2026-08-01T00:00:00Z')
    const periodEnd = new Date('2026-08-08T00:00:00Z')
    const now = new Date('2026-08-05T00:00:00Z')
    const result = prorateMigration({ oldPriceMinor: 1000, newPriceMinor: 1700, periodStart, periodEnd, now })
    // ratio = 3/7, old refund = round(1000*3/7)=429, new charge = round(1700*3/7)=729
    expect(result.oldRefundMinor).toBe(429)
    expect(result.newChargeMinor).toBe(729)
    expect(result.netCreditMinor).toBe(-300)
  })

  it('handles zero old price (was on a free tier)', () => {
    const periodStart = new Date('2026-08-01T00:00:00Z')
    const periodEnd = new Date('2026-08-31T00:00:00Z')
    const now = new Date('2026-08-16T00:00:00Z')
    const result = prorateMigration({ oldPriceMinor: 0, newPriceMinor: 2000, periodStart, periodEnd, now })
    expect(result.oldRefundMinor).toBe(0)
    expect(result.newChargeMinor).toBe(1000)
    expect(result.netCreditMinor).toBe(-1000)
  })

  it('handles zero new price (going to free tier) — full old refund credited', () => {
    const periodStart = new Date('2026-08-01T00:00:00Z')
    const periodEnd = new Date('2026-08-31T00:00:00Z')
    const now = new Date('2026-08-16T00:00:00Z')
    const result = prorateMigration({ oldPriceMinor: 2000, newPriceMinor: 0, periodStart, periodEnd, now })
    expect(result.oldRefundMinor).toBe(1000)
    expect(result.newChargeMinor).toBe(0)
    expect(result.netCreditMinor).toBe(1000)
  })
})

describe('daysBetween', () => {
  it('handles simple positive interval', () => {
    expect(daysBetween('2026-08-01T00:00:00Z', '2026-08-11T00:00:00Z')).toBe(10)
  })
  it('handles fractional days', () => {
    expect(daysBetween('2026-08-01T00:00:00Z', '2026-08-01T12:00:00Z')).toBe(0.5)
  })
  it('is signed', () => {
    expect(daysBetween('2026-08-11T00:00:00Z', '2026-08-01T00:00:00Z')).toBe(-10)
  })
})
