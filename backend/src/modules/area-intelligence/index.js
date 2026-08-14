import { getConfig } from './config.js'
import { getModuleLogger } from './logger.js'
import { createDefaultPlatformAdapter } from './platform-adapter.js'
import { createAreaService } from './application/area-service.js'
import { createDimensionService } from './application/dimension-service.js'
import { createSourceTypeService } from './application/source-type-service.js'
import { createSourceService } from './application/source-service.js'
import { createSignalService } from './application/signal-service.js'
import { createScoreService } from './application/score-service.js'
import { createAiConfigService } from './application/ai-config-service.js'
import { createGoogleService } from './application/google-service.js'
import { createInspectorService } from './application/inspector-service.js'
import { createScoringWorker } from './infrastructure/scoring-worker.js'
import { createGoogleRefreshWorker } from './infrastructure/google-refresh-worker.js'
import { seedAreaIntelligenceDefaults } from './application/seed.js'
import { registerAdminRoutes } from './interface/admin-routes.js'
import { registerInspectorRoutes } from './interface/inspector-routes.js'
import { registerPublicRoutes } from './interface/public-routes.js'

export const MODULE_NAME = 'area-intelligence'

export function createModule({ platformAdapter, config: configOverride }) {
  const config = configOverride || getConfig()
  const logger = getModuleLogger()

  if (!config.enabled) {
    logger.info('Area Intelligence module is disabled via AREA_INTELLIGENCE_ENABLED')
    return {
      enabled: false,
      health: () => ({ enabled: false }),
      registerRoutes: () => {},
      registerWorkers: () => {},
    }
  }

  const adapter = platformAdapter || createDefaultPlatformAdapter()

  const areaService = createAreaService({ adapter, config, logger })
  const dimensionService = createDimensionService({ config, logger })
  const sourceTypeService = createSourceTypeService({ config, logger })
  const sourceService = createSourceService({ config, logger })
  const signalService = createSignalService({ config, logger })
  const scoreService = createScoreService({ adapter, config, logger })
  const aiConfigService = createAiConfigService({ config, logger })
  const googleService = createGoogleService({ config, logger })
  const inspectorService = createInspectorService({ adapter, config, logger })

  const scoringWorker = createScoringWorker({
    areaService,
    dimensionService,
    signalService,
    scoreService,
    inspectorService,
    aiConfigService,
    config,
    logger,
  })

  const googleRefreshWorker = createGoogleRefreshWorker({
    areaService,
    sourceTypeService,
    sourceService,
    signalService,
    googleService,
    config,
    logger,
  })

  async function seed() {
    try {
      await seedAreaIntelligenceDefaults()
      logger.info('Area Intelligence default seed completed')
    } catch (err) {
      logger.error({ err: err.message }, 'Area Intelligence default seed failed')
      throw err
    }
  }

  function registerRoutes(app) {
    registerAdminRoutes(app, {
      areaService,
      dimensionService,
      sourceTypeService,
      sourceService,
      signalService,
      scoreService,
      aiConfigService,
      googleService,
      inspectorService,
      googleRefreshWorker,
      config,
      logger,
    })
    registerInspectorRoutes(app, {
      inspectorService,
      areaService,
      dimensionService,
      config,
      logger,
    })
    registerPublicRoutes(app, {
      areaService,
      scoreService,
      dimensionService,
      googleService,
      adapter,
      config,
      logger,
    })
  }

  function registerWorkers() {
    if (config.scoringWorkerEnabled) scoringWorker.start()
    if (config.googleRefreshWorkerEnabled) googleRefreshWorker.start()
  }

  function health() {
    return {
      enabled: true,
      google_maps_enabled: config.googleMapsEnabled,
      ai_provider: config.aiProvider,
      scoring_worker_running: scoringWorker.isRunning(),
      google_refresh_worker_running: googleRefreshWorker.isRunning(),
    }
  }

  return {
    enabled: true,
    health,
    seed,
    registerRoutes,
    registerWorkers,
    services: {
      areaService,
      dimensionService,
      sourceTypeService,
      sourceService,
      signalService,
      scoreService,
      aiConfigService,
      googleService,
      inspectorService,
    },
  }
}

export { createDefaultPlatformAdapter } from './platform-adapter.js'
export { getConfig } from './config.js'
