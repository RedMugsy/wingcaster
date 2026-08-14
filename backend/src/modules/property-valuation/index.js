/**
 * Market Pricing Intelligence module.
 *
 * Provides comparable-property analysis, transparent price-range guidance,
 * quarterly trend snapshots, and pricing context for the WhatsApp listing
 * approval flow.
 */

import { getConfig } from './config.js'
import { getModuleLogger } from './logger.js'
import { createDefaultPlatformAdapter } from './platform-adapter.js'
import { createModuleDal } from './infrastructure/db.js'
import { createConfigService } from './application/config-service.js'
import { createCurrencyService } from './application/currency-service.js'
import { createComparableService } from './application/comparable-service.js'
import { createAnalysisService } from './application/analysis-service.js'
import { createTrendService } from './application/trend-service.js'
import { createScraperService } from './application/scraper-service.js'
import { createRecalculationJobService } from './application/recalculation-job-service.js'
import { createWhatsAppContextBuilder } from './application/whatsapp-context.js'
import { createAiAdapter } from './infrastructure/ai-adapter.js'
import { createRecalculationWorker } from './infrastructure/recalculation-worker.js'
import { registerAdminRoutes } from './interface/admin-routes.js'
import { registerPublicRoutes } from './interface/public-routes.js'
import { registerRoleRoutes } from './interface/role-routes.js'
import { seedMarketPricingDefaults } from './application/seed.js'

export const MODULE_NAME = 'property-valuation'

export function createModule({ platformAdapter, config: configOverride, dal: dalOverride } = {}) {
  const config = configOverride || getConfig()
  const logger = getModuleLogger()

  if (!config.enabled) {
    logger.info('Market Pricing module is disabled via MARKET_PRICING_ENABLED')
    return {
      enabled: false,
      health: () => ({ enabled: false }),
      registerRoutes: () => {},
      registerWorkers: () => {},
      seed: () => {},
    }
  }

  const adapter = platformAdapter || createDefaultPlatformAdapter()
  const dal = dalOverride || createModuleDal()

  const configService = createConfigService({ dal, config, logger })
  const currencyService = createCurrencyService({ dal, config, logger })
  const aiAdapter = createAiAdapter({ config, logger })
  const comparableService = createComparableService({ dal, adapter, currencyService, config, logger })
  const analysisService = createAnalysisService({
    dal,
    adapter,
    configService,
    currencyService,
    comparableService,
    aiAdapter,
    config,
    logger,
  })
  const trendService = createTrendService({ dal, adapter, currencyService, config, logger })
  const scraperService = createScraperService({ dal, aiAdapter, currencyService, config, logger })
  const recalculationJobService = createRecalculationJobService({
    dal,
    adapter,
    comparableService,
    analysisService,
    config,
    logger,
  })
  const whatsAppContext = createWhatsAppContextBuilder({ analysisService, config, logger })

  const recalculationWorker = createRecalculationWorker({
    dal,
    adapter,
    analysisService,
    trendService,
    scraperService,
    currencyService,
    recalculationJobService,
    config,
    logger,
  })

  async function seed() {
    try {
      await seedMarketPricingDefaults({ dal, config, logger })
      logger.info('Market Pricing default seed completed')
    } catch (err) {
      logger.error({ err: err.message }, 'Market Pricing default seed failed')
      throw err
    }
  }

  function registerRoutes(app) {
    registerPublicRoutes(app, {
      analysisService,
      comparableService,
      trendService,
      configService,
      adapter,
      dal,
      config,
      logger,
    })
    registerAdminRoutes(app, {
      configService,
      currencyService,
      comparableService,
      analysisService,
      trendService,
      scraperService,
      recalculationJobService,
      dal,
      adapter,
      config,
      logger,
    })
    registerRoleRoutes(app, {
      dal,
      analysisService,
      recalculationJobService,
      logger,
    })
  }

  function registerWorkers() {
    if (config.recalculationWorkerEnabled) recalculationWorker.start()
  }

  function health() {
    return {
      enabled: true,
      recalculation_worker_running: recalculationWorker.isRunning(),
      recalculation_worker: recalculationWorker.state(),
    }
  }

  return {
    enabled: true,
    health,
    seed,
    registerRoutes,
    registerWorkers,
    services: {
      configService,
      currencyService,
      comparableService,
      analysisService,
      trendService,
      scraperService,
      recalculationJobService,
      whatsAppContext,
    },
  }
}

export { createDefaultPlatformAdapter } from './platform-adapter.js'
export { getConfig } from './config.js'
