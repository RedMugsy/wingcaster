import { randomUUID } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import { isProductActive } from './products.js'
import { sampleProduct } from './test-support.js'
import { UNIT_SCALE } from './units.js'
import { finPostgresSuite } from '../testing/suite.js'
import { createCreditProduct } from './products.js'
import { fundingEnv, NOW } from './test-support.js'

describe('credit products (fast)', () => {
  it('UNIT_SCALE is 1_000_000n', () => {
    expect(UNIT_SCALE).toBe(1_000_000n)
  })

  it('isProductActive respects effective window and active flag', () => {
    const now = '2026-08-20T00:00:00.000Z'
    expect(isProductActive(sampleProduct({
      effective_from: '2026-01-01T00:00:00.000Z',
      effective_to: '2026-12-01T00:00:00.000Z',
    }), now)).toBe(true)
    expect(isProductActive(sampleProduct({
      effective_from: '2026-09-01T00:00:00.000Z',
    }), now)).toBe(false)
    expect(isProductActive(sampleProduct({
      effective_to: '2026-08-01T00:00:00.000Z',
    }), now)).toBe(false)
    expect(isProductActive(sampleProduct({ active: false }), now)).toBe(false)
  })
})

finPostgresSuite('credit products commands', {}, ({ pool, world }) => {
  it('createCreditProduct persists units/bonus/price as BIGINT', async () => {
    const created = await createCreditProduct({
      ...fundingEnv(world()),
      actorType: 'SYSTEM',
      code: `pack.${randomUUID().slice(0, 8)}`,
      name: 'Pack',
      units: 250,
      bonus_units: 25,
      price_minor: 9900,
      currency: 'USD',
      effective_from: NOW,
    })
    const row = await pool().query(`SELECT units::text, bonus_units::text, price_minor::text FROM fin.credit_products WHERE id = $1`, [created.id])
    expect(row.rows[0]).toMatchObject({ units: '250', bonus_units: '25', price_minor: '9900' })
  })
})
