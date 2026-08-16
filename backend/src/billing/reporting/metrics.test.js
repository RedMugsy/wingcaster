import { describe, expect, it } from 'vitest'
import { toMonthlyMinor } from './metrics.js'
import { toCsv, toCsvRow } from './exports.js'

describe('toMonthlyMinor', () => {
  it('monthly → passthrough', () => {
    expect(toMonthlyMinor(9900, 'monthly')).toBe(9900)
  })

  it('annual → divides by 12', () => {
    expect(toMonthlyMinor(120000, 'annual')).toBe(10000)
  })

  it('90_days → divides by 3', () => {
    expect(toMonthlyMinor(30000, '90_days')).toBe(10000)
  })

  it('custom with custom_period_days scales by 30/N', () => {
    // 45-day period at 4500 minor → 4500 × 30/45 = 3000 minor/month
    expect(toMonthlyMinor(4500, 'custom', 45)).toBe(3000)
  })

  it('custom without days returns 0 (not recurring)', () => {
    expect(toMonthlyMinor(4500, 'custom')).toBe(0)
    expect(toMonthlyMinor(4500, 'custom', 0)).toBe(0)
  })

  it('one_off returns 0', () => {
    expect(toMonthlyMinor(9900, 'one_off')).toBe(0)
  })

  it('unknown cadence returns 0', () => {
    expect(toMonthlyMinor(9900, 'weekly')).toBe(0)
  })

  it('non-positive prices return 0', () => {
    expect(toMonthlyMinor(0, 'monthly')).toBe(0)
    expect(toMonthlyMinor(-100, 'monthly')).toBe(0)
    expect(toMonthlyMinor(Number.NaN, 'monthly')).toBe(0)
  })
})

describe('toCsvRow', () => {
  it('renders plain fields as comma-separated', () => {
    expect(toCsvRow(['a', 'b', 'c'])).toBe('a,b,c')
  })

  it('null / undefined become empty strings', () => {
    expect(toCsvRow(['a', null, undefined, 'd'])).toBe('a,,,d')
  })

  it('quotes fields containing commas', () => {
    expect(toCsvRow(['a,b', 'c'])).toBe('"a,b",c')
  })

  it('escapes internal double quotes', () => {
    expect(toCsvRow(['she said "hi"'])).toBe('"she said ""hi"""')
  })

  it('quotes fields with newlines', () => {
    expect(toCsvRow(['a\nb'])).toBe('"a\nb"')
  })

  it('coerces non-strings via String()', () => {
    expect(toCsvRow([1, 2.5, true, false])).toBe('1,2.5,true,false')
  })
})

describe('toCsv', () => {
  it('joins header + rows with LF', () => {
    const csv = toCsv(['x', 'y'], [[1, 2], [3, 4]])
    expect(csv).toBe('x,y\n1,2\n3,4')
  })

  it('handles empty rows array', () => {
    expect(toCsv(['x', 'y'], [])).toBe('x,y')
  })
})
