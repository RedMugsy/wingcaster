/**
 * emitUsageEvent — the single call every meterable endpoint makes.
 *
 * SPEC §6: "every meterable action must emit a usage event from day one,
 * including the free ones, at a rate of zero."
 *
 * Fire-and-forget from the caller's perspective — never blocks the
 * primary action, never throws. Errors are logged via the injected
 * logger; missing rate-card entries default to 0 casts (rate-0 event
 * still written for telemetry).
 */

import { v4 as uuidv4 } from 'uuid'
import { insert } from '../db.js'
import { resolveActionCost, RATE_CARD_LATEST_VERSION, CAST_VALUE_MINOR_SEED } from './rate-card.js'
import { resolveActiveSubscription, meteredRateOverride } from './entitlements.js'
import { recordConsumption, currentBillingPeriod } from './ledger.js'

let injectedLogger = null

/**
 * Called once from server.js boot to attach the shared logger.
 */
export function setBillingLogger(logger) {
  injectedLogger = logger
}

/**
 * Emit a usage event. All fields except actionKey + tenantId are optional.
 *
 * @param {string} actionKey       — from the §6 catalog
 * @param {string} tenantId        — the agent/agency being metered
 * @param {number} quantity        — default 1
 * @param {string} country         — required for messaging events
 * @param {string} whatsappCategory — 'utility_service' | 'marketing'
 * @param {string} channel         — the source channel (instagram, whatsapp, ...)
 * @param {string} listingId       — the listing this action relates to, if any
 * @param {string} conversationId  — the conversation this action relates to, if any
 * @param {string} distributionId  — the distribution row this action relates to, if any
 * @param {object} metadata        — free-form additional context
 */
export async function emitUsageEvent({
  actionKey,
  tenantId,
  quantity = 1,
  country = null,
  whatsappCategory = null,
  channel = null,
  listingId = null,
  conversationId = null,
  distributionId = null,
  metadata = null,
}) {
  if (!actionKey || !tenantId) {
    injectedLogger?.warn({ actionKey, tenantId }, 'emitUsageEvent skipped — missing actionKey or tenantId')
    return null
  }

  try {
    // Resolve the tenant's subscription to pick up any per-plan metered
    // rate override. Falls back to the standard rate card if none.
    const active = await resolveActiveSubscription(tenantId)
    const rateCardVersion = active?.subscription?.rate_card_version || RATE_CARD_LATEST_VERSION
    const castValueMinor = active?.subscription?.cast_value_minor || CAST_VALUE_MINOR_SEED

    const override = await meteredRateOverride(tenantId, actionKey)
    const cost = override != null
      ? { casts_charged: 0, price_minor: Math.round(override * (quantity || 1)), cogs_estimate_minor: 0 }
      : resolveActionCost({
          actionKey, quantity, country, whatsappCategory,
          rateCardVersion, castValueMinor,
        })

    const event = {
      id: uuidv4(),
      tenant_id: tenantId,
      subscription_id: active?.subscription?.id || null,
      action_key: actionKey,
      quantity: Math.max(1, Number(quantity) || 1),
      channel,
      destination_country: country,
      whatsapp_category: whatsappCategory,
      listing_id: listingId,
      conversation_id: conversationId,
      distribution_id: distributionId,
      casts_charged: cost.casts_charged,
      price_minor: cost.price_minor,
      cogs_estimate_minor: cost.cogs_estimate_minor,
      rate_card_version: rateCardVersion,
      cast_value_minor: castValueMinor,
      metadata: metadata || {},
      occurred_at: new Date().toISOString(),
      billing_period: currentBillingPeriod(),
    }
    await insert('usage_events', event)

    // If this event has cost AND the tenant is on a plan that meters this
    // as a quota (e.g. WhatsApp outbound), record the consumption against
    // the tenant's ledger balance for the current period.
    const quotaKeyForAction = QUOTA_KEY_FOR_ACTION[actionKey]
    if (quotaKeyForAction && cost.casts_charged > 0 && active?.subscription?.id) {
      await recordConsumption({
        tenantId,
        subscriptionId: active.subscription.id,
        quotaKey: quotaKeyForAction,
        amount: quantity,
        sourceEventId: event.id,
        metadata: { action_key: actionKey, casts: cost.casts_charged, country, channel },
      })
    }

    return event
  } catch (err) {
    // Never block the primary action on a metering failure.
    injectedLogger?.error({ err: err.message, actionKey, tenantId }, 'emitUsageEvent write failed')
    return null
  }
}

/**
 * Fire-and-forget wrapper — the standard call site from HTTP endpoints
 * that don't want to await the write.
 */
export function emitUsageEventAsync(input) {
  void emitUsageEvent(input).catch(() => { /* already logged inside */ })
}

/**
 * Map an action_key to the quota_key it consumes. Only the actions that
 * are quota-bounded are here — everything else emits an event but never
 * touches the ledger.
 */
const QUOTA_KEY_FOR_ACTION = {
  'message.out.whatsapp.utility':   'outbound_whatsapp',
  'message.out.whatsapp.marketing': 'outbound_whatsapp',
  'publish.x.plain':                'x_posts',
  'publish.x.link':                 'x_posts',
  'publish.rpa':                    'portal_publishes',
  'render.template.premium':        'template_renders_premium',
  'score.property.fresh':           'property_scores_fresh',
  'avm.report':                     'avm_reports',
  'staging.ai_image':               'staging_images',
  'ai.reply.drafted':               'ai_reply_drafts',
  'ai.chat.turn':                   'ai_chat_turns',
  'listing.active_day':             'active_listings', // 1 per listing per day
}

export function quotaKeyForAction(actionKey) {
  return QUOTA_KEY_FOR_ACTION[actionKey] || null
}
