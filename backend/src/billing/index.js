/**
 * Billing module — public entrypoint.
 *
 * Phase 7a scope: emit + persist usage events + read tenant + admin
 * telemetry. No charging, no subscriptions, no gating. Ships the
 * infrastructure so every action from the emitter-wire-up (Phase 7a2)
 * onward accumulates telemetry from day zero — the "single most
 * important instruction" of the commercial-model spec §6.
 */

import { pino } from 'pino'
import { registerBillingRoutes, makePlatformAdminGuard } from './routes.js'
import { setBillingLogger, emitUsageEvent, emitUsageEventAsync, quotaKeyForAction } from './events.js'
import { RATE_CARD_LATEST_VERSION, CAST_VALUE_MINOR_SEED, CAST_RATES_V1, resolveActionCost } from './rate-card.js'
import { estimateCogsUsd, WHATSAPP_COST_BY_COUNTRY, SMS_COST_BY_COUNTRY, SMS_MARKUP_PCT } from './cogs-lookup.js'
import { grantAllowance, recordConsumption, recordTopup, recordAdjustment, periodSummary, quotaBalance, currentBillingPeriod } from './ledger.js'
import { hasFeature, quotaState, meteredRateOverride, resolveActiveSubscription, KNOWN_FEATURES, KNOWN_QUOTAS, ENTITLEMENT_TYPES } from './entitlements.js'
import {
  registerPricingRoutes, seedPricingHierarchy,
  resolveMarketContext, resolveEffectivePrice, effectiveCastValueMinor,
  getActiveRateCard, listTerritories, listZones, listCities,
} from './pricing/index.js'
import { registerProductCatalogRoutes, startRenewalScheduler } from './products/index.js'
import { registerNotificationRoutes } from './notifications/index.js'

export const MODULE_NAME = 'billing'

export function createModule() {
  const enabled = process.env.BILLING_MODULE_ENABLED !== 'false'
  const logger = pino({
    name: MODULE_NAME,
    level: process.env.BILLING_LOG_LEVEL || process.env.LOG_LEVEL || 'info',
  })

  if (!enabled) {
    return { enabled: false, registerRoutes: () => {}, prepare: async () => {} }
  }

  setBillingLogger(logger)

  return {
    enabled: true,
    logger,
    async prepare() {
      try {
        await seedPricingHierarchy()
      } catch (err) {
        logger.warn({ err: err.message }, 'pricing hierarchy seed failed — territories/zones/rate-card may need manual setup')
      }
      try {
        const schedulerIntervalMs = Number(process.env.BILLING_SCHEDULER_INTERVAL_MS || 15 * 60 * 1000)
        const schedulerBatchSize = Number(process.env.BILLING_SCHEDULER_BATCH_SIZE || 50)
        const startResult = await startRenewalScheduler({ intervalMs: schedulerIntervalMs, batchSize: schedulerBatchSize })
        logger.info(startResult, 'billing subscription renewal scheduler boot')
      } catch (err) {
        logger.warn({ err: err.message }, 'renewal scheduler failed to boot — subscriptions will not auto-renew on this instance')
      }
      logger.info({
        rate_card_version: RATE_CARD_LATEST_VERSION,
        cast_value_minor: CAST_VALUE_MINOR_SEED,
        action_count: Object.keys(CAST_RATES_V1).length,
      }, 'billing module ready — Phase 7a/7b/7c active')
    },
    registerRoutes(app, { authMiddleware, isPlatformAdmin } = {}) {
      const requirePlatformAdmin = isPlatformAdmin ? makePlatformAdminGuard(isPlatformAdmin) : null
      registerBillingRoutes(app, { authMiddleware, requirePlatformAdmin })
      registerPricingRoutes(app, { authMiddleware, requirePlatformAdmin })
      registerProductCatalogRoutes(app, { authMiddleware, requirePlatformAdmin })
      registerNotificationRoutes(app, { authMiddleware, requirePlatformAdmin })
    },
  }
}

// Re-exports so server.js and downstream modules can emit events + read
// state without importing individual files.
export {
  emitUsageEvent,
  emitUsageEventAsync,
  quotaKeyForAction,
  resolveActionCost,
  estimateCogsUsd,
  grantAllowance,
  recordConsumption,
  recordTopup,
  recordAdjustment,
  periodSummary,
  quotaBalance,
  currentBillingPeriod,
  hasFeature,
  quotaState,
  meteredRateOverride,
  resolveActiveSubscription,
  KNOWN_FEATURES,
  KNOWN_QUOTAS,
  ENTITLEMENT_TYPES,
  RATE_CARD_LATEST_VERSION,
  CAST_VALUE_MINOR_SEED,
  CAST_RATES_V1,
  WHATSAPP_COST_BY_COUNTRY,
  SMS_COST_BY_COUNTRY,
  SMS_MARKUP_PCT,
  // Phase 7b pricing hierarchy
  resolveMarketContext,
  resolveEffectivePrice,
  effectiveCastValueMinor,
  getActiveRateCard,
  listTerritories,
  listZones,
  listCities,
  seedPricingHierarchy,
}
