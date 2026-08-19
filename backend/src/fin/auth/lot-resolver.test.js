import { describe, expect, it } from 'vitest'
import { resolveDrawPlan } from './lot-resolver.js'

const NOW = '2026-08-18T12:00:00.000Z'
const METER_A = '11111111-1111-1111-1111-111111111111'
const METER_B = '22222222-2222-2222-2222-222222222222'

function lot(overrides = {}) {
  return {
    id: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
    status: 'ACTIVE',
    remaining_units: 100n,
    draw_priority: 10,
    expires_at: null,
    issued_at: '2026-01-01T00:00:00.000Z',
    rules: [],
    ...overrides,
  }
}

describe('lot-resolver', () => {
  it('single-lot covers the request', () => {
    const plan = resolveDrawPlan({
      lots: [lot({ remaining_units: 100n })],
      meterId: METER_A,
      unitsRequested: 30n,
      now: NOW,
    })
    expect(plan.covered).toBe(true)
    expect(plan.shortfall).toBe(0n)
    expect(plan.allocations).toEqual([
      { lotId: lot().id, units: 30n },
    ])
  })

  it('multi-lot greedy fills in draw_priority order', () => {
    const low = lot({
      id: 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb',
      draw_priority: 1,
      remaining_units: 40n,
    })
    const high = lot({
      id: 'cccccccc-cccc-cccc-cccc-cccccccccccc',
      draw_priority: 20,
      remaining_units: 80n,
    })
    const plan = resolveDrawPlan({
      lots: [high, low],
      meterId: METER_A,
      unitsRequested: 50n,
      now: NOW,
    })
    expect(plan.covered).toBe(true)
    expect(plan.allocations).toEqual([
      { lotId: low.id, units: 40n },
      { lotId: high.id, units: 10n },
    ])
  })

  it('expired lots are skipped', () => {
    const plan = resolveDrawPlan({
      lots: [
        lot({ remaining_units: 100n, expires_at: '2026-08-01T00:00:00.000Z' }),
      ],
      meterId: METER_A,
      unitsRequested: 10n,
      now: NOW,
    })
    expect(plan.covered).toBe(false)
    expect(plan.shortfall).toBe(10n)
    expect(plan.allocations).toEqual([])
  })

  it('FROZEN lots are skipped', () => {
    const plan = resolveDrawPlan({
      lots: [lot({ status: 'FROZEN', remaining_units: 100n })],
      meterId: METER_A,
      unitsRequested: 10n,
      now: NOW,
    })
    expect(plan.covered).toBe(false)
    expect(plan.allocations).toEqual([])
  })

  it('applicability DENY_METER skips the lot', () => {
    const plan = resolveDrawPlan({
      lots: [lot({
        remaining_units: 100n,
        rules: [{ rule_kind: 'DENY_METER', matcher: METER_A }],
      })],
      meterId: METER_A,
      unitsRequested: 10n,
      now: NOW,
    })
    expect(plan.covered).toBe(false)
    expect(plan.shortfall).toBe(10n)
  })

  it('DENY_METER for a different meter still allows the lot', () => {
    const plan = resolveDrawPlan({
      lots: [lot({
        remaining_units: 50n,
        rules: [{ rule_kind: 'DENY_METER', matcher: METER_B }],
      })],
      meterId: METER_A,
      unitsRequested: 20n,
      now: NOW,
    })
    expect(plan.covered).toBe(true)
    expect(plan.allocations[0].units).toBe(20n)
  })

  it('returns shortfall when total remaining is less than requested', () => {
    const plan = resolveDrawPlan({
      lots: [
        lot({ id: 'dddddddd-dddd-dddd-dddd-dddddddddddd', remaining_units: 4n }),
        lot({ id: 'eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee', remaining_units: 3n, draw_priority: 11 }),
      ],
      meterId: METER_A,
      unitsRequested: 10n,
      now: NOW,
    })
    expect(plan.covered).toBe(false)
    expect(plan.shortfall).toBe(3n)
    expect(plan.allocations).toEqual([
      { lotId: 'dddddddd-dddd-dddd-dddd-dddddddddddd', units: 4n },
      { lotId: 'eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee', units: 3n },
    ])
  })

  it('tie-breaks equal draw_priority by expires_at then id (NULLS LAST)', () => {
    const later = lot({
      id: 'ffffffff-ffff-ffff-ffff-fffffffffff1',
      draw_priority: 5,
      expires_at: '2026-12-01T00:00:00.000Z',
      remaining_units: 10n,
    })
    const sooner = lot({
      id: 'ffffffff-ffff-ffff-ffff-fffffffffff2',
      draw_priority: 5,
      expires_at: '2026-09-01T00:00:00.000Z',
      remaining_units: 10n,
    })
    const never = lot({
      id: 'ffffffff-ffff-ffff-ffff-fffffffffff0',
      draw_priority: 5,
      expires_at: null,
      remaining_units: 10n,
    })
    const plan = resolveDrawPlan({
      lots: [never, later, sooner],
      meterId: METER_A,
      unitsRequested: 25n,
      now: NOW,
    })
    expect(plan.allocations.map((row) => row.lotId)).toEqual([
      sooner.id, later.id, never.id,
    ])
  })

  it('equal draw_priority and expires_at tie-breaks by issued_at then id', () => {
    const newer = lot({
      id: '00000000-0000-0000-0000-000000000002',
      draw_priority: 1,
      expires_at: '2027-01-01T00:00:00.000Z',
      issued_at: '2026-06-01T00:00:00.000Z',
      remaining_units: 5n,
    })
    const older = lot({
      id: '00000000-0000-0000-0000-000000000001',
      draw_priority: 1,
      expires_at: '2027-01-01T00:00:00.000Z',
      issued_at: '2026-01-01T00:00:00.000Z',
      remaining_units: 5n,
    })
    const plan = resolveDrawPlan({
      lots: [newer, older],
      meterId: METER_A,
      unitsRequested: 6n,
      now: NOW,
    })
    expect(plan.allocations.map((row) => row.lotId)).toEqual([older.id, newer.id])
    expect(plan.allocations.map((row) => row.units)).toEqual([5n, 1n])
  })
})
