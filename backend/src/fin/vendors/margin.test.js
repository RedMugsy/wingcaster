import { describe, expect, it } from 'vitest'
import { contributionMargin } from './margin.js'

describe('vendor margin math (fast)', () => {
  it('contribution = recognized revenue − attributable provider cost', () => {
    expect(contributionMargin({
      recognizedRevenueMinor: 1000,
      attributableProviderCostMinor: 400,
    }).toString()).toBe('600')
  })

  it('accepts bigint strings and never reads remaining_units', () => {
    const margin = contributionMargin({
      recognizedRevenueMinor: '50',
      attributableProviderCostMinor: '11',
      remaining_units: 999999,
      lot: { remaining_units: 999999 },
    })
    expect(margin.toString()).toBe('39')
  })

  it('can be negative when cost exceeds revenue', () => {
    expect(contributionMargin({
      recognizedRevenueMinor: 1,
      attributableProviderCostMinor: 5,
    }).toString()).toBe('-4')
  })
})
