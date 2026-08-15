import { v4 as uuidv4 } from 'uuid'
import { findAllModule, insertModule } from '../infrastructure/db.js'
import { createGoogleMapsClient } from '../infrastructure/google-client.js'

export function createGoogleService({ config, logger }) {
  const client = createGoogleMapsClient({
    apiKey: config.googleMapsApiKey,
    budgetUsdMonthly: config.googleMapsBudgetUsdMonthly,
    rateLimitPerMinute: config.googleMapsRateLimitPerMinute,
    onUsage: async (usage) => {
      await logUsage({ ...usage })
    },
  })

  async function isOverBudget() {
    const monthly = await getMonthlySpend()
    return monthly >= config.googleMapsBudgetUsdMonthly
  }
  async function listUsage({ areaId, limit = 100 } = {}) {
    const rows = await findAllModule('google_api_usage_log')
    let filtered = rows
    if (areaId) filtered = filtered.filter((r) => r.area_id === areaId)
    return filtered.slice(0, limit).sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())
  }

  /**
   * Accept both snake_case (google-client callback shape) and camelCase
   * (any direct in-app caller). The client fires `onUsage({operation,
   * endpoint, request_count, cost_estimate_usd, response_status,
   * error_message})`; before this fix the destructure only knew the
   * camelCase names, so cost/status/count all landed as null/undefined
   * and the monthly budget cap could never trip.
   */
  async function logUsage(usage = {}) {
    const areaId = usage.area_id ?? usage.areaId ?? null
    const operation = usage.operation ?? null
    const endpoint = usage.endpoint ?? null
    const requestCount = usage.request_count ?? usage.requestCount ?? 1
    const costEstimateUsd = usage.cost_estimate_usd ?? usage.costEstimateUsd ?? null
    const responseStatus = usage.response_status ?? usage.responseStatus ?? null
    const errorMessage = usage.error_message ?? usage.errorMessage ?? null
    const now = new Date().toISOString()
    return insertModule('google_api_usage_log', {
      id: uuidv4(),
      area_id: areaId,
      operation,
      endpoint,
      request_count: requestCount,
      cost_estimate_usd: costEstimateUsd,
      response_status: responseStatus,
      error_message: errorMessage,
      created_at: now,
      updated_at: now,
    })
  }

  async function getMonthlySpend() {
    const startOfMonth = new Date()
    startOfMonth.setDate(1)
    startOfMonth.setHours(0, 0, 0, 0)
    const rows = await findAllModule('google_api_usage_log')
    return rows
      .filter((r) => new Date(r.created_at) >= startOfMonth)
      .reduce((sum, r) => sum + (Number(r.cost_estimate_usd) || 0), 0)
  }

  async function listCachedScores(areaId) {
    return findAllModule('area_google_scores', (r) => r.area_id === areaId)
  }

  async function cacheScore(payload) {
    return insertModule('area_google_scores', {
      id: uuidv4(),
      area_id: payload.area_id,
      source_type_id: payload.source_type_id,
      query_radius_meters: payload.query_radius_meters,
      query_category: payload.query_category,
      results_count: payload.results_count,
      results_json: payload.results_json ? JSON.stringify(payload.results_json) : null,
      avg_rating: payload.avg_rating ?? null,
      total_user_ratings: payload.total_user_ratings ?? null,
      nearest_distance_meters: payload.nearest_distance_meters ?? null,
      fetched_at: new Date().toISOString(),
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })
  }

  async function fetchPlacesForArea(area, sourceType, radiusMeters) {
    if (!client.enabled) {
      throw new Error('Google Maps API key not configured')
    }
    if (await isOverBudget()) {
      throw new Error('Google Maps monthly budget cap reached')
    }

    const extractionConfig = typeof sourceType.extraction_config === 'string'
      ? JSON.parse(sourceType.extraction_config || '{}')
      : sourceType.extraction_config || {}
    const categories = extractionConfig.categories || []
    const results = []

    for (const category of categories) {
      try {
        const data = await client.nearbySearch({
          latitude: area.center_latitude,
          longitude: area.center_longitude,
          radius: radiusMeters,
          type: category,
        })
        results.push({
          category,
          radius: radiusMeters,
          count: data.results?.length || 0,
          results: data.results || [],
        })
      } catch (err) {
        logger.warn({ err: err.message, category, area: area.slug }, 'Google Places category fetch failed')
        results.push({ category, radius: radiusMeters, count: 0, error: err.message })
      }
    }

    return {
      results,
      total_count: results.reduce((sum, r) => sum + r.count, 0),
      status: 'OK',
    }
  }

  async function fetchDistancesForArea(area, sourceType) {
    if (!client.enabled) {
      throw new Error('Google Maps API key not configured')
    }
    if (await isOverBudget()) {
      throw new Error('Google Maps monthly budget cap reached')
    }

    const extractionConfig = typeof sourceType.extraction_config === 'string'
      ? JSON.parse(sourceType.extraction_config || '{}')
      : sourceType.extraction_config || {}
    const mode = extractionConfig.mode || 'walking'
    const origin = `${area.center_latitude},${area.center_longitude}`
    const destinationConfig = extractionConfig.destinations || extractionConfig.categories || []
    const destinations = destinationConfig.map((d) => {
      if (typeof d === 'string') return d
      return Array.isArray(d.keywords) ? d.keywords.join(' ') : d.type || d
    }).filter(Boolean)

    if (!destinations.length) {
      return { rows: [], status: 'NO_DESTINATIONS' }
    }

    const data = await client.distanceMatrix({
      origins: origin,
      destinations,
      mode,
    })

    return {
      rows: data.rows || [],
      destination_addresses: data.destination_addresses || [],
      status: data.status,
    }
  }

  return { listUsage, logUsage, getMonthlySpend, listCachedScores, cacheScore, fetchPlacesForArea, fetchDistancesForArea, isOverBudget }
}
