import { randomUUID } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import { groupRatedUsage } from './invoice-assembler.js'

describe('invoice-assembler grouping', () => {
  it('emits one line per rated_usage with source_type/source_id and sums subtotal', () => {
    const idA = randomUUID()
    const idB = randomUUID()
    const lines = groupRatedUsage([
      {
        id: idA, billable_units: 10, amount_minor: 100, late_class: 'OPEN_PERIOD',
        meter_version_id: 'm1', unit_rate_minor: 10,
      },
      {
        id: idB, billable_units: 2, amount_minor: 20, late_class: 'PRE_INVOICE',
        meter_version_id: 'm1', unit_rate_minor: 10,
      },
      {
        id: randomUUID(), billable_units: 9, amount_minor: 90, late_class: 'POST_INVOICE',
        meter_version_id: 'm1', unit_rate_minor: 10,
      },
    ])
    expect(lines).toHaveLength(2)
    expect(lines.every((l) => l.sourceType === 'RATED_USAGE' && l.sourceId)).toBe(true)
    expect(lines.map((l) => l.sourceId).sort()).toEqual([idA, idB].sort())
    const subtotal = lines.reduce((s, l) => s + BigInt(l.amount_minor), 0n)
    expect(subtotal).toBe(120n)
  })

  it('skips sourceless rows', () => {
    const lines = groupRatedUsage([
      { billable_units: 1, amount_minor: 5, late_class: 'OPEN_PERIOD' },
    ])
    expect(lines).toEqual([])
  })
})
