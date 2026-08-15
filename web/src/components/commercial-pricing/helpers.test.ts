import { describe, expect, it } from 'vitest'
import {
  LAUNCH_STATUS_CLASSES,
  LAUNCH_STATUS_LABELS,
  PREVIEW_ACTIONS,
  formatCurrencyMinor,
  isValidMultiplier,
  multiplierHint,
} from './helpers'
import type { LaunchStatus } from '../../types/commercialPricing'

describe('MultiplierInput helpers', () => {
  const MIN = 0.01
  const MAX = 20

  it('accepts values inside [min, max]', () => {
    expect(isValidMultiplier(0.01, MIN, MAX)).toBe(true)
    expect(isValidMultiplier(1, MIN, MAX)).toBe(true)
    expect(isValidMultiplier(20, MIN, MAX)).toBe(true)
  })

  it('rejects values outside [min, max], NaN, negatives, infinity', () => {
    expect(isValidMultiplier(0, MIN, MAX)).toBe(false)
    expect(isValidMultiplier(-0.5, MIN, MAX)).toBe(false)
    expect(isValidMultiplier(20.01, MIN, MAX)).toBe(false)
    expect(isValidMultiplier(Number.NaN, MIN, MAX)).toBe(false)
    expect(isValidMultiplier(Number.POSITIVE_INFINITY, MIN, MAX)).toBe(false)
  })

  it('multiplierHint reports the percent of base for valid values', () => {
    expect(multiplierHint(0.4, MIN, MAX)).toBe('40% of base rate')
    expect(multiplierHint(1, MIN, MAX)).toBe('100% of base rate')
    expect(multiplierHint(2.5, MIN, MAX)).toBe('250% of base rate')
  })

  it('multiplierHint returns the error string for invalid input', () => {
    expect(multiplierHint(Number.NaN, MIN, MAX)).toBe('Enter a valid multiplier')
    expect(multiplierHint(-1, MIN, MAX)).toBe('Enter a valid multiplier')
    expect(multiplierHint(21, MIN, MAX)).toBe('Enter a valid multiplier')
  })
})

describe('LaunchStatusBadge maps', () => {
  const statuses: LaunchStatus[] = ['launched', 'planned', 'blocked', 'sunset']

  it('every LaunchStatus has both a class string and a Title-Case label', () => {
    for (const status of statuses) {
      expect(LAUNCH_STATUS_CLASSES[status]).toMatch(/border-/)
      expect(LAUNCH_STATUS_LABELS[status]).toMatch(/^[A-Z][a-z]+$/)
    }
  })

  it('classes reference the expected colour families', () => {
    expect(LAUNCH_STATUS_CLASSES.launched).toContain('emerald')
    expect(LAUNCH_STATUS_CLASSES.planned).toContain('slate')
    expect(LAUNCH_STATUS_CLASSES.blocked).toContain('amber')
    expect(LAUNCH_STATUS_CLASSES.sunset).toContain('rose')
  })
})

describe('MarketPreviewCard helpers', () => {
  it('PREVIEW_ACTIONS covers the five representative surfaces', () => {
    expect(PREVIEW_ACTIONS.map((a) => a.key)).toEqual([
      'publish.meta.facebook',
      'publish.x.link',
      'message.out.whatsapp.utility',
      'render.template.premium',
      'avm.report',
    ])
  })

  it('formatCurrencyMinor renders 4 decimals below $1 and 2 decimals at $1+', () => {
    expect(formatCurrencyMinor(8, 'USD')).toBe('USD 0.0800')
    expect(formatCurrencyMinor(50, 'USD')).toBe('USD 0.5000')
    expect(formatCurrencyMinor(100, 'USD')).toBe('USD 1.00')
    expect(formatCurrencyMinor(12345, 'USD')).toBe('USD 123.45')
  })

  it('formatCurrencyMinor defaults currency to USD when null', () => {
    expect(formatCurrencyMinor(200, null)).toBe('USD 2.00')
  })

  it('formatCurrencyMinor honours a non-USD currency code', () => {
    expect(formatCurrencyMinor(400, 'LBP')).toBe('LBP 4.00')
  })
})
