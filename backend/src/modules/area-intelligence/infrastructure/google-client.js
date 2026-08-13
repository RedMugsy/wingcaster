import logger from '../../../lib/logger.js'

const GOOGLE_API_BASE = 'https://maps.googleapis.com/maps/api'

// In-memory rate limiter (per process). Resets every minute.
const rateLimiterState = {
  callsThisMinute: 0,
  windowStart: Date.now(),
}

function checkRateLimit(maxPerMinute) {
  const now = Date.now()
  if (now - rateLimiterState.windowStart >= 60000) {
    rateLimiterState.callsThisMinute = 0
    rateLimiterState.windowStart = now
  }
  if (rateLimiterState.callsThisMinute >= maxPerMinute) {
    return false
  }
  rateLimiterState.callsThisMinute++
  return true
}

export function createGoogleMapsClient({ apiKey, budgetUsdMonthly = 500, rateLimitPerMinute = 100, onUsage }) {
  if (!apiKey) {
    return {
      enabled: false,
      async nearbySearch() { throw new Error('Google Maps API key not configured') },
      async distanceMatrix() { throw new Error('Google Maps API key not configured') },
    }
  }

  async function googleFetch(endpoint, params) {
    if (!checkRateLimit(rateLimitPerMinute)) {
      const err = new Error('Google Maps rate limit exceeded')
      err.code = 'RATE_LIMIT'
      throw err
    }

    const url = new URL(`${GOOGLE_API_BASE}${endpoint}`)
    for (const [key, value] of Object.entries(params)) {
      if (value !== undefined && value !== null) url.searchParams.set(key, String(value))
    }
    url.searchParams.set('key', apiKey)

    const start = Date.now()
    let responseStatus = null
    let errorMessage = null
    try {
      const res = await fetch(url.toString())
      responseStatus = res.status
      const data = await res.json().catch(() => ({}))
      if (!res.ok || data.status !== 'OK') {
        errorMessage = data.error_message || data.status || `HTTP ${res.status}`
        const err = new Error(`Google Maps API error: ${errorMessage}`)
        err.code = data.status || `HTTP_${res.status}`
        err.details = data
        throw err
      }
      return data
    } finally {
      if (onUsage) {
        const costEstimate = estimateCost(endpoint)
        onUsage({
          operation: endpoint,
          endpoint: url.toString().replace(apiKey, '***'),
          request_count: 1,
          cost_estimate_usd: costEstimate,
          response_status: String(responseStatus || 'OK'),
          error_message: errorMessage,
        }).catch((e) => logger.error({ err: e.message }, 'Failed to log Google API usage'))
      }
    }
  }

  function estimateCost(endpoint) {
    if (endpoint.includes('/place/nearbysearch')) return 0.017
    if (endpoint.includes('/distancematrix')) return 0.005
    return 0.001
  }

  async function nearbySearch({ latitude, longitude, radius, keyword, type, pageToken }) {
    const params = {
      location: `${latitude},${longitude}`,
      radius,
      keyword,
      type,
      pagetoken: pageToken,
    }
    return googleFetch('/place/nearbysearch/json', params)
  }

  async function distanceMatrix({ origins, destinations, mode = 'walking' }) {
    const params = {
      origins: Array.isArray(origins) ? origins.join('|') : origins,
      destinations: Array.isArray(destinations) ? destinations.join('|') : destinations,
      mode,
    }
    return googleFetch('/distancematrix/json', params)
  }

  return {
    enabled: true,
    nearbySearch,
    distanceMatrix,
  }
}
