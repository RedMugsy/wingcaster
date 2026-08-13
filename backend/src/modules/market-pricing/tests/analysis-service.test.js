import { describe, it, expect, beforeEach } from 'vitest'
import { createAnalysisService } from '../application/analysis-service.js'
import { ConfidenceLevel, PricePosition, DEFAULT_MATCH_CONFIG } from '../domain/types.js'

const logger = { error: () => {}, warn: () => {}, debug: () => {}, info: () => {}, child: () => logger }

function createDal(overrides = {}) {
  const analyses = overrides.analyses || []
  return {
    findOne: (collection, filter) => {
      if (collection === 'property_price_analyses') {
        return Promise.resolve(analyses.find(filter) || null)
      }
      return Promise.resolve(null)
    },
    findAll: (collection, filter) => {
      if (collection === 'property_price_analyses') {
        return Promise.resolve(analyses.filter(filter))
      }
      return Promise.resolve([])
    },
    insert: (collection, item) => Promise.resolve(item),
    update: (collection, filter, updater) => {
      const existing = analyses.find(filter)
      return Promise.resolve(updater(existing))
    },
  }
}

function createServices(overrides = {}) {
  const property = overrides.property || {
    id: 'prop-1',
    price: 450000,
    currency: 'USD',
    property_type: 'villa',
    bedrooms: 3,
    bathrooms: 2,
    area: 200,
    city: 'Batroun',
  }

  const comparables = overrides.comparables || [
    { id: 'c1', normalized_price: 400000, weight: 1 },
    { id: 'c2', normalized_price: 450000, weight: 1 },
    { id: 'c3', normalized_price: 500000, weight: 1 },
  ]

  const configService = {
    getDefaultConfig: () => Promise.resolve({ id: 'cfg-1', config_json: DEFAULT_MATCH_CONFIG }),
    getConfigById: (id) => Promise.resolve({ id, config_json: DEFAULT_MATCH_CONFIG }),
  }

  const currencyService = {
    normalizeToUsd: (amount, currency) => Promise.resolve({ amount: Number(amount), rate: 1, currency: 'USD' }),
  }

  const comparableService = {
    findComparables: () => Promise.resolve(comparables),
    resolveAreaForProperty: () => Promise.resolve({ id: 'area-1', name: 'Batroun' }),
  }

  const aiAdapter = {
    generateMarketContextSentence: () => Promise.resolve('AI sentence'),
  }

  return createAnalysisService({
    dal: createDal(overrides),
    adapter: { getPropertyById: () => Promise.resolve(property) },
    configService,
    currencyService,
    comparableService,
    aiAdapter,
    config: { baseCurrency: 'USD', analysisExpiryDays: 7 },
    logger,
  })
}

