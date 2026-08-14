/**
 * Rate Card — the mapping from action_key → casts_charged, versioned.
 *
 * SPEC §7. Casts × cast_value = customer-facing price for an action.
 * Cast value default $0.10 (config §14). Included casts default 10/$1.
 *
 * Versioning: subscriptions pin `rate_card_version` at signup so a rate
 * card revision never re-prices existing customers without an explicit
 * migration campaign (§8 grandfathering rule).
 */

import { estimateCogsUsd } from './cogs-lookup.js'

export const RATE_CARD_LATEST_VERSION = 1
export const CAST_VALUE_MINOR_SEED = 10 // $0.10 as of 14 Aug 2026

// SPEC §6 event catalog. Casts values are [SEED].
// A value of 0 means "always emit but never charge" — the rule for AI
// generation + inbound messages that Wingcaster deliberately gives away.
export const CAST_RATES_V1 = {
  // Publishing
  'publish.meta.facebook':    1,
  'publish.meta.instagram':   1,
  'publish.linkedin':         1,
  'publish.tiktok':           1,
  'publish.portal.api':       1,
  'publish.rpa':              3,
  'publish.x.plain':          2,
  'publish.x.link':           8,
  'render.template.standard': 1,
  'render.template.premium':  1,

  // Messaging outbound
  'message.out.whatsapp.utility':   1,
  'message.out.whatsapp.marketing': 4,
  'message.out.meta_dm':            0, // meta DMs are free — spec §2
  'message.out.x_dm':               2,
  'message.out.sms':                0, // SMS priced separately: cost + 40%, never bundled
  'message.out.email':              0,

  // Messaging inbound — all rate 0, all emitted
  'message.in.whatsapp':    0,
  'message.in.meta_dm':     0,
  'message.in.x_dm':        0,
  'message.in.comment':     0,
  'message.in.portal_lead': 0,
  'webhook.received':       0,

  // AI — description + classification are FREE (§2 rationale). Reply drafting + chat are billed.
  'ai.description.generated': 0,
  'ai.classification':        0,
  'ai.reply.drafted':         1,
  'ai.chat.turn':             1,

  // Data & enrichment
  'score.property.cached': 1,
  'score.property.fresh':  8,
  'avm.report':            75,
  'staging.ai_image':      10,

  // State — emitted for measurement, never charged
  'listing.created':          0,
  'listing.published_first':  0,
  'listing.active_day':       0,
  'storage.gb_day':           0,
  'seat.active_day':          0,
  'support.ticket_opened':    0,
}

/**
 * Convert an action + quantity to casts charged, at a specific rate-card
 * version. Returns integer casts (customer-facing units).
 */
export function castsForAction({ actionKey, quantity = 1, rateCardVersion = RATE_CARD_LATEST_VERSION }) {
  const rates = rateCardTableForVersion(rateCardVersion)
  const rate = rates[actionKey]
  if (rate == null) return 0 // unknown action — never charge for something we don't recognise
  return Math.max(0, rate * Math.max(1, Number(quantity) || 1))
}

/**
 * Retail price in minor currency units (cents) for a cast quantity, at a
 * specific cast_value. `cast_value_minor` is per-tenant configurable
 * (spec §14) but defaults to CAST_VALUE_MINOR_SEED.
 */
export function priceMinorForCasts({ casts, castValueMinor = CAST_VALUE_MINOR_SEED }) {
  return Math.round((casts || 0) * (castValueMinor || CAST_VALUE_MINOR_SEED))
}

/**
 * Full retail resolution for an emitted action — casts + minor price +
 * cogs estimate. Used at ledger-write time to record both what we charge
 * AND what it costs us. The cogs field enables the mix table in §7 to be
 * self-correcting from real telemetry.
 */
export function resolveActionCost({
  actionKey, quantity = 1, country, whatsappCategory,
  rateCardVersion = RATE_CARD_LATEST_VERSION,
  castValueMinor = CAST_VALUE_MINOR_SEED,
}) {
  const casts = castsForAction({ actionKey, quantity, rateCardVersion })
  const priceMinor = priceMinorForCasts({ casts, castValueMinor })
  const cogsUsd = estimateCogsUsd({ actionKey, quantity, country, whatsappCategory })
  const cogsMinor = Math.round(cogsUsd * 100)
  return { casts_charged: casts, price_minor: priceMinor, cogs_estimate_minor: cogsMinor }
}

function rateCardTableForVersion(version) {
  if (version === 1) return CAST_RATES_V1
  return CAST_RATES_V1 // fallback to latest; when new versions are cut, add here
}

export const RATE_CARDS_BY_VERSION = { 1: CAST_RATES_V1 }
