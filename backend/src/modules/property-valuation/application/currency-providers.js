/**
 * Configurable currency-rate providers for the Lebanese parallel market.
 *
 * Each provider implements:
 *   async fetchRate(fromCurrency, toCurrency) -> { rate: number, source: string } | null
 *
 * Providers must be respectful of public APIs: short timeouts, no retries on 4xx,
 * and clear attribution.
 */

const USER_AGENTS = [
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
]

function pickUserAgent() {
  return USER_AGENTS[Math.floor(Math.random() * USER_AGENTS.length)]
}

async function fetchJson(url, options = {}) {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), options.timeoutMs || 10000)
  try {
    const res = await fetch(url, {
      ...options,
      headers: {
        'User-Agent': pickUserAgent(),
        Accept: 'application/json',
        ...(options.headers || {}),
      },
      signal: controller.signal,
    })
    clearTimeout(timeout)
    if (!res.ok) {
      throw new Error(`HTTP ${res.status}`)
    }
    const text = await res.text()
    if (!text) return null
    try {
      return JSON.parse(text)
    } catch {
      return text
    }
  } catch (err) {
    clearTimeout(timeout)
    throw err
  }
}

function createManualProvider() {
  return {
    name: 'manual',
    async fetchRate() {
      // Manual rates are stored by admins; this provider never auto-updates.
      return null
    },
  }
}

/**
 * LiraRate.org public API (unofficial, community-maintained).
 * Returns LBP per 1 USD on the parallel market.
 */
function createLiraRateProvider() {
  return {
    name: 'lira_rate',
    async fetchRate(fromCurrency, toCurrency) {
      if (String(fromCurrency).toUpperCase() !== 'LBP' || String(toCurrency).toUpperCase() !== 'USD') {
        return null
      }
      const data = await fetchJson('https://lirarate.org/wp-json/lirarate/v1/rates?currency=LBP', { timeoutMs: 8000 })
      // Shape observed: { rate: { buy: '89000', sell: '89500' }, ... }
      const raw = data?.rate?.sell || data?.rate?.buy || data?.rate
      const rate = Number(raw)
      if (!Number.isFinite(rate) || rate <= 0) {
        throw new Error(`Invalid LiraRate response: ${JSON.stringify(data).slice(0, 200)}`)
      }
      return { rate, source: 'lira_rate' }
    },
  }
}

/**
 * Sayrafa (official Lebanese central-bank platform). Requires an API contract
 * for production; this is a documented contract/placeholder.
 */
function createSayrafaProvider() {
  return {
    name: 'sayrafa',
    async fetchRate(fromCurrency, toCurrency) {
      if (String(fromCurrency).toUpperCase() !== 'LBP' || String(toCurrency).toUpperCase() !== 'USD') {
        return null
      }
      const apiUrl = process.env.SAYRAFA_API_URL
      const apiKey = process.env.SAYRAFA_API_KEY
      if (!apiUrl || !apiKey) {
        throw new Error('SAYRAFA_API_URL and SAYRAFA_API_KEY must be configured')
      }
      const data = await fetchJson(apiUrl, {
        headers: { Authorization: `Bearer ${apiKey}` },
        timeoutMs: 15000,
      })
      const rate = Number(data?.rate || data?.usd_rate)
      if (!Number.isFinite(rate) || rate <= 0) {
        throw new Error(`Invalid Sayrafa response: ${JSON.stringify(data).slice(0, 200)}`)
      }
      return { rate, source: 'sayrafa' }
    },
  }
}

/**
 * Custom admin-configured HTTP endpoint. The source config_json may contain
 * { url, method, headers, jsonPath }.
 */
function createCustomProvider(sourceConfig = {}) {
  return {
    name: 'custom',
    async fetchRate(fromCurrency, toCurrency) {
      const url = sourceConfig.url
      const jsonPath = sourceConfig.jsonPath || 'rate'
      if (!url) throw new Error('Custom provider missing url in config_json')
      const data = await fetchJson(url, {
        method: sourceConfig.method || 'GET',
        headers: sourceConfig.headers || {},
        timeoutMs: sourceConfig.timeoutMs || 10000,
      })
      const rate = Number(getPath(data, jsonPath))
      if (!Number.isFinite(rate) || rate <= 0) {
        throw new Error(`Custom provider returned invalid rate at ${jsonPath}: ${JSON.stringify(data).slice(0, 200)}`)
      }
      return { rate, source: 'custom' }
    },
  }
}

function getPath(obj, path) {
  return path.split('.').reduce((acc, key) => (acc && acc[key] !== undefined ? acc[key] : undefined), obj)
}

const PROVIDER_FACTORIES = {
  manual: createManualProvider,
  lira_rate: createLiraRateProvider,
  sayrafa: createSayrafaProvider,
  custom: createCustomProvider,
}

export function createCurrencyProvider(source, sourceConfig = {}) {
  const factory = PROVIDER_FACTORIES[source]
  if (!factory) {
    throw new Error(`Unknown currency rate provider: ${source}`)
  }
  return factory(sourceConfig)
}

export function listCurrencyProviderNames() {
  return Object.keys(PROVIDER_FACTORIES)
}
