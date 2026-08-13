import { AreaStatus } from '../domain/types.js'

export function createScoringWorker({
  areaService,
  dimensionService,
  scoreService,
  signalService,
  inspectorService,
  aiConfigService,
  config,
  logger,
}) {
  let timer = null
  let running = false

  async function tick() {
    const areas = await areaService.list({ status: AreaStatus.SCORING_ENABLED, limit: 10000 })
    if (!areas.items.length) {
      logger.debug('Scoring worker: no scoring-enabled areas')
      return
    }

    const dimensions = await dimensionService.list({ isActive: true })
    if (!dimensions.length) {
      logger.debug('Scoring worker: no active dimensions')
      return
    }

    const aiConfig = await aiConfigService.getActive()

    for (const area of areas.items) {
      try {
        await scoreArea(area, dimensions, aiConfig)
      } catch (err) {
        logger.error({ err: err.message, area: area.slug }, 'Scoring failed for area')
      }
    }
  }

  async function scoreArea(area, dimensions, aiConfig) {
    const signals = await signalService.list({ areaId: area.id, limit: 10000 })
    const submissions = await inspectorService.listSubmissions({
      areaId: area.id,
      status: 'approved',
      limit: 10000,
    })

    await scoreService.calculateForArea(area, dimensions, {
      signals: signals.items || [],
      submissions: submissions || [],
      aiConfig,
    })

    logger.info({ area: area.slug }, 'Area scores recalculated')
  }

  function start() {
    if (timer) return
    // Node's setInterval uses a 32-bit signed delay; cap to ~24.8 days.
    const intervalMs = Math.min(config.scoringWorkerIntervalMs, 2147483647)
    logger.info({ intervalMs }, 'Scoring worker started')
    timer = setInterval(() => {
      tick().catch((err) => logger.error({ err: err.message }, 'Scoring worker tick failed'))
    }, intervalMs)
    running = true
  }

  function stop() {
    if (!timer) return
    clearInterval(timer)
    timer = null
    running = false
    logger.info('Scoring worker stopped')
  }

  function isRunning() {
    return running && !!timer
  }

  return { start, stop, isRunning, tick }
}
