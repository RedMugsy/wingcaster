import { describe, expect, it } from 'vitest'
import { FinError } from '../errors.js'
import { quoteFromProduct, productSnapshotHash } from './quotes.js'
import { sampleProduct } from './test-support.js'

describe('quotes (fast)', () => {
  it('returns units, bonus, price_minor, currency, and a product_row_hash snapshot', () => {
    const product = sampleProduct()
    const quote = quoteFromProduct(product, { holderId: 'h1', now: '2026-08-20T00:00:00.000Z' })
    expect(quote.units).toBe('100')
    expect(quote.bonus_units).toBe('10')
    expect(quote.price_minor).toBe('5000')
    expect(quote.currency).toBe('USD')
    expect(quote.price_snapshot.product_row_hash).toBe(productSnapshotHash(product))
    expect(quote.price_snapshot.product_id).toBe(product.id)
  })

  it('adds promo bonus_units without mutating consideration', () => {
    const quote = quoteFromProduct(sampleProduct(), { promo: { bonus_units: 5 } })
    expect(quote.bonus_units).toBe('15')
    expect(quote.price_minor).toBe('5000')
  })

  it('rejects inactive product, currency mismatch, and non-positive quote', () => {
    expect(() => quoteFromProduct(sampleProduct({ active: false }))).toThrow(FinError)
    expect(() => quoteFromProduct(sampleProduct(), { currency: 'EUR' })).toThrow(FinError)
    expect(() => quoteFromProduct(sampleProduct({ units: 0 }))).toThrow(FinError)
    expect(() => quoteFromProduct(sampleProduct({ price_minor: 0 }))).toThrow(FinError)
    expect(() => quoteFromProduct(null)).toThrow(FinError)
  })

  it('does not persist — snapshot is a plain object', () => {
    const quote = quoteFromProduct(sampleProduct())
    expect(quote.price_snapshot.quoted_at).toBeTruthy()
    expect(typeof quote.price_snapshot).toBe('object')
  })
})
