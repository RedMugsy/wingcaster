/**
 * Effective-price resolver — the single formula every charging path
 * eventually calls.
 *
 * effective_cast_value_minor =
 *   core.cast_value_minor
 *   × territory.pricing_multiplier
 *   × zone.pricing_multiplier
 *
 * price_minor(action, quantity) =
 *   rates[action_key] × quantity × effective_cast_value_minor
 *
 * If Territory / Zone / CoreRateCard aren't set up yet (fresh install
 * before the seed runs) the resolver falls back to the CAST_RATES_V1
 * seed + CAST_VALUE_MINOR_SEED so Phase 7a keeps working uninterrupted.
 */

import { getActiveRateCard, getRateCardByVersion } from './core-rate-cards.js'
import { getTerritory, getTerritoryByCode } from './territories.js'
import { getZone } from './zones.js'
import { findCityByName } from './cities.js'
import { CAST_RATES_V1, CAST_VALUE_MINOR_SEED, RATE_CARD_LATEST_VERSION } from '../rate-card.js'
import { estimateCogsUsd } from '../cogs-lookup.js'

/**
 * Resolve a market context — the (territory, zone) pair for a signup or
 * an inferred country. Priority per spec §9.3 (anti-arbitrage):
 *   verifiedRegulatorId → billingCountry → listingCountry → fallback
 *
 * @param {object} ctx
 * @param {string} ctx.countryCode      ISO-2 country code
 * @param {string} ctx.city             free-text city name
 * @param {string} ctx.territoryId      explicit override (admin onboarding)
 * @param {string} ctx.zoneId           explicit override
 * @returns {Promise<{territory, zone, source}>}
 */
export async function resolveMarketContext(ctx = {}) {
  let territory = null
  let zone = null
  let source = 'fallback'

  if (ctx.territoryId) {
    territory = await getTerritory(ctx.territoryId)
    source = 'explicit'
  } else if (ctx.countryCode) {
    territory = await getTerritoryByCode(ctx.countryCode)
    source = 'country_code'
  }

  if (territory) {
    if (ctx.zoneId) {
      const explicit = await getZone(ctx.zoneId)
      if (explicit && explicit.territory_id === territory.id && explicit.active !== false) {
        zone = explicit
      }
    }
    if (!zone && ctx.city) {
      const city = await findCityByName(territory.id, ctx.city)
      if (city && city.zone_id) {
        zone = await getZone(city.zone_id)
        if (zone && zone.active === false) zone = null
      }
    }
    if (!zone && territory.default_zone_id) {
      const def = await getZone(territory.default_zone_id)
      if (def && def.active !== false) zone = def
    }
  }

  return { territory: territory || null, zone: zone || null, source }
}

/**
 * Compute the effective cast_value_minor for a (territory, zone). Returns
 * an integer number of minor units per cast — this is what the price
 * formula multiplies against casts_charged.
 */
export function effectiveCastValueMinor({ core, territory, zone, logger = console }) {
  const base = Number(core?.cast_value_minor) || CAST_VALUE_MINOR_SEED
  const tMult = territory ? multiplierOrDefault(territory.pricing_multiplier, 'territory', logger) : 1
  const zMult = zone ? multiplierOrDefault(zone.pricing_multiplier, 'zone', logger) : 1
  const raw = base * tMult * zMult
  return Math.max(1, Math.round(raw))
}

/**
 * Resolve the retail price + COGS for a single action. This is the
 * function the emit path calls when charging is on.
 *
 * @param {object} params
 * @param {string} params.actionKey
 * @param {number} params.quantity
 * @param {string} params.country       destination country (WhatsApp COGS)
 * @param {string} params.whatsappCategory  'utility_service' | 'marketing'
 * @param {string} params.territoryId
 * @param {string} params.zoneId
 * @param {number} params.rateCardVersion  pin to a specific version (grandfathering)
 * @param {number} params.castValueMinorOverride
 * @param {number} params.priceLockedMinor
 * @returns {Promise<{casts_charged,price_minor,cogs_estimate_minor,rate_card_version,cast_value_minor,territory_id,zone_id,effective_cast_value_minor}>}
 */
export async function resolveEffectivePrice({
  actionKey,
  quantity = 1,
  country = null,
  whatsappCategory = null,
  territoryId = null,
  zoneId = null,
  rateCardVersion = null,
  castValueMinorOverride = null,
  priceLockedMinor = null,
  logger = console,
} = {}) {
  const quantityNumber = Number(quantity)
  const q = Number.isNaN(quantityNumber) ? 1 : quantityNumber
  if (!Number.isFinite(q) || q <= 0) {
    throw new Error(`quantity must be a positive number, got: ${quantity}`)
  }
  const castValueOverride = optionalNumber(castValueMinorOverride, 'castValueMinorOverride', { allowZero: false })
  const lockedCastValue = optionalNumber(priceLockedMinor, 'priceLockedMinor', { allowZero: true })
  const pinnedRateCardVersion = optionalNumber(rateCardVersion, 'rateCardVersion', { allowZero: false })

  const core = pinnedRateCardVersion
    ? await getRateCardByVersion(pinnedRateCardVersion)
    : await getActiveRateCard()

  const rates = (core && core.rates) ? core.rates : CAST_RATES_V1
  const rate = Number(rates[actionKey])
  const casts_charged = Number.isFinite(rate) && rate >= 0 ? Math.round(rate * q) : 0

  let territory = null
  let zone = null
  if (territoryId) {
    const resolved = await resolveMarketContext({ territoryId, zoneId })
    territory = resolved.territory
    zone = resolved.zone
  }

  const cast_value_minor = castValueOverride != null
    ? Math.round(castValueOverride)
    : effectiveCastValueMinor({ core, territory, zone, logger })

  const price_locked = lockedCastValue != null && lockedCastValue > 0
  const price_minor = casts_charged * (price_locked ? Math.round(lockedCastValue) : cast_value_minor)

  const cogsUsd = estimateCogsUsd({ actionKey, quantity: q, country, whatsappCategory })
  const cogs_estimate_minor = Math.round(cogsUsd * 100)

  return {
    casts_charged,
    price_minor,
    cogs_estimate_minor,
    rate_card_version: core ? Number(core.version) : RATE_CARD_LATEST_VERSION,
    cast_value_minor,
    effective_cast_value_minor: cast_value_minor,
    territory_id: territory ? territory.id : null,
    zone_id: zone ? zone.id : null,
    price_locked,
  }
}

function optionalNumber(value, name, { allowZero }) {
  if (value == null) return null
  const number = Number(value)
  if (!Number.isFinite(number) || number < 0 || (!allowZero && number === 0)) {
    throw new Error(`${name} must be a positive number, got: ${value}`)
  }
  return number
}

function multiplierOrDefault(value, source, logger) {
  const multiplier = Number(value)
  if (!Number.isFinite(multiplier) || multiplier <= 0) {
    logger.warn({ source, value }, 'invalid pricing multiplier; using 1')
    return 1
  }
  return multiplier
}
