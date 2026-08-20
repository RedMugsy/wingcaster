import { describe, expect, it } from 'vitest'
import { resolveHybridPlan } from './hybrid-resolver.js'

const prepaid = {
  id: 'lot-pre', status: 'ACTIVE', remaining_units: 40,
  draw_priority: 10, expires_at: '2099-01-01', issued_at: '2026-01-01',
  source_kind: 'PROMOTIONAL_GRANT',
}
const committed = {
  id: 'lot-com', status: 'ACTIVE', remaining_units: 30,
  draw_priority: 20, expires_at: '2099-01-01', issued_at: '2026-01-02',
  source_kind: 'PURCHASE', contract_id: 'contract-1',
}
const purchased = {
  id: 'lot-buy', status: 'ACTIVE', remaining_units: 20,
  draw_priority: 30, expires_at: '2099-01-01', issued_at: '2026-01-03',
  source_kind: 'PURCHASE',
}
const activeFacility = { id: 'fac-1', status: 'ACTIVE', limit_minor: 1_000_000 }
const controls = { allow_postpaid_usage: true }

describe('resolveHybridPlan', () => {
  it('covers from prepaid lots only', () => {
    const plan = resolveHybridPlan({
      lots: [prepaid], unitsRequested: 10, facility: activeFacility, controls,
    })
    expect(plan.covered).toBe(true)
    expect(plan.allocations).toEqual([{ lotId: 'lot-pre', units: 10n }])
    expect(plan.facilityShortfallUnits).toBe(0n)
  })

  it('draws prepaid then committed then purchased then facility', () => {
    const plan = resolveHybridPlan({
      lots: [purchased, committed, prepaid],
      unitsRequested: 100,
      facility: activeFacility,
      controls,
      amountMinor: 1000,
    })
    expect(plan.covered).toBe(true)
    expect(plan.allocations.map((a) => a.lotId)).toEqual(['lot-pre', 'lot-com', 'lot-buy'])
    expect(plan.facilityShortfallUnits).toBe(10n)
    expect(plan.facilityShortfallMinor).toBe(100n)
  })

  it('covers entirely from the facility', () => {
    const plan = resolveHybridPlan({
      lots: [], unitsRequested: 50, facility: activeFacility, controls, amountMinor: 50,
    })
    expect(plan.covered).toBe(true)
    expect(plan.allocations).toEqual([])
    expect(plan.facilityShortfallUnits).toBe(50n)
  })

  it('denies when postpaid is not allowed', () => {
    const plan = resolveHybridPlan({
      lots: [], unitsRequested: 5, facility: activeFacility,
      controls: { allow_postpaid_usage: false },
    })
    expect(plan.covered).toBe(false)
    expect(plan.denialCode).toBe('INSUFFICIENT_ELIGIBLE_CREDITS')
  })

  it('denies facility shortfall when the facility is SUSPENDED', () => {
    const plan = resolveHybridPlan({
      lots: [], unitsRequested: 5,
      facility: { ...activeFacility, status: 'SUSPENDED' },
      controls,
    })
    expect(plan.covered).toBe(false)
    expect(plan.denialCode).toBe('FACILITY_NOT_ACTIVE')
  })
})
