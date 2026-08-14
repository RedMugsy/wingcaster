/**
 * Pricing sub-module facade.
 *
 * Owns the runtime CoreRateCard + Territory / Zone / City hierarchy.
 * The parent billing module mounts this via registerPricingRoutes and
 * runs the seed at boot.
 */

export { registerPricingRoutes } from './routes.js'
export { seedPricingHierarchy } from './seed.js'
export {
  resolveMarketContext, resolveEffectivePrice, effectiveCastValueMinor,
} from './resolver.js'
export {
  getActiveRateCard, getRateCardByVersion, listRateCards,
  createRateCard, updateRateCard, activateRateCard, ensureSeedRateCard,
} from './core-rate-cards.js'
export {
  listTerritories, getTerritory, getTerritoryByCode,
  createTerritory, updateTerritory, deactivateTerritory,
} from './territories.js'
export {
  listZones, getZone, createZone, updateZone, deactivateZone,
} from './zones.js'
export {
  listCities, getCity, findCityByName, createCity, updateCity,
  deactivateCity, assignCitiesToZone, normalizeName as normalizeCityName,
} from './cities.js'
