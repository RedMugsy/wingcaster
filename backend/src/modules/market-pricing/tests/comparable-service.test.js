import { describe, it, expect, beforeEach } from 'vitest'
import { createComparableService } from '../application/comparable-service.js'
import { DEFAULT_MATCH_CONFIG } from '../domain/types.js'

const logger = { error: () => {}, warn: () => {}, debug: () => {}, info: () => {}, child: () => logger }

function createMockDal(overrides = {}) {
  const store = {
    pricing_normalization_rules: [],
    pricing_sources: [],
    external_comparables: [],
    area_profiles: [
      {
        id: 'area-batroun',
        name: 'Batroun',
        slug: 'batroun',
        center_latitude: 34.25,
        center_longitude: 35.66,
        status: 'scoring_enabled',
      },
    ],
    ...overrides,
  }
  return {
    findAll: (collection) => Promise.resolve(store[collection] || []),
    findOne: (collection, filter) => Promise.resolve((store[collection] || []).find(filter)),
  }
}

function createMockAdapter(properties = []) {
  return {
    getProperties: () => Promise.resolve(properties),
    getAreaProfiles: () => Promise.resolve([
      {
        id: 'area-batroun',
        name: 'Batroun',
        slug: 'batroun',
        center_latitude: 34.25,
        center_longitude: 35.66,
        status: 'scoring_enabled',
      },
    ]),
    findNearbyProperties: () => Promise.reject(new Error('PostGIS not available in mock')),
    findNearbyExternalComparables: () => Promise.reject(new Error('PostGIS not available in mock')),
  }
}

function createMockCurrencyService() {
  return {
    normalizeToUsd: (amount) => Promise.resolve({ amount: Number(amount), rate: 1, currency: 'USD' }),
  }
}

function property(overrides = {}) {
  return {
    id: 'target-1',
    price: 450000,
    currency: 'USD',
    property_type: 'villa',
    bedrooms: 3,
    bathrooms: 2,
    area: 200,
    building_age_years: 5,
    city: 'Batroun',
    latitude: 34.25,
    longitude: 35.66,
    created_at: new Date().toISOString(),
    ...overrides,
  }
}