describe('Analysis Service', () => {
  it('computes weighted median and percentiles correctly for equal weights', async () => {
    const service = createServices({
      comparables: [
        { id: 'c1', normalized_price: 300000, weight: 1 },
        { id: 'c2', normalized_price: 400000, weight: 1 },
        { id: 'c3', normalized_price: 500000, weight: 1 },
        { id: 'c4', normalized_price: 600000, weight: 1 },
      ],
    })

    const analysis = await service.analyzeProperty('prop-1')
    expect(analysis.median_price).toBe(450000)
    expect(analysis.percentile_25).toBe(350000)
    expect(analysis.percentile_75).toBe(550000)
  })

  it('gives a highly relevant comparable more influence than weak matches', async () => {
    const service = createServices({
      property: { id: 'prop-1', price: 60000, currency: 'USD', property_type: 'villa', bedrooms: 3, bathrooms: 2, area: 200, city: 'Batroun' },
      comparables: [
        { id: 'strong', normalized_price: 60000, weight: 1 },
        { id: 'weak-low', normalized_price: 40000, weight: 0.001 },
        { id: 'weak-mid', normalized_price: 50000, weight: 0.001 },
      ],
    })

    const analysis = await service.analyzeProperty('prop-1')
    expect(analysis.median_price).toBeGreaterThan(59000)
    expect(analysis.mean_price).toBeGreaterThan(59900)
  })

  it('links lowest and highest prices to the price-sorted comparables', async () => {
    const service = createServices({
      comparables: [
        { id: 'highest', source: 'external', normalized_price: 600000, weight: 1 },
        { id: 'lowest', source: 'internal', normalized_price: 300000, weight: 0.5 },
        { id: 'middle', source: 'agent_report', normalized_price: 450000, weight: 0.75 },
      ],
    })

    const analysis = await service.analyzeProperty('prop-1')
    expect(analysis.lowest_price_property_id).toBe('lowest')
    expect(analysis.lowest_price_comparable_type).toBe('internal')
    expect(analysis.highest_price_property_id).toBe('highest')
    expect(analysis.highest_price_comparable_type).toBe('external')
  })

  it('classifies target price at median when within 5%', async () => {
    const service = createServices({
      comparables: [
        { id: 'c1', normalized_price: 400000, weight: 1 },
        { id: 'c2', normalized_price: 450000, weight: 1 },
        { id: 'c3', normalized_price: 500000, weight: 1 },
      ],
    })

    const analysis = await service.analyzeProperty('prop-1')
    expect(analysis.target_vs_median).toBe(PricePosition.AT)
    expect(analysis.target_vs_median_percent).toBe(0)
  })

  it('classifies target price above median when >5% higher', async () => {
    const service = createServices({
      property: { id: 'prop-1', price: 600000, currency: 'USD', property_type: 'villa', bedrooms: 3, bathrooms: 2, area: 200, city: 'Batroun' },
      comparables: [
        { id: 'c1', normalized_price: 400000, weight: 1 },
        { id: 'c2', normalized_price: 450000, weight: 1 },
        { id: 'c3', normalized_price: 500000, weight: 1 },
      ],
    })

    const analysis = await service.analyzeProperty('prop-1')
    expect(analysis.target_vs_median).toBe(PricePosition.ABOVE)
    expect(analysis.target_vs_median_percent).toBeGreaterThan(0)
  })

  it('returns low confidence when fewer than 5 comparables', async () => {
    const service = createServices({
      comparables: [
        { id: 'c1', normalized_price: 400000, weight: 1 },
      ],
    })

    const analysis = await service.analyzeProperty('prop-1')
    expect(analysis.confidence).toBe(ConfidenceLevel.LOW)
  })

  it('returns medium confidence when 5–11 comparables', async () => {
    const service = createServices({
      comparables: Array.from({ length: 8 }, (_, i) => ({
        id: `c${i}`,
        normalized_price: 400000 + i * 20000,
        weight: 1,
      })),
    })

    const analysis = await service.analyzeProperty('prop-1')
    expect(analysis.confidence).toBe(ConfidenceLevel.MEDIUM)
  })

  it('returns high confidence when 12 or more comparables', async () => {
    const service = createServices({
      comparables: Array.from({ length: 15 }, (_, i) => ({
        id: `c${i}`,
        normalized_price: 400000 + i * 10000,
        weight: 1,
      })),
    })

    const analysis = await service.analyzeProperty('prop-1')
    expect(analysis.confidence).toBe(ConfidenceLevel.HIGH)
  })

  it('returns cached analysis when not expired', async () => {
    const future = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString()
    const cached = {
      id: 'cached-1',
      property_id: 'prop-1',
      match_config_id: 'cfg-1',
      comparable_count: 99,
      expires_at: future,
    }
    const service = createServices({ analyses: [cached] })

    const analysis = await service.getAnalysis('prop-1')
    expect(analysis.comparable_count).toBe(99)
  })

  it('recomputes when cached analysis is expired', async () => {
    const past = new Date(Date.now() - 1).toISOString()
    const cached = {
      id: 'cached-1',
      property_id: 'prop-1',
      match_config_id: 'cfg-1',
      comparable_count: 99,
      expires_at: past,
    }
    const service = createServices({ analyses: [cached] })

    const analysis = await service.getAnalysis('prop-1')
    expect(analysis.comparable_count).not.toBe(99)
  })

  it('generates deterministic fallback sentence when AI adapter is absent', async () => {
    const service = createAnalysisService({
      dal: createDal(),
      adapter: { getPropertyById: () => Promise.resolve({ id: 'prop-1', price: 450000, currency: 'USD', property_type: 'villa', bedrooms: 3, bathrooms: 2, area: 200, city: 'Batroun' }) },
      configService: { getDefaultConfig: () => Promise.resolve({ id: 'cfg-1', config_json: DEFAULT_MATCH_CONFIG }) },
      currencyService: { normalizeToUsd: (amount) => Promise.resolve({ amount: Number(amount), rate: 1, currency: 'USD' }) },
      comparableService: {
        findComparables: () => Promise.resolve([
          { id: 'c1', normalized_price: 400000, weight: 1 },
          { id: 'c2', normalized_price: 500000, weight: 1 },
        ]),
        resolveAreaForProperty: () => Promise.resolve({ name: 'Batroun' }),
      },
      aiAdapter: null,
      config: { baseCurrency: 'USD', analysisExpiryDays: 7 },
      logger,
    })

    const analysis = await service.analyzeProperty('prop-1')
    expect(analysis.market_context_sentence).toContain('Similar')
    expect(analysis.market_context_sentence).toContain('Batroun')
  })
})
