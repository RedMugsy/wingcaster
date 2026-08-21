import { describe, expect, it } from 'vitest'
import { FinError } from '../errors.js'
import {
  assertLegalRateVersionTransition, createVendor, draftRateVersion,
  activateRateVersion, deprecateRateVersion, upsertVendorProduct,
} from './registry.js'

describe('vendor registry validation (fast)', () => {
  it('createVendor throws before tx when name is missing', async () => {
    await expect(createVendor({ currency: 'USD', reasonCode: 'TEST' }))
      .rejects.toMatchObject({ code: 'FIN_VENDOR_NAME_REQUIRED' })
  })

  it('createVendor throws before tx when currency is invalid', async () => {
    await expect(createVendor({ name: 'google', currency: 'US', reasonCode: 'TEST' }))
      .rejects.toMatchObject({ code: 'FIN_VENDOR_CURRENCY_INVALID' })
  })

  it('draftRateVersion throws before tx when rates are not an object', async () => {
    await expect(draftRateVersion({
      rateCardId: '00000000-0000-4000-8000-000000000001',
      rates: [],
      reasonCode: 'TEST',
    })).rejects.toMatchObject({ code: 'FIN_VENDOR_RATES_INVALID' })
  })

  it('draftRateVersion throws before tx when a rate lacks unit_cost_minor', async () => {
    await expect(draftRateVersion({
      rateCardId: '00000000-0000-4000-8000-000000000001',
      rates: { sku: { currency: 'USD' } },
      reasonCode: 'TEST',
    })).rejects.toMatchObject({ code: 'FIN_VENDOR_RATES_INVALID' })
  })

  it('activateRateVersion throws before tx without a version id', async () => {
    await expect(activateRateVersion({
      rateCardId: '00000000-0000-4000-8000-000000000001',
      reasonCode: 'TEST',
    })).rejects.toMatchObject({ code: 'FIN_VENDOR_RATE_VERSION_NOT_FOUND' })
  })

  it('deprecateRateVersion throws before tx without a version id', async () => {
    await expect(deprecateRateVersion({
      rateCardId: '00000000-0000-4000-8000-000000000001',
      reasonCode: 'TEST',
    })).rejects.toMatchObject({ code: 'FIN_VENDOR_RATE_VERSION_NOT_FOUND' })
  })

  it('upsertVendorProduct throws before tx without a product code', async () => {
    await expect(upsertVendorProduct({
      vendorId: '00000000-0000-4000-8000-000000000001',
      reasonCode: 'TEST',
    })).rejects.toMatchObject({ code: 'FIN_VENDOR_PRODUCT_CODE_REQUIRED' })
  })

  it('assertLegalRateVersionTransition allows DRAFT→ACTIVE and ACTIVE→DEPRECATED only', () => {
    expect(() => assertLegalRateVersionTransition('DRAFT', 'ACTIVE')).not.toThrow()
    expect(() => assertLegalRateVersionTransition('ACTIVE', 'DEPRECATED')).not.toThrow()
    expect(() => assertLegalRateVersionTransition('ACTIVE', 'DRAFT')).toThrow(FinError)
    expect(() => assertLegalRateVersionTransition('DEPRECATED', 'ACTIVE')).toThrow(FinError)
    expect(() => assertLegalRateVersionTransition('DRAFT', 'DEPRECATED')).toThrow(FinError)
  })
})
