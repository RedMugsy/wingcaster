import { InputMethod, ArchetypeDefaults } from '../domain/types.js'

export function createGoogleRefreshWorker({
  areaService,
  sourceTypeService,
  sourceService,
  signalService,
  googleService,
  config,
  logger,
}) {
  let timer = null
  let running = false

  const GOOGLE_INPUT_METHODS = [
    InputMethod.GOOGLE_PLACES_API,
    InputMethod.GOOGLE_DISTANCE_MATRIX_API,
  ]

  async function tick() {
    if (!config.googleMapsEnabled) {
      logger.debug('Google refresh worker skipped: Google Maps not enabled')
      return
    }
    if (await googleService.isOverBudget()) {
      logger.warn('Google refresh worker skipped: monthly budget cap reached')
      return
    }

    const areas = await areaService.list({ status: 'scoring_enabled' })
    if (!areas.items.length) {
      logger.debug('Google refresh worker: no scoring-enabled areas')
      return
    }

    const sourceTypes = (await sourceTypeService.list({ isActive: true })).filter((st) =>
      GOOGLE_INPUT_METHODS.includes(st.input_method)
    )
    if (!sourceTypes.length) {
      logger.debug('Google refresh worker: no active Google source types')
      return
    }

    for (const area of areas.items) {
      try {
        await refreshArea(area, sourceTypes)
      } catch (err) {
        logger.error({ err: err.message, area: area.slug }, 'Google refresh failed for area')
      }
    }
  }

  async function refreshArea(area, sourceTypes) {
    const areaSources = await sourceService.listForArea(area.id)
    for (const sourceType of sourceTypes) {
      if (await googleService.isOverBudget()) {
        logger.warn('Google refresh worker halted: monthly budget cap reached mid-run')
        return
      }

      let areaSource = areaSources.find((s) => s.source_type_id === sourceType.id)
      if (!areaSource) {
        areaSource = await sourceService.create({
          area_id: area.id,
          source_type_id: sourceType.id,
          name: `${sourceType.name} — ${area.name}`,
          is_monitored: true,
        })
      }

      const extractionConfig = parseJson(sourceType.extraction_config) || {}
      const dimensionSlug = extractionConfig.dimension_slug || inferDimensionSlug(sourceType.slug)
      const reliability = Number(
        areaSource.reliability_override ?? sourceType.default_reliability ?? 0.8
      )
      const weight = Number.isFinite(reliability) ? reliability : 0.8

      if (sourceType.input_method === InputMethod.GOOGLE_PLACES_API) {
        await refreshPlaces(area, sourceType, areaSource, dimensionSlug, weight)
      } else if (sourceType.input_method === InputMethod.GOOGLE_DISTANCE_MATRIX_API) {
        await refreshDistances(area, sourceType, areaSource, dimensionSlug, weight)
      }

      await sourceService.update(areaSource.id, { last_fetched_at: new Date().toISOString() })
    }
  }

  async function refreshPlaces(area, sourceType, areaSource, dimensionSlug, weight) {
    const extractionConfig = parseJson(sourceType.extraction_config) || {}
    const radii = Array.isArray(extractionConfig.radii_meters)
      ? extractionConfig.radii_meters
      : [config.defaultRadii.local, config.defaultRadii.secondary, config.defaultRadii.macro]

    for (const radius of radii) {
      try {
        const result = await googleService.fetchPlacesForArea(area, sourceType, radius)
        await googleService.cacheScore({
          area_id: area.id,
          source_type_id: sourceType.id,
          query_radius_meters: radius,
          query_category: 'places_aggregate',
          results_count: result.total_count,
          results_json: result.results,
          fetched_at: new Date().toISOString(),
        })

        for (const categoryResult of result.results || []) {
          const count = Number(categoryResult.count) || 0
          const value = Math.min(count, 20)
          await signalService.create({
            area_id: area.id,
            area_source_id: areaSource.id,
            source_type_id: sourceType.id,
            signal_type: 'google_places_count',
            raw_content: JSON.stringify(categoryResult),
            extracted_features: {
              dimension_slug: dimensionSlug,
              category: categoryResult.category,
              radius_meters: radius,
              count,
              value,
              max: 20,
              weight,
            },
            occurred_at: new Date().toISOString(),
            status: 'extracted',
          })
        }
      } catch (err) {
        logger.warn(
          { err: err.message, area: area.slug, sourceType: sourceType.slug, radius },
          'Google Places refresh failed'
        )
      }
    }
  }

  async function refreshDistances(area, sourceType, areaSource, dimensionSlug, weight) {
    try {
      const result = await googleService.fetchDistancesForArea(area, sourceType)
      await googleService.cacheScore({
        area_id: area.id,
        source_type_id: sourceType.id,
        query_radius_meters: null,
        query_category: 'distance_matrix',
        results_count: (result.rows || []).length,
        results_json: result.rows,
        fetched_at: new Date().toISOString(),
      })

      const extractionConfig = parseJson(sourceType.extraction_config) || {}
      const destinationConfig = Array.isArray(extractionConfig.destinations)
        ? extractionConfig.destinations
        : []
      const categories = Array.isArray(extractionConfig.categories)
        ? extractionConfig.categories.map((c) => ({ type: c }))
        : []
      const destinations = [...destinationConfig, ...categories]

      for (let i = 0; i < (result.rows || []).length; i++) {
        const row = result.rows[i]
        const elements = row?.elements || []
        for (let j = 0; j < elements.length && j < destinations.length; j++) {
          const element = elements[j]
          const destination = destinations[j] || { type: `dest_${j}` }
          const distanceMeters = element?.distance?.value ?? null
          const durationSeconds = element?.duration?.value ?? null
          const status = element?.status || 'UNKNOWN'

          let value = null
          let max = null
          if (status === 'OK' && Number.isFinite(distanceMeters)) {
            const clamped = Math.max(0, Math.min(distanceMeters, 10000))
            value = (10000 - clamped) / 1000
            max = 10
          }

          if (value === null) continue

          await signalService.create({
            area_id: area.id,
            area_source_id: areaSource.id,
            source_type_id: sourceType.id,
            signal_type: 'google_distance_matrix',
            raw_content: JSON.stringify({ row, element, destination }),
            extracted_features: {
              dimension_slug: dimensionSlug,
              destination_type: destination.type || destination,
              distance_meters: distanceMeters,
              duration_seconds: durationSeconds,
              value,
              max,
              weight,
            },
            occurred_at: new Date().toISOString(),
            status: 'extracted',
          })
        }
      }
    } catch (err) {
      logger.warn(
        { err: err.message, area: area.slug, sourceType: sourceType.slug },
        'Google Distance Matrix refresh failed'
      )
    }
  }

  function inferDimensionSlug(sourceTypeSlug) {
    const map = {
      google_places_proximity: 'proximity_accessibility',
      google_places_education: 'education_access',
      google_places_fitness: 'fitness_recreation',
      google_places_medical: 'medical_access',
      google_places_fnbar: 'fnb_scene',
      google_distance_walking: 'walking_score',
      google_distance_driving: 'proximity_accessibility',
    }
    return map[sourceTypeSlug] || null
  }

  function parseJson(value) {
    if (typeof value === 'string') {
      try {
        return JSON.parse(value)
      } catch {
        return null
      }
    }
    return value
  }

  function start() {
    if (timer) return
    // Node's setInterval uses a 32-bit signed delay; cap to ~24.8 days.
    const intervalMs = Math.min(config.googleRefreshWorkerIntervalMs, 2147483647)
    logger.info({ intervalMs }, 'Google refresh worker started')
    timer = setInterval(() => {
      tick().catch((err) => logger.error({ err: err.message }, 'Google refresh worker tick failed'))
    }, intervalMs)
    running = true
  }

  function stop() {
    if (!timer) return
    clearInterval(timer)
    timer = null
    running = false
    logger.info('Google refresh worker stopped')
  }

  function isRunning() {
    return running && !!timer
  }

  /**
   * Manually run the Google refresh for a single area. Bypasses the
   * schedule so the admin UI can trigger an on-demand fetch (used by
   * "Fetch Google signals now" per-area button). Still respects the
   * monthly budget cap.
   */
  async function refreshOneArea(areaId) {
    if (!config.googleMapsEnabled) throw new Error('Google Maps API key not configured')
    if (await googleService.isOverBudget()) throw new Error('Google Maps monthly budget cap reached')
    const area = await areaService.getById(areaId)
    if (!area) throw new Error('Area not found')
    if (area.status !== 'scoring_enabled') throw new Error('Area is not scoring_enabled — enable it first')
    const sourceTypes = (await sourceTypeService.list({ isActive: true })).filter((st) =>
      GOOGLE_INPUT_METHODS.includes(st.input_method)
    )
    if (!sourceTypes.length) return { area_id: areaId, source_types: 0, signals_after: 0 }
    const before = (await signalService.list({ areaId, limit: 1 })).total || 0
    await refreshArea(area, sourceTypes)
    const after = (await signalService.list({ areaId, limit: 1 })).total || 0
    return {
      area_id: areaId,
      source_types: sourceTypes.length,
      signals_before: before,
      signals_after: after,
      signals_created: Math.max(0, after - before),
    }
  }

  return { start, stop, isRunning, tick, refreshOneArea }
}
