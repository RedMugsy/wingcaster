import { describe, expect, it } from 'vitest'
import { validateTerritoryForm } from './TerritoryFormDialog'
import { validateZoneForm } from './ZoneFormDialog'
import { validateCityForm } from './CityFormDialog'

const validTerritory = {
  code: 'LB',
  name: 'Lebanon',
  currency: 'USD',
  pricing_multiplier: 0.4,
  launch_status: 'launched' as const,
  launch_wave: '1',
  data_residency_required: false,
  billing_mode: 'card' as const,
  vat_percent: 11,
  regulator_id_type: '',
  payment_gateway_primary: '',
  payment_gateway_secondary: '',
}

describe('validateTerritoryForm', () => {
  it('accepts a well-formed payload', () => {
    expect(validateTerritoryForm(validTerritory)).toBeNull()
  })

  it('rejects a bad country code', () => {
    expect(validateTerritoryForm({ ...validTerritory, code: 'lb' })).toMatch(/ISO country code/)
    expect(validateTerritoryForm({ ...validTerritory, code: 'LBN' })).toMatch(/ISO country code/)
    expect(validateTerritoryForm({ ...validTerritory, code: '' })).toMatch(/ISO country code/)
  })

  it('rejects a blank name', () => {
    expect(validateTerritoryForm({ ...validTerritory, name: '   ' })).toMatch(/Name is required/)
  })

  it('rejects a bad currency', () => {
    expect(validateTerritoryForm({ ...validTerritory, currency: 'us' })).toMatch(/3-letter uppercase/)
    expect(validateTerritoryForm({ ...validTerritory, currency: 'USDT' })).toMatch(/3-letter uppercase/)
  })

  it('rejects non-positive multipliers', () => {
    expect(validateTerritoryForm({ ...validTerritory, pricing_multiplier: 0 })).toMatch(/greater than 0/)
    expect(validateTerritoryForm({ ...validTerritory, pricing_multiplier: -1 })).toMatch(/greater than 0/)
  })

  it('rejects VAT outside 0..100', () => {
    expect(validateTerritoryForm({ ...validTerritory, vat_percent: -1 })).toMatch(/VAT/)
    expect(validateTerritoryForm({ ...validTerritory, vat_percent: 100.1 })).toMatch(/VAT/)
  })

  it('accepts VAT boundary values', () => {
    expect(validateTerritoryForm({ ...validTerritory, vat_percent: 0 })).toBeNull()
    expect(validateTerritoryForm({ ...validTerritory, vat_percent: 100 })).toBeNull()
  })
})

describe('validateZoneForm', () => {
  it('accepts kebab-case codes and positive multipliers', () => {
    expect(validateZoneForm({ code: 'beirut', name: 'Beirut', pricing_multiplier: 2 })).toBeNull()
    expect(validateZoneForm({ code: 'south-lebanon', name: 'South Lebanon', pricing_multiplier: 0.8 })).toBeNull()
  })

  it('rejects uppercase, spaces, or empty codes', () => {
    expect(validateZoneForm({ code: 'Beirut', name: 'x', pricing_multiplier: 1 })).toMatch(/kebab-case/)
    expect(validateZoneForm({ code: 'south lebanon', name: 'x', pricing_multiplier: 1 })).toMatch(/kebab-case/)
    expect(validateZoneForm({ code: '', name: 'x', pricing_multiplier: 1 })).toMatch(/kebab-case/)
  })

  it('rejects a blank name and non-positive multiplier', () => {
    expect(validateZoneForm({ code: 'a', name: '   ', pricing_multiplier: 1 })).toMatch(/Name is required/)
    expect(validateZoneForm({ code: 'a', name: 'ok', pricing_multiplier: 0 })).toMatch(/greater than 0/)
  })
})

describe('validateCityForm', () => {
  it('accepts a named city with a zone', () => {
    expect(validateCityForm({ name: 'Hamra', zone_id: 'z-1' })).toBeNull()
  })

  it('rejects blank name', () => {
    expect(validateCityForm({ name: '   ', zone_id: 'z-1' })).toMatch(/Name is required/)
  })

  it('rejects missing zone', () => {
    expect(validateCityForm({ name: 'Hamra', zone_id: null })).toMatch(/Zone is required/)
  })
})
