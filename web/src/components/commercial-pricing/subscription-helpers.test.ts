import { describe, expect, it } from 'vitest'
import {
  CREDIT_NOTE_STATUS_CLASSES,
  CREDIT_NOTE_STATUS_LABELS,
  CREDIT_NOTE_TYPE_LABELS,
  PRODUCT_STATUS_CLASSES,
  PRODUCT_STATUS_LABELS,
  SUBSCRIPTION_STATUS_CLASSES,
  SUBSCRIPTION_STATUS_LABELS,
  dailyRateMinor,
  daysUntilIso,
  formatCreditNoteAmount,
  formatMoneyMinor,
  formatRelativeIso,
  formatShortIso,
  permittedActions,
} from './subscription-helpers'
import type {
  CreditNoteStatus,
  CreditNoteType,
  ProductStatus,
  SubscriptionStatus,
} from '../../types/commercialPricing'

describe('status maps', () => {
  it('every SubscriptionStatus has a class + label', () => {
    const statuses: SubscriptionStatus[] = ['trialing', 'active', 'past_due', 'paused', 'cancelled', 'expired']
    for (const status of statuses) {
      expect(SUBSCRIPTION_STATUS_CLASSES[status]).toMatch(/border-/)
      expect(SUBSCRIPTION_STATUS_LABELS[status]).toBeTruthy()
    }
  })

  it('every ProductStatus has a class + label', () => {
    const statuses: ProductStatus[] = ['draft', 'active', 'deprecated', 'retired']
    for (const status of statuses) {
      expect(PRODUCT_STATUS_CLASSES[status]).toMatch(/border-/)
      expect(PRODUCT_STATUS_LABELS[status]).toBeTruthy()
    }
  })

  it('every CreditNoteStatus has a class + label', () => {
    const statuses: CreditNoteStatus[] = ['pending', 'applied', 'expired', 'voided']
    for (const status of statuses) {
      expect(CREDIT_NOTE_STATUS_CLASSES[status]).toMatch(/border-/)
      expect(CREDIT_NOTE_STATUS_LABELS[status]).toBeTruthy()
    }
  })

  it('every CreditNoteType has a label', () => {
    const types: CreditNoteType[] = ['proration_credit', 'proration_debit', 'refund', 'courtesy', 'promo', 'manual_adjustment']
    for (const t of types) expect(CREDIT_NOTE_TYPE_LABELS[t]).toBeTruthy()
  })
})

describe('formatMoneyMinor', () => {
  it('renders 4 decimals under $1, 2 decimals at $1+', () => {
    expect(formatMoneyMinor(8, 'USD')).toBe('USD 0.0800')
    expect(formatMoneyMinor(50, 'USD')).toBe('USD 0.5000')
    expect(formatMoneyMinor(100, 'USD')).toBe('USD 1.00')
    expect(formatMoneyMinor(12345, 'USD')).toBe('USD 123.45')
  })

  it('returns em-dash for null/undefined', () => {
    expect(formatMoneyMinor(null)).toBe('—')
    expect(formatMoneyMinor(undefined)).toBe('—')
  })

  it('handles negatives with unicode minus', () => {
    expect(formatMoneyMinor(-500, 'USD')).toBe('−USD 5.00')
  })

  it('defaults to USD when currency is null', () => {
    expect(formatMoneyMinor(200, null)).toBe('USD 2.00')
  })
})

describe('formatCreditNoteAmount', () => {
  it('positive = credit with plus sign', () => {
    const r = formatCreditNoteAmount(1000, 'USD')
    expect(r.text).toBe('+USD 10.00')
    expect(r.direction).toBe('credit')
  })

  it('negative = debit with minus sign', () => {
    const r = formatCreditNoteAmount(-1000, 'USD')
    expect(r.text).toBe('−USD 10.00')
    expect(r.direction).toBe('debit')
  })

  it('zero = zero direction', () => {
    const r = formatCreditNoteAmount(0, 'USD')
    expect(r.direction).toBe('zero')
  })
})

describe('date formatters', () => {
  it('returns em-dash for null/invalid inputs', () => {
    expect(formatRelativeIso(null)).toBe('—')
    expect(formatRelativeIso(undefined)).toBe('—')
    expect(formatRelativeIso('not a date')).toBe('—')
    expect(formatShortIso(null)).toBe('—')
    expect(formatShortIso('nope')).toBe('—')
  })

  it('formats a real ISO string to a non-empty string', () => {
    const iso = '2026-08-16T15:30:00Z'
    expect(formatRelativeIso(iso).length).toBeGreaterThan(0)
    expect(formatShortIso(iso).length).toBeGreaterThan(0)
  })
})