describe('Comparable Service', () => {
  it('filters out properties by bedroom range', async () => {
    const target = property()
    const candidates = [
      property({ id: 'c1', bedrooms: 3 }),
      property({ id: 'c2', bedrooms: 5 }),
    ]
    const service = createComparableService({
      dal: createMockDal(),
      adapter: createMockAdapter(candidates),
      currencyService: createMockCurrencyService(),
      config: { baseCurrency: 'USD', defaultMatchConfig: DEFAULT_MATCH_CONFIG },
      logger,
    })

    const comps = await service.findComparables(target)
    expect(comps).toHaveLength(1)
    expect(comps[0].id).toBe('c1')
  })

  it('filters out properties by area range percent', async () => {
    const target = property({ area: 200 })
    const candidates = [
      property({ id: 'c1', area: 210 }),
      property({ id: 'c2', area: 300 }),
    ]
    const service = createComparableService({
      dal: createMockDal(),
      adapter: createMockAdapter(candidates),
      currencyService: createMockCurrencyService(),
      config: { baseCurrency: 'USD', defaultMatchConfig: DEFAULT_MATCH_CONFIG },
      logger,
    })

    const comps = await service.findComparables(target)
    expect(comps).toHaveLength(1)
    expect(comps[0].id).toBe('c1')
  })

  it('excludes the target property itself', async () => {
    const target = property({ id: 'target-1' })
    const candidates = [property({ id: 'target-1' }), property({ id: 'c1' })]
    const service = createComparableService({
      dal: createMockDal(),
      adapter: createMockAdapter(candidates),
      currencyService: createMockCurrencyService(),
      config: { baseCurrency: 'USD', defaultMatchConfig: DEFAULT_MATCH_CONFIG },
      logger,
    })

    const comps = await service.findComparables(target)
    expect(comps).toHaveLength(1)
    expect(comps[0].id).toBe('c1')
  })

  it('quarantines outliers outside 0.7x–3x median band', async () => {
    const target = property({ price: 450000 })
    const candidates = [
      property({ id: 'cheap', price: 100000 }),
      property({ id: 'normal', price: 460000 }),
      property({ id: 'expensive', price: 2000000 }),
    ]
    const service = createComparableService({
      dal: createMockDal(),
      adapter: createMockAdapter(candidates),
      currencyService: createMockCurrencyService(),
      config: { baseCurrency: 'USD', defaultMatchConfig: DEFAULT_MATCH_CONFIG },
      logger,
    })

    const comps = await service.findComparables(target)
    const ids = comps.map((c) => c.id)
    expect(ids).toContain('normal')
    expect(ids).not.toContain('cheap')
    expect(ids).not.toContain('expensive')
  })

  it('sorts by similarity weight with exact matches on top', async () => {
    const target = property({ area: 200, bedrooms: 3, bathrooms: 2, building_age_years: 5 })
    const candidates = [
      property({ id: 'exact', area: 200, bedrooms: 3, bathrooms: 2, building_age_years: 5 }),
      property({ id: 'bigger', area: 220, bedrooms: 4, bathrooms: 3, building_age_years: 8 }),
    ]
    const service = createComparableService({
      dal: createMockDal(),
      adapter: createMockAdapter(candidates),
      currencyService: createMockCurrencyService(),
      config: { baseCurrency: 'USD', defaultMatchConfig: DEFAULT_MATCH_CONFIG },
      logger,
    })

    const comps = await service.findComparables(target)
    expect(comps[0].id).toBe('exact')
    expect(comps[0].weight).toBeGreaterThan(comps[1].weight)
  })

  it('applies time-decay weighting to older listings', async () => {
    const target = property()
    const now = Date.now()
    const oneDay = 24 * 60 * 60 * 1000
    const candidates = [
      property({ id: 'fresh', created_at: new Date(now - 7 * oneDay).toISOString() }),
      property({ id: 'old', created_at: new Date(now - 150 * oneDay).toISOString() }),
    ]
    const service = createComparableService({
      dal: createMockDal(),
      adapter: createMockAdapter(candidates),
      currencyService: createMockCurrencyService(),
      config: { baseCurrency: 'USD', defaultMatchConfig: DEFAULT_MATCH_CONFIG },
      logger,
    })

    const comps = await service.findComparables(target)
    expect(comps).toHaveLength(2)
    const fresh = comps.find((c) => c.id === 'fresh')
    const old = comps.find((c) => c.id === 'old')
    expect(fresh.weight).toBeGreaterThan(old.weight)
  })

  it('includes external comparables from enabled sources', async () => {
    const target = property()
    const service = createComparableService({
      dal: createMockDal({
        pricing_sources: [
          { source: 'olx_lebanon', provider: 'skeleton', label: 'OLX', enabled: true, is_internal: false },
        ],
        external_comparables: [
          {
            id: 'ext-1',
            source: 'olx_lebanon',
            price: 440000,
            price_normalized_usd: 440000,
            property_type: 'villa',
            bedrooms: 3,
            bathrooms: 2,
            area_sqm: 200,
            city: 'Batroun',
            location_text: 'Batroun',
            latitude: 34.25,
            longitude: 35.66,
            scraped_at: new Date().toISOString(),
            status: 'active',
          },
        ],
      }),
      adapter: createMockAdapter([]),
      currencyService: createMockCurrencyService(),
      config: { baseCurrency: 'USD', defaultMatchConfig: DEFAULT_MATCH_CONFIG },
      logger,
    })

    const comps = await service.findComparables(target)
    const ext = comps.find((c) => c.id === 'ext-1')
    expect(ext).toBeDefined()
    expect(ext.source).toBe('external')
  })

  it('applies condition adjustment via normalization rules', async () => {
    const target = property({ condition: 'good' })
    const candidates = [
      property({ id: 'renovated', condition: 'newly_renovated' }),
    ]
    const service = createComparableService({
      dal: createMockDal({
        pricing_normalization_rules: [
          { rule_type: 'condition', value: 'newly_renovated', adjustment_percent: 20, is_active: true },
        ],
      }),
      adapter: createMockAdapter(candidates),
      currencyService: createMockCurrencyService(),
      config: { baseCurrency: 'USD', defaultMatchConfig: DEFAULT_MATCH_CONFIG },
      logger,
    })

    const comps = await service.findComparables(target)
    expect(comps[0].normalized_price).toBe(540000)
  })
})
