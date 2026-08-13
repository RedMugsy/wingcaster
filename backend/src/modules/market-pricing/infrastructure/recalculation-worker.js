export function createRecalculationWorker({
  dal,
  adapter,
  analysisService,
  trendService,
  scraperService,
  currencyService,
  recalculationJobService,
  config,
  logger,
}) {
  let timer = null
  let running = false
  let lastMaintenanceAt = 0
  let lastTrendAt = 0
  let lastRunAt = null
  let lastError = null

  function start() {
    if (timer) return
    const pollIntervalMs = config.recalculationJobPollIntervalMs || 15000
    logger.info({ pollIntervalMs }, 'Starting Market Pricing recalculation worker')
    timer = setInterval(runTick, pollIntervalMs)
    if (typeof timer.unref === 'function') timer.unref()
    runTick({ forceMaintenance: true, forceTrends: true }).catch((err) => logger.error({ err: err.message }, 'Initial pricing worker tick failed'))
  }

  function stop() {
    if (timer) {
      clearInterval(timer)
      timer = null
    }
  }

  function isRunning() {
    return Boolean(timer)
  }

  async function runTick(options = {}) {
    if (running) {
      logger.debug('Pricing recalculation worker already running; skipping tick')
      return { skipped: true, reason: 'already_running' }
    }
    running = true
    const start = Date.now()
    const result = {
      currency_rates_refreshed: false,
      scraper_results: [],
      analyses_refreshed: 0,
      analyses_failed: 0,
      trend_snapshots_created: 0,
      recalculation_job: null,
      duration_ms: 0,
    }

    try {
      result.recalculation_job = await recalculationJobService?.processNextJob() || null

      const maintenanceDue = options.forceMaintenance || Date.now() - lastMaintenanceAt >= config.recalculationWorkerIntervalMs
      if (maintenanceDue) {
        try {
          const refreshed = await currencyService.refreshRates?.()
          result.currency_rates_refreshed = Boolean(refreshed)
        } catch (err) {
          logger.warn({ err: err.message }, 'Currency rate refresh failed; continuing with controlled stale-rate policy')
        }

        try {
          result.scraper_results = await scraperService.runScrapers() || []
        } catch (err) {
          logger.warn({ err: err.message }, 'Scraper run failed')
        }

        const refreshResult = await refreshStaleAnalyses(options)
        result.analyses_refreshed = refreshResult.refreshed
        result.analyses_failed = refreshResult.failed
        lastMaintenanceAt = Date.now()
      }

      const trendsDue = options.forceTrends || Date.now() - lastTrendAt >= config.trendWorkerIntervalMs
      if (trendsDue) {
        try {
          const trendResult = await trendService.runAllSnapshots()
          result.trend_snapshots_created = trendResult?.created || 0
          lastTrendAt = Date.now()
        } catch (err) {
          logger.warn({ err: err.message }, 'Trend snapshot run failed')
        }
      }

      lastRunAt = new Date().toISOString()
      lastError = null
      logger.info(result, 'Pricing recalculation tick completed')
    } catch (err) {
      lastError = err.message
      logger.error({ err: err.message }, 'Pricing recalculation tick failed')
      throw err
    } finally {
      result.duration_ms = Date.now() - start
      running = false
    }

    return result
  }

  async function refreshStaleAnalyses(options = {}) {
    const batchSize = options.batchSize || 100
    const now = new Date().toISOString()

    // Load active properties that either have no cached analysis or have an expired one.
    const analyses = await dal.findAll('property_price_analyses', () => true)
    const expiredByProperty = new Map()
    for (const a of analyses) {
      if (!a.expires_at || a.expires_at <= now) {
        expiredByProperty.set(a.property_id, true)
      }
    }

    const activeProperties = await adapter.getProperties({ status: 'active' })
    const stalePropertyIds = activeProperties
      .filter((p) => !analyses.some((a) => a.property_id === p.id && a.expires_at > now))
      .map((p) => p.id)

    let refreshed = 0
    let failed = 0
    const toProcess = stalePropertyIds.slice(0, batchSize)

    for (const propertyId of toProcess) {
      try {
        await analysisService.getAnalysis(propertyId)
        refreshed++
      } catch (err) {
        failed++
        logger.warn({ err: err.message, propertyId }, 'Failed to refresh price analysis')
      }
    }

    return { refreshed, failed, total_stale: stalePropertyIds.length }
  }

  return {
    start,
    stop,
    isRunning,
    runTick,
    state: () => ({ running, last_run_at: lastRunAt, last_error: lastError }),
  }
}
