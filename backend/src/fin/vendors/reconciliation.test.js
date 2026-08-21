import { describe, expect, it } from 'vitest'
import { classifyVariance, VARIANCE_REASONS } from './reconciliation.js'

describe('vendor variance classification (fast)', () => {
  it('registers the 10 reason codes', () => {
    expect(VARIANCE_REASONS).toEqual([
      'drift', 'rate_change', 'late_usage', 'duplicate', 'missing_source',
      'timezone', 'rounding', 'currency_mismatch', 'classification_drift', 'unknown',
    ])
  })

  it('returns null when both sides match', () => {
    expect(classifyVariance({ leftQty: 10, rightQty: 10 })).toBeNull()
  })

  it('classifies missing_source when one side is zero', () => {
    expect(classifyVariance({ leftQty: 10, rightQty: 0 })).toBe('missing_source')
    expect(classifyVariance({ leftQty: 0, rightQty: 4 })).toBe('missing_source')
  })

  it('classifies rounding for a 1-minor delta', () => {
    expect(classifyVariance({ leftQty: 100, rightQty: 101 })).toBe('rounding')
  })

  it('classifies generic quantity mismatch as drift', () => {
    expect(classifyVariance({ leftQty: 10, rightQty: 25 })).toBe('drift')
  })

  it('honours explicit hint reasons covering the full 10-code set', () => {
    const produced = VARIANCE_REASONS.map((reason) => classifyVariance({
      leftQty: 1, rightQty: 1, hints: { reason },
    }))
    expect(produced).toEqual(VARIANCE_REASONS)
  })

  it('maps boolean hints onto the classification set', () => {
    expect(classifyVariance({ leftQty: 1, rightQty: 2, hints: { currencyMismatch: true } }))
      .toBe('currency_mismatch')
    expect(classifyVariance({ leftQty: 1, rightQty: 2, hints: { duplicate: true } }))
      .toBe('duplicate')
    expect(classifyVariance({ leftQty: 1, rightQty: 2, hints: { lateUsage: true } }))
      .toBe('late_usage')
    expect(classifyVariance({ leftQty: 1, rightQty: 2, hints: { timezone: true } }))
      .toBe('timezone')
    expect(classifyVariance({ leftQty: 1, rightQty: 2, hints: { classificationDrift: true } }))
      .toBe('classification_drift')
    expect(classifyVariance({ leftQty: 1, rightQty: 2, hints: { rateChange: true } }))
      .toBe('rate_change')
    expect(classifyVariance({ leftQty: 1, rightQty: 2, hints: { unknown: true } }))
      .toBe('unknown')
  })
})
