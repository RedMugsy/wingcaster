import { Collections } from '../infrastructure/db.js'
import { createCurrencyProvider } from './currency-providers.js'

const RATE_CACHE_TTL_MS = 60 * 60 * 1000 // 1 hour

export class CurrencyRateUnavailableError extends Error {
  constructor(message, details = {}) {
    super(message)
    this.name = 'CurrencyRateUnavailableError'
    this.code = 'CURRENCY_RATE_UNAVAILABLE'
    this.details = details
  }
}

export function createCurrencyService({ dal, config, logger }) {
  const rateCache = new Map()

  async function getLatestRate(fromCurrency, toCurrency) {
    const from = String(fromCurrency).toUpperCase()
    const to = String(toCurrency).toUpperCase()
    const cacheKey = `${from}:${to}`
    const now = Date.now()
    const cached = rateCache.get(cacheKey)
    if (cached && cached.cachedAt + RATE_CACHE_TTL_MS > now) {
      return cached.rate
    }

    const rows = await dal.findAll(
      Collections.CURRENCY_RATES,
      (r) => String(r.from_currency).toUpperCase() === from && String(r.to_currency).toUpperCase() === to
    )
    const sorted = rows.sort((a, b) => new Date(b.effective_at) - new Date(a.effective_at))
    const rate = sorted[0] || null
    rateCache.set(cacheKey, { rate, cachedAt: now })
    return rate
  }

  async function normalizeToUsd(amount, currency) {
    if (!amount || !currency) return { amount, rate: null, currency }
    const normalizedCurrency = String(currency).toUpperCase()
    const baseCurrency = String(config.baseCurrency).toUpperCase()

    let adjusted = Number(amount)
    let rate = 1
    let rateSource = 'identity'
    let rateEffectiveAt = null
    let rateAgeHours = 0
    let isStale = false

    if (normalizedCurrency !== baseCurrency) {
      const rateRecord = await getLatestRate(normalizedCurrency, baseCurrency)
      if (!rateRecord) {
        throw new CurrencyRateUnavailableError(`No ${normalizedCurrency}/${baseCurrency} conversion rate is available`, {
          from_currency: normalizedCurrency,
          to_currency: baseCurrency,
          reason: 'missing',
        })
      }
      rate = Number(rateRecord.rate)
      if (!Number.isFinite(rate) || rate <= 0) {
        throw new CurrencyRateUnavailableError(`The ${normalizedCurrency}/${baseCurrency} conversion rate is invalid`, {
          from_currency: normalizedCurrency,
          to_currency: baseCurrency,
          reason: 'invalid',
        })
      }
      rateEffectiveAt = rateRecord.effective_at || rateRecord.created_at || null
      const effectiveMs = rateEffectiveAt ? new Date(rateEffectiveAt).getTime() : Number.NaN
      rateAgeHours = Number.isFinite(effectiveMs) ? Math.max(0, (Date.now() - effectiveMs) / 3_600_000) : Number.POSITIVE_INFINITY
      const freshHours = Number(config.currencyRateFreshHours ?? 24)
      const maxStaleHours = Number(config.currencyRateMaxStaleHours ?? 168)
      if (rateAgeHours > maxStaleHours) {
        throw new CurrencyRateUnavailableError(`The latest ${normalizedCurrency}/${baseCurrency} rate is too old to use safely`, {
          from_currency: normalizedCurrency,
          to_currency: baseCurrency,
          reason: 'expired',
          age_hours: rateAgeHours,
          effective_at: rateEffectiveAt,
        })
      }
      isStale = rateAgeHours > freshHours
      rateSource = rateRecord.source || 'unknown'
      adjusted = adjusted / rate
    }

    return {
      amount: adjusted,
      rate,
      currency: baseCurrency,
      rate_source: rateSource,
      rate_effective_at: rateEffectiveAt,
      rate_age_hours: Number.isFinite(rateAgeHours) ? Number(rateAgeHours.toFixed(2)) : null,
      is_stale: isStale,
    }
  }

  async function listRates() {
    return dal.findAll(Collections.CURRENCY_RATES, () => true)
  }

  async function createRate(payload) {
    const item = {
      id: crypto.randomUUID(),
      from_currency: payload.from_currency,
      to_currency: payload.to_currency,
      rate: Number(payload.rate),
      source: payload.source || 'manual',
      source_config: payload.source_config || {},
      effective_at: payload.effective_at || new Date().toISOString(),
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
      data: payload.data || {},
    }
    rateCache.clear()
    return dal.insert(Collections.CURRENCY_RATES, item)
  }

  async function updateRate(id, payload) {
    rateCache.clear()
    let updatedRecord = null
    await dal.update(Collections.CURRENCY_RATES, (r) => r.id === id, (r) => {
      updatedRecord = {
        ...r,
        ...payload,
        rate: payload.rate !== undefined ? Number(payload.rate) : r.rate,
        source_config: payload.source_config ? { ...r.source_config, ...payload.source_config } : r.source_config,
        updated_at: new Date().toISOString(),
        data: { ...r.data, ...(payload.data || {}) },
      }
      return updatedRecord
    })
    return updatedRecord
  }

  async function deleteRate(id) {
    rateCache.clear()
    return dal.remove(Collections.CURRENCY_RATES, (r) => r.id === id)
  }

  async function refreshRates() {
    const sources = config.currencyRateSources || ['manual']
    for (const source of sources) {
      if (source === 'manual') continue
      try {
        const configuredRows = await dal.findAll(
          Collections.CURRENCY_RATES,
          (r) => r.source === source && r.source_config && Object.keys(r.source_config).length > 0
        )
        const latestConfigured = configuredRows.sort((a, b) => new Date(b.effective_at) - new Date(a.effective_at))[0]
        const provider = createCurrencyProvider(source, latestConfigured?.source_config || {})
        const fetched = await provider.fetchRate(config.baseCurrency === 'USD' ? 'LBP' : config.baseCurrency, config.baseCurrency)
        if (fetched && fetched.rate > 0) {
          await createRate({
            from_currency: config.baseCurrency === 'USD' ? 'LBP' : config.baseCurrency,
            to_currency: config.baseCurrency,
            rate: fetched.rate,
            source: fetched.source,
            effective_at: new Date().toISOString(),
          })
          logger.info({ source, rate: fetched.rate }, 'Refreshed currency rate')
          return fetched
        }
      } catch (err) {
        logger.warn({ source, err: err.message }, 'Currency rate provider failed; trying next')
      }
    }
    return null
  }

  return {
    getLatestRate,
    normalizeToUsd,
    listRates,
    createRate,
    updateRate,
    deleteRate,
    refreshRates,
  }
}
