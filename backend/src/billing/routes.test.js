import express from 'express'
import request from 'supertest'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const dal = vi.hoisted(() => ({
  rows: {},
  findAll: vi.fn(async (collection, predicate) => (dal.rows[collection] || []).filter(predicate)),
  findOne: vi.fn(async (collection, predicate) => (dal.rows[collection] || []).find(predicate) || null),
}))

vi.mock('../db.js', () => ({
  findAll: dal.findAll,
  findOne: dal.findOne,
}))

import { CAST_RATES_V1, CAST_VALUE_MINOR_SEED } from './rate-card.js'
import { registerBillingRoutes } from './routes.js'

const seedRateCard = {
  id: 'rate-card-1',
  version: 1,
  name: 'Seed runtime card',
  cast_value_minor: CAST_VALUE_MINOR_SEED,
  rates: CAST_RATES_V1,
}
const territory = { id: 'territory-lb', code: 'LB', name: 'Lebanon', pricing_multiplier: 0.4 }
const zone = { id: 'zone-beirut', territory_id: territory.id, name: 'Beirut', pricing_multiplier: 2 }

function createApp() {
  const app = express()
  const authMiddleware = (req, _res, next) => {
    req.user = { id: 'tenant-1' }
    next()
  }
  registerBillingRoutes(app, { authMiddleware })
  return app
}

describe('GET /api/billing/rate-card', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    dal.rows = {
      core_rate_cards: [{ ...seedRateCard, is_active: true }],
      subscriptions: [],
      products: [],
      territories: [{ id: territory.id, code: territory.code, name: territory.name, currency: 'USD' }],
      commercial_territories: [{ ...territory, active: true }],
      pricing_zones: [{ ...zone, active: true }],
    }
  })

  it('returns unmultiplied runtime rates without a subscription', async () => {
    const response = await request(createApp()).get('/api/billing/rate-card').expect(200)

    expect(response.body.rate_card).toEqual({
      version: 1,
      name: 'Seed runtime card',
      cast_value_minor: 10,
      cast_value_display: '$0.10',
    })
    expect(response.body.market_context).toBeNull()
    expect(response.body.rates['publish.rpa']).toEqual({ casts: 3, price_minor: 30, price_display: '$0.30' })
    expect(response.body.price_locked).toBe(false)
    expect(dal.findOne).not.toHaveBeenCalledWith('commercial_territories', expect.any(Function))
  })

  it('applies the subscription territory and zone multipliers', async () => {
    dal.rows.subscriptions = [{
      id: 'subscription-1',
      tenant_id: 'tenant-1',
      status: 'active',
      territory_id: territory.id,
      zone_id: zone.id,
    }]

    const response = await request(createApp()).get('/api/billing/rate-card').expect(200)

    expect(response.body.market_context).toEqual({
      territory_id: territory.id,
      territory_code: 'LB',
      territory_name: 'Lebanon',
      zone_id: zone.id,
      zone_name: 'Beirut',
      territory_multiplier: 0.4,
      zone_multiplier: 2,
      effective_cast_value_minor: 8,
      effective_cast_value_display: '$0.08',
    })
    expect(response.body.rates['publish.rpa'].price_minor).toBe(24)
  })

  it('uses the subscription price lock for every action', async () => {
    dal.rows.subscriptions = [{
      id: 'subscription-1',
      tenant_id: 'tenant-1',
      status: 'active',
      territory_id: territory.id,
      zone_id: zone.id,
      price_locked_minor: 25,
    }]

    const response = await request(createApp()).get('/api/billing/rate-card').expect(200)

    expect(response.body.price_locked).toBe(true)
    for (const [actionKey, rate] of Object.entries(response.body.rates)) {
      expect(rate.price_minor).toBe(25 * CAST_RATES_V1[actionKey])
    }
  })

  it('falls back to seed pricing when no active card exists', async () => {
    dal.rows.core_rate_cards = []

    const response = await request(createApp()).get('/api/billing/rate-card').expect(200)

    expect(response.body.rate_card.version).toBe(1)
    expect(response.body.rates['publish.x.link']).toEqual({ casts: 8, price_minor: 80, price_display: '$0.80' })
    expect(response.body.note).toMatch(/Warning: no active runtime rate card/)
  })
})
