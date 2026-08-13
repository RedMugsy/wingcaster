import { describe, it, expect } from 'vitest'
import { formatPrice, formatStat } from '../format'

describe('formatPrice', () => {
  it('formats sale prices in millions', () => {
    expect(formatPrice(2500000, 'sale')).toBe('$2.5M')
  })

  it('formats sale prices in thousands', () => {
    expect(formatPrice(850000, 'sale')).toBe('$850K')
  })

  it('formats monthly rent', () => {
    expect(formatPrice(2500, 'rent', 'month')).toBe('$2,500/mo')
  })
})

describe('formatStat', () => {
  it('formats large numbers', () => {
    expect(formatStat(1250000)).toBe('1.3M')
    expect(formatStat(12500)).toBe('12.5K')
    expect(formatStat(125)).toBe('125')
  })
})
