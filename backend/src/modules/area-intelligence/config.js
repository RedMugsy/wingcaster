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

export function getConfig() {
  return {
    enabled: process.env.AREA_INTELLIGENCE_ENABLED !== 'false',
    googleMapsApiKey: process.env.GOOGLE_MAPS_API_KEY || '',
    googleMapsBudgetUsdMonthly: parseNumber(process.env.GOOGLE_MAPS_BUDGET_USD_MONTHLY, 500),
    googleMapsRateLimitPerMinute: parseNumber(process.env.GOOGLE_MAPS_RATE_LIMIT_PER_MINUTE, 100),
    googleMapsEnabled: Boolean(process.env.GOOGLE_MAPS_API_KEY),
    aiProvider: process.env.AREA_INTELLIGENCE_AI_PROVIDER || 'gemini',
    scoringWorkerEnabled: process.env.AREA_INTELLIGENCE_SCORING_WORKER_ENABLED !== 'false',
    scoringWorkerIntervalMs: parseMs(process.env.AREA_INTELLIGENCE_SCORING_WORKER_INTERVAL_MS, 3600000), // 1 hour
    googleRefreshWorkerEnabled: process.env.AREA_INTELLIGENCE_GOOGLE_REFRESH_WORKER_ENABLED !== 'false',
    googleRefreshWorkerIntervalMs: parseMs(process.env.AREA_INTELLIGENCE_GOOGLE_REFRESH_WORKER_INTERVAL_MS, 86400000 * 30), // 30 days
    defaultRadii: { local: 3000, secondary: 5000, macro: 10000 },
  }
}
