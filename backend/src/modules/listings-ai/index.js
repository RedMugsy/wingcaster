/**
 * Listings AI module — direct photo → structured listing pipeline.
 *
 * Reuses the multi-provider AI adapter already built for the whatsapp-listings
 * module (Claude / OpenAI / Gemini / Kimi / DeepSeek / Qwen with circuit
 * breaker + fallback chain). This module adds a direct-upload entrypoint so
 * an agent inside the web/mobile app can drop photos and get a drafted
 * listing (title, description, extracted fields) without going through
 * WhatsApp intake.
 *
 * Removing this module leaves the WhatsApp path intact.
 */

import { pino } from 'pino'
import { createAiAdapter } from '../whatsapp-listings/infrastructure/ai/adapter.js'
import { registerListingsAiRoutes } from './routes.js'

export const MODULE_NAME = 'listings-ai'

function getConfig() {
  const env = (key, fallback = '') => process.env[key] ?? fallback
  const provider = env('LISTINGS_AI_PROVIDER', env('WHATSAPP_LISTINGS_AI_PROVIDER', 'claude')).toLowerCase()
  const fallbackAiProviders = env(
    'LISTINGS_AI_FALLBACK_PROVIDERS',
    env('WHATSAPP_LISTINGS_FALLBACK_AI_PROVIDERS', 'claude,openai,gemini'),
  )
    .split(',').map((s) => s.trim()).filter(Boolean)
  return {
    enabled: env('LISTINGS_AI_ENABLED', 'true') === 'true',
    aiProvider: provider,
    fallbackAiProviders,
    maxPhotos: Math.max(1, Math.min(20, Number(env('LISTINGS_AI_MAX_PHOTOS', 12)))),
    timeoutMs: Math.max(5000, Number(env('LISTINGS_AI_TIMEOUT_MS', 45000))),
  }
}

export function createModule() {
  const config = getConfig()
  const logger = pino({
    name: MODULE_NAME,
    level: process.env.LISTINGS_AI_LOG_LEVEL || process.env.LOG_LEVEL || 'info',
  })

  if (!config.enabled) {
    logger.info('listings-ai module disabled via LISTINGS_AI_ENABLED')
    return {
      enabled: false,
      registerRoutes: () => {},
    }
  }

  const aiAdapter = createAiAdapter({ config, logger })

  return {
    enabled: true,
    config,
    logger,
    aiAdapter,
    registerRoutes(app, { authMiddleware, emitUsageEventAsync } = {}) {
      registerListingsAiRoutes(app, {
        aiAdapter,
        config,
        logger,
        authMiddleware,
        emitUsageEventAsync,
      })
    },
  }
}
