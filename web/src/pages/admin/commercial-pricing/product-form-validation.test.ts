import { describe, expect, it } from 'vitest'
import { validateProductForm } from './ProductFormDialog'
import { validateTierForm } from './TierFormDialog'
import { validateOverrideForm } from './PricingOverrideFormDialog'
import type { BillingCadence, ProductType } from '@/types/commercialPricing'

const validProduct = {
  code: 'wingcaster-agent',
  name: 'Wingcaster Agent',
  description: '',
  product_type: 'plan' as ProductType,
  billing_cadence: 'monthly' as BillingCadence,
  base_price_minor: 9900,
  currency: 'USD',
  is_public: true,
}

describe('validateProductForm', () => {
  it('accepts a well-formed payload in create mode', () => {
    expect(validateProductForm(validProduct, 'create')).toBeNull()
  })

  it('accepts a mostly-empty patch in edit mode (code validation skipped)', () => {
    expect(validateProductForm({ ...validProduct, code: '' }, 'edit')).toBeNull()
  })

  it('rejects invalid code in create mode only', () => {
    expect(validateProductForm({ ...validProduct, code: 'Bad Code' }, 'create')).toMatch(/kebab/i)
    expect(validateProductForm({ ...validProduct, code: 'Bad Code' }, 'edit')).toBeNull()
  })

  it('rejects blank name', () => {
    expect(validateProductForm({ ...validProduct, name: '   ' }, 'create')).toMatch(/Name/)
  })

  it('rejects bad currency', () => {
    expect(validateProductForm({ ...validProduct, currency: 'us' }, 'create')).toMatch(/3-letter/)
    expect(validateProductForm({ ...validProduct, currency: 'USDT' }, 'create')).toMatch(/3-letter/)
  })

  it('rejects negative base_price_minor', () => {
    expect(validateProductForm({ ...validProduct, base_price_minor: -1 }, 'create')).toMatch(/non-negative/)
  })

  it('rejects invalid product_type', () => {
    expect(validateProductForm({ ...validProduct, product_type: 'bogus' as ProductType }, 'create')).toMatch(/product type/)
  })
})

describe('validateTierForm', () => {
  const valid = {
    code: 'pro',
    name: 'Pro',
    description: '',
    sort_order: 0,
    price_minor: 9900,
    currency: 'USD',
    quotas: {},
    features: '',
    is_public: true,
  }

  it('accepts a well-formed payload', () => {
    expect(validateTierForm(valid, 'create')).toBeNull()
  })

  it('rejects bad code in create mode', () => {
    expect(validateTierForm({ ...valid, code: 'Bad' }, 'create')).toMatch(/kebab/i)
    // Edit mode skips code check.
    expect(validateTierForm({ ...valid, code: 'Bad' }, 'edit')).toBeNull()
  })

  it('rejects blank name', () => {
    expect(validateTierForm({ ...valid, name: '' }, 'create')).toMatch(/Name/)
  })

  it('accepts null price_minor (inherits from product)', () => {
    expect(validateTierForm({ ...valid, price_minor: null }, 'create')).toBeNull()
  })

  it('rejects negative price_minor when set', () => {
    expect(validateTierForm({ ...valid, price_minor: -1 }, 'create')).toMatch(/non-negative/)
  })

  it('rejects invalid currency when set', () => {
    expect(validateTierForm({ ...valid, currency: 'us' }, 'create')).toMatch(/3-letter/)
  })
})

describe('validateOverrideForm', () => {
  it('accepts a valid override', () => {
    expect(validateOverrideForm({ territory_id: 't-1', price_minor: 5000, currency: 'USD' })).toBeNull()
  })

  it('rejects missing territory', () => {
    expect(validateOverrideForm({ territory_id: null, price_minor: 5000, currency: 'USD' })).toMatch(/Territory/)
  })

  it('rejects negative price', () => {
    expect(validateOverrideForm({ territory_id: 't-1', price_minor: -1, currency: 'USD' })).toMatch(/non-negative/)
  })

  it('rejects bad currency', () => {
    expect(validateOverrideForm({ territory_id: 't-1', price_minor: 5000, currency: 'us' })).toMatch(/3-letter/)
  })
})