describe('dailyRateMinor', () => {
  it('30-day period at $30 → 100 minor / day', () => {
    expect(dailyRateMinor(3000, '2026-08-01T00:00:00Z', '2026-08-31T00:00:00Z')).toBe(100)
  })

  it('null price returns null', () => {
    expect(dailyRateMinor(null, '2026-08-01T00:00:00Z', '2026-08-31T00:00:00Z')).toBeNull()
  })

  it('null period boundaries return null', () => {
    expect(dailyRateMinor(3000, null, '2026-08-31T00:00:00Z')).toBeNull()
    expect(dailyRateMinor(3000, '2026-08-01T00:00:00Z', null)).toBeNull()
  })

  it('zero-day span returns null', () => {
    expect(dailyRateMinor(3000, '2026-08-01T00:00:00Z', '2026-08-01T00:00:00Z')).toBeNull()
  })

  it('rounds to nearest minor unit', () => {
    // $10 across 7 days = 142.857... → 143
    expect(dailyRateMinor(1000, '2026-08-01T00:00:00Z', '2026-08-08T00:00:00Z')).toBe(143)
  })
})

describe('daysUntilIso', () => {
  const now = new Date('2026-08-16T00:00:00Z')

  it('returns null for null / invalid / undefined inputs', () => {
    expect(daysUntilIso(null, now)).toBeNull()
    expect(daysUntilIso(undefined, now)).toBeNull()
    expect(daysUntilIso('bogus', now)).toBeNull()
  })

  it('returns null for already-past dates', () => {
    expect(daysUntilIso('2026-08-15T00:00:00Z', now)).toBeNull()
    expect(daysUntilIso('2026-08-16T00:00:00Z', now)).toBeNull() // exactly now
  })

  it('rounds partial days up so a 12h remainder still reads as "1 day left"', () => {
    expect(daysUntilIso('2026-08-16T12:00:00Z', now)).toBe(1)
    expect(daysUntilIso('2026-08-17T00:00:00Z', now)).toBe(1)
    expect(daysUntilIso('2026-08-17T00:00:01Z', now)).toBe(2)
  })

  it('handles multi-day gaps', () => {
    expect(daysUntilIso('2026-08-23T00:00:00Z', now)).toBe(7)
    expect(daysUntilIso('2027-08-16T00:00:00Z', now)).toBe(365)
  })
})

describe('permittedActions', () => {
  it('active: pause / cancel / mark-past-due / migrate; NOT resolve-past-due, NOT resume', () => {
    const a = permittedActions('active')
    expect(a.pause).toBe(true)
    expect(a.cancel).toBe(true)
    expect(a.markPastDue).toBe(true)
    expect(a.migrate).toBe(true)
    expect(a.resolvePastDue).toBe(false)
    expect(a.resume).toBe(false)
  })

  it('paused: resume / cancel / migrate; NOT pause, NOT past-due flags', () => {
    const a = permittedActions('paused')
    expect(a.resume).toBe(true)
    expect(a.pause).toBe(false)
    expect(a.cancel).toBe(true)
    expect(a.markPastDue).toBe(false)
  })

  it('past_due: resolve / cancel / migrate; NOT mark-past-due, NOT pause', () => {
    const a = permittedActions('past_due')
    expect(a.resolvePastDue).toBe(true)
    expect(a.cancel).toBe(true)
    expect(a.migrate).toBe(true)
    expect(a.markPastDue).toBe(false)
    expect(a.pause).toBe(false)
  })

  it('expired: nothing permitted', () => {
    const a = permittedActions('expired')
    expect(a.cancel).toBe(false)
    expect(a.expire).toBe(false)
    expect(a.pause).toBe(false)
    expect(a.resume).toBe(false)
    expect(a.migrate).toBe(false)
  })

  it('cancelled: expire allowed (until scanner rolls it), nothing else', () => {
    const a = permittedActions('cancelled')
    expect(a.expire).toBe(true)
    expect(a.cancel).toBe(false)
    expect(a.migrate).toBe(false)
  })
})
