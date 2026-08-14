function parseNumber(value, fallback) {
  const trimmed = String(value || '').trim()
  if (!trimmed) return fallback
  const parsed = Number(trimmed)
  return Number.isFinite(parsed) ? parsed : fallback
}

function parseMs(value, fallback) {
  const parsed = parseNumber(value, fallback)
  return parsed > 0 ? parsed : fallback
}

function parseBool(value, fallback) {
  if (value === undefined || value === null || value === '') return fallback
  return String(value).toLowerCase() === 'true'
}

export function getConfig() {
  return {
    enabled: process.env.MARKET_PRICING_ENABLED !== 'false',

    // Matching defaults
    defaultMatchConfig: {
      same_area: true,
      same_property_type: true,
      bed_range: 1,
      bath_range: 1,
      area_range_percent: 20,
      age_range_years: 5,
      max_days_since_listed: 180,
      max_comparables: 20,
      radius_meters: 5000,
    },

    // Currency normalization
    baseCurrency: process.env.MARKET_PRICING_BASE_CURRENCY || 'USD',
    defaultParallelRate: parseNumber(process.env.MARKET_PRICING_DEFAULT_PARALLEL_RATE, 90000),
    currencyRateSources: (process.env.MARKET_PRICING_CURRENCY_RATE_SOURCES || 'manual').split(',').map((s) => s.trim()).filter(Boolean),
    defaultCurrencyRateSource: process.env.MARKET_PRICING_DEFAULT_CURRENCY_RATE_SOURCE || 'manual',
    currencyRateFreshHours: parseNumber(process.env.MARKET_PRICING_RATE_FRESH_HOURS, 24),
    currencyRateMaxStaleHours: parseNumber(process.env.MARKET_PRICING_RATE_MAX_STALE_HOURS, 168),

    // Analysis cache
    analysisExpiryDays: parseNumber(process.env.MARKET_PRICING_ANALYSIS_EXPIRY_DAYS, 7),

    // Workers
    recalculationWorkerEnabled: parseBool(process.env.MARKET_PRICING_WORKER_ENABLED, true),
    recalculationWorkerIntervalMs: parseMs(process.env.MARKET_PRICING_WORKER_INTERVAL_MS, 86400000), // daily
    recalculationJobPollIntervalMs: parseMs(process.env.MARKET_PRICING_JOB_POLL_INTERVAL_MS, 15000),
    recalculationJobBatchSize: parseNumber(process.env.MARKET_PRICING_JOB_BATCH_SIZE, 25),
    recalculationJobMaxAttempts: parseNumber(process.env.MARKET_PRICING_JOB_MAX_ATTEMPTS, 3),
    trendWorkerIntervalMs: parseMs(process.env.MARKET_PRICING_TREND_WORKER_INTERVAL_MS, 86400000 * 30), // monthly

    // Seed
    seedDemoProperties: parseBool(process.env.MARKET_PRICING_SEED_DEMO, false),

    // WhatsApp integration
    whatsAppContextEnabled: parseBool(process.env.MARKET_PRICING_WHATSAPP_CONTEXT_ENABLED, true),

    // AI provider for market-context sentence (reuse WhatsApp adapter env vars)
    aiProvider: process.env.MARKET_PRICING_AI_PROVIDER || process.env.WHATSAPP_LISTINGS_AI_PROVIDER || 'gemini',
    fallbackAiProviders: (process.env.MARKET_PRICING_FALLBACK_AI_PROVIDERS || process.env.WHATSAPP_LISTINGS_FALLBACK_AI_PROVIDERS || 'gemini,openai')
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean),
  }
}
