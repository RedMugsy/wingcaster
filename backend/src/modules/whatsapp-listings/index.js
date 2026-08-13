/**
 * WhatsApp Listing Module registration.
 *
 * This module lets agents create property listings by sending photos, videos,
 * text, or voice messages over WhatsApp. It is subscription/credit-gated,
 * uses AI for extraction and caption generation, composites branded thumbnails,
 * and publishes approved listings to Instagram (and other social channels).
 *
 * The module only touches the core platform through the PlatformAdapter defined
 * in this directory. Removing the module should leave the core platform
 * compiling and running.
 */

import { createAiAdapter } from './infrastructure/ai/adapter.js'
import { createTemplateEngine } from './infrastructure/templates/engine.js'
import { getConfig } from './config.js'
import { getModuleLogger } from './logger.js'
import { createDefaultPlatformAdapter } from './platform-adapter.js'
import { createEntitlementService } from './application/entitlements.js'
import { createCreditService } from './application/credits.js'
import { createPipeline } from './application/pipeline.js'
import { createWebhookHandler } from './application/webhook.js'
import { registerAdminRoutes } from './interface/admin-routes.js'
import { registerAgencyRoutes } from './interface/agency-routes.js'
import { registerAgentRoutes } from './interface/agent-routes.js'
import { createQueue } from './infrastructure/queue.js'

export const MODULE_NAME = 'whatsapp-listings'

export function createModule({ platformAdapter, config: configOverride }) {
  const config = configOverride || getConfig()
  const logger = getModuleLogger()

  if (!config.enabled) {
    logger.info('WhatsApp Listing module is disabled via WHATSAPP_LISTINGS_ENABLED')
    return {
      enabled: false,
      health: () => ({ enabled: false }),
      registerRoutes: () => {},
      registerWorker: () => {},
      handleWebhook: () => ({ handled: false }),
    }
  }

  const adapter = platformAdapter || createDefaultPlatformAdapter()
  const entitlements = createEntitlementService({ adapter })
  const credits = createCreditService({ adapter })
  const aiAdapter = createAiAdapter({ config, logger })
  const templateEngine = createTemplateEngine({ config, logger })
  const pipeline = createPipeline({ adapter, entitlements, credits, aiAdapter, templateEngine, config, logger })
  const webhook = createWebhookHandler({ adapter, entitlements, credits, pipeline, config, logger })
  const queue = createQueue({ pipeline, config, logger })

  function registerRoutes(app) {
    registerAdminRoutes(app, { entitlements, credits, pipeline, config })
    registerAgencyRoutes(app, { entitlements, credits, pipeline, config })
    registerAgentRoutes(app, { entitlements, credits, pipeline, config })
  }

  function registerWorker() {
    queue.start()
  }

  function health() {
    return {
      enabled: true,
      ai_provider: config.aiProvider,
      instagram_real_publishing: config.instagramRealPublishing,
      queue_running: queue.isRunning(),
      storage_path: config.storagePath,
    }
  }

  return {
    enabled: true,
    health,
    registerRoutes,
    registerWorker,
    handleWebhook: webhook.handle,
    // Exposed for tests and diagnostics only.
    pipeline,
    queue,
  }
}

export { createDefaultPlatformAdapter } from './platform-adapter.js'
export { getConfig } from './config.js'
