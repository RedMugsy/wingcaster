import { describe, it, expect } from 'vitest'
import { createCurrencyService } from '../application/currency-service.js'

const logger = { error: () => {}, warn: () => {}, debug: () => {}, info: () => {}, child: () => logger }

function createDal(rates = []) {
  return {
    findAll: () => Promise.resolve(rates),
    findOne: () => Promise.resolve(rates[0] || null),
  }
}

describe('Currency normalization', () => {
  it('returns 1:1 for fresh USD to USD', async () => {
    const service = createCurrencyService({ dal: createDal(), config: { baseCurrency: 'USD' }, logger })
    const result = await service.normalizeToUsd(100000, 'USD')
    expect(result.amount).toBe(100000)
    expect(result.rate).toBe(1)
    expect(result.currency).toBe('USD')
  })

  it('converts LBP to USD using parallel market rate', async () => {
    const service = createCurrencyService({
      dal: createDal([
        { from_currency: 'LBP', to_currency: 'USD', rate: 90000, source: 'manual', effective_at: new Date().toISOString() },
      ]),
      config: { baseCurrency: 'USD' },
      logger,
    })
    const result = await service.normalizeToUsd(4_500_000_000, 'LBP')
    expect(result.amount).toBe(50000)
  })

  it('rejects normalization when no rate is available', async () => {
    const service = createCurrencyService({ dal: createDal(), config: { baseCurrency: 'USD' }, logger })
    await expect(service.normalizeToUsd(100000, 'EUR')).rejects.toMatchObject({ code: 'CURRENCY_RATE_UNAVAILABLE' })
  })

  it('uses an approved stale rate and marks its provenance', async () => {
    const effectiveAt = new Date(Date.now() - 48 * 60 * 60 * 1000).toISOString()
    const service = createCurrencyService({
      dal: createDal([{ from_currency: 'LBP', to_currency: 'USD', rate: 90000, source: 'manual', effective_at: effectiveAt }]),
      config: { baseCurrency: 'USD', currencyRateFreshHours: 24, currencyRateMaxStaleHours: 168 },
      logger,
    })
    const result = await service.normalizeToUsd(9_000_000, 'LBP')
    expect(result.amount).toBe(100)
    expect(result.is_stale).toBe(true)
    expect(result.rate_source).toBe('manual')
    expect(result.rate_effective_at).toBe(effectiveAt)
  })

  it('rejects rates older than the controlled stale window', async () => {
    const effectiveAt = new Date(Date.now() - 8 * 24 * 60 * 60 * 1000).toISOString()
    const service = createCurrencyService({
      dal: createDal([{ from_currency: 'LBP', to_currency: 'USD', rate: 90000, source: 'manual', effective_at: effectiveAt }]),
      config: { baseCurrency: 'USD', currencyRateFreshHours: 24, currencyRateMaxStaleHours: 168 },
      logger,
    })
    await expect(service.normalizeToUsd(9_000_000, 'LBP')).rejects.toMatchObject({
      code: 'CURRENCY_RATE_UNAVAILABLE',
      details: expect.objectContaining({ reason: 'expired' }),
    })
  })
})

describe('Premium/adjustment math', () => {
  function applyAdjustment(price, percent) {
    return price * (1 + percent / 100)
  }

  it('newly renovated adds 20%', () => {
    expect(applyAdjustment(400000, 20)).toBe(480000)
  })

  it('needs work subtracts 30%', () => {
    expect(applyAdjustment(400000, -30)).toBe(280000)
  })

  it('fully furnished adds 25%', () => {
    expect(applyAdjustment(400000, 25)).toBe(500000)
  })

  it('sea view adds 20%', () => {
    expect(applyAdjustment(400000, 20)).toBe(480000)
  })
})
