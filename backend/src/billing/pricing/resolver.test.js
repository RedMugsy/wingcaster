import { beforeEach, describe, expect, it, vi } from 'vitest'

const pricing = vi.hoisted(() => ({
  activeRateCard: vi.fn(),
  versionedRateCard: vi.fn(),
  territory: vi.fn(),
  territoryByCode: vi.fn(),
  zone: vi.fn(),
  city: vi.fn(),
}))

vi.mock('./core-rate-cards.js', () => ({
  getActiveRateCard: pricing.activeRateCard,
  getRateCardByVersion: pricing.versionedRateCard,
}))
vi.mock('./territories.js', () => ({
  getTerritory: pricing.territory,
  getTerritoryByCode: pricing.territoryByCode,
}))
vi.mock('./zones.js', () => ({ getZone: pricing.zone }))
vi.mock('./cities.js', () => ({ findCityByName: pricing.city }))

import { CAST_RATES_V1 } from '../rate-card.js'
import { resolveEffectivePrice } from './resolver.js'

const core = {
  version: 7,
  cast_value_minor: 10,
  rates: { 'publish.rpa': 3 },
}

describe('resolveEffectivePrice', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    pricing.activeRateCard.mockResolvedValue(core)
    pricing.versionedRateCard.mockResolvedValue(core)
    pricing.territory.mockResolvedValue(null)
    pricing.territoryByCode.mockResolvedValue(null)
    pricing.zone.mockResolvedValue(null)
    pricing.city.mockResolvedValue(null)
  })

  it('pins only the retail price while retaining computed telemetry', async () => {
    pricing.territory.mockResolvedValue({ id: 'lb', pricing_multiplier: 0.4 })
    pricing.zone.mockResolvedValue({ id: 'beirut', territory_id: 'lb', pricing_multiplier: 2, active: true })

    const result = await resolveEffectivePrice({
      actionKey: 'publish.rpa',
      quantity: 2,
      territoryId: 'lb',
      zoneId: 'beirut',
      priceLockedMinor: 25,
    })

    expect(result).toMatchObject({
      casts_charged: 6,
      cast_value_minor: 8,
      effective_cast_value_minor: 8,
      price_minor: 150,
      price_locked: true,
      rate_card_version: 7,
      territory_id: 'lb',
      zone_id: 'beirut',
    })
  })

  it('uses seed rates without an active rate card', async () => {
    pricing.activeRateCard.mockResolvedValue(null)

    const known = await resolveEffectivePrice({ actionKey: 'publish.x.link' })
    const unknown = await resolveEffectivePrice({ actionKey: 'unknown.action' })

    expect(known.casts_charged).toBe(CAST_RATES_V1['publish.x.link'])
    expect(unknown.casts_charged).toBe(0)
  })

  it('propagates active rate-card failures', async () => {
    pricing.activeRateCard.mockRejectedValue(new Error('database unavailable'))
    await expect(resolveEffectivePrice({ actionKey: 'publish.rpa' })).rejects.toThrow('database unavailable')
  })

  it('rejects an invalid cast-value override', async () => {
    await expect(resolveEffectivePrice({
      actionKey: 'publish.rpa',
      castValueMinorOverride: 'abc',
    })).rejects.toThrow('castValueMinorOverride must be a positive number, got: abc')
  })

  it('treats NaN quantity as one', async () => {
    const result = await resolveEffectivePrice({ actionKey: 'publish.rpa', quantity: 'abc' })
    expect(result.casts_charged).toBe(3)
  })

  it('rejects zero quantity', async () => {
    await expect(resolveEffectivePrice({ actionKey: 'publish.rpa', quantity: 0 }))
      .rejects.toThrow('quantity must be a positive number, got: 0')
  })

  it('defaults a null territory multiplier to one and warns', async () => {
    const logger = { warn: vi.fn() }
    pricing.territory.mockResolvedValue({ id: 'lb', pricing_multiplier: null })

    const result = await resolveEffectivePrice({
      actionKey: 'publish.rpa',
      territoryId: 'lb',
      logger,
    })

    expect(result.cast_value_minor).toBe(10)
    expect(logger.warn).toHaveBeenCalledWith(
      { source: 'territory', value: null },
      'invalid pricing multiplier; using 1',
    )
  })
})
