import express from 'express'
import request from 'supertest'
import { beforeEach, describe, expect, it, vi } from 'vitest'

// Pin JWT_SECRET before auth.js loads so signElevatedToken and
// requireElevated agree on the same key across the whole test file.
vi.hoisted(() => {
  process.env.JWT_SECRET = 'billing-routes-test-secret'
})

const dal = vi.hoisted(() => ({
  rows: {},
  inserted: [],
  findAll: vi.fn(async (collection, predicate) => (dal.rows[collection] || []).filter(predicate)),
  findOne: vi.fn(async (collection, predicate) => (dal.rows[collection] || []).find(predicate) || null),
  insert: vi.fn(async (collection, row) => {
    dal.inserted.push({ collection, row })
    return { id: 'inserted-1', ...row }
  }),
}))

vi.mock('../db.js', () => ({
  findAll: dal.findAll,
  findOne: dal.findOne,
  insert: dal.insert,
}))

const ledger = vi.hoisted(() => ({
  recordTopup: vi.fn(async ({ tenantId, quotaKey, amount }) => ({
    id: 'ledger-entry-1',
    tenant_id: tenantId,
    quota_key: quotaKey,
    amount,
    type: 'topup',
  })),
  quotaBalance: vi.fn(async () => 500),
  periodSummary: vi.fn(async () => ({ by_quota: {} })),
}))

vi.mock('./ledger.js', async () => {
  const actual = await vi.importActual('./ledger.js')
  return {
    ...actual,
    recordTopup: ledger.recordTopup,
    quotaBalance: ledger.quotaBalance,
    periodSummary: ledger.periodSummary,
  }
})

import { CAST_RATES_V1, CAST_VALUE_MINOR_SEED } from './rate-card.js'
import { registerBillingRoutes } from './routes.js'
import { signElevatedToken } from '../auth.js'

/**
 * Phase 7f/3 wired requireElevated onto POST /api/admin/billing/credit.
 * Tests that legitimately reach that endpoint carry an elevated token
 * matching the fake session; non-admin / bad-body tests still assert
 * their own failure paths (the elevation gate fires AFTER authMiddleware
 * + requirePlatformAdmin, so a bad body from an unelevated admin returns
 * 401 step_up_required, not 400 — matches production behaviour).
 */
function elevatedFor(userId = 'tenant-1') {
  return signElevatedToken({ userId, tokenVersion: 0 })
}

const seedRateCard = {
  id: 'rate-card-1',
  version: 1,
  name: 'Seed runtime card',
  cast_value_minor: CAST_VALUE_MINOR_SEED,
  rates: CAST_RATES_V1,
}
const territory = { id: 'territory-lb', code: 'LB', name: 'Lebanon', pricing_multiplier: 0.4 }
const zone = { id: 'zone-beirut', territory_id: territory.id, name: 'Beirut', pricing_multiplier: 2 }

function createApp({ isAdmin = true, userId = 'tenant-1' } = {}) {
  const app = express()
  app.use(express.json())
  const authMiddleware = (req, _res, next) => {
    req.user = { id: userId }
    next()
  }
  const requirePlatformAdmin = isAdmin
    ? (_req, _res, next) => next()
    : (_req, res, _next) => res.status(403).json({ error: 'Platform admin only' })
  registerBillingRoutes(app, { authMiddleware, requirePlatformAdmin })
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

describe('POST /api/admin/billing/credit — platform-wide manual credit grant', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    dal.inserted = []
    dal.rows = {}
  })

  const validBody = {
    tenant_id: 'agent-42',
    quota_key: 'outbound_whatsapp',
    amount: 500,
    reason: 'Support credit for onboarding delay',
  }

  it('rejects non-admins with 403 even with a valid body', async () => {
    await request(createApp({ isAdmin: false }))
      .post('/api/admin/billing/credit')
      .send(validBody)
      .expect(403)
    expect(ledger.recordTopup).not.toHaveBeenCalled()
    expect(dal.insert).not.toHaveBeenCalled()
  })

  it('400 when tenant_id is missing', async () => {
    const { tenant_id, ...body } = validBody
    void tenant_id
    await request(createApp()).post('/api/admin/billing/credit').set('X-Elevated-Token', elevatedFor()).send(body).expect(400)
    expect(ledger.recordTopup).not.toHaveBeenCalled()
  })

  it('400 when quota_key is missing', async () => {
    const { quota_key, ...body } = validBody
    void quota_key
    await request(createApp()).post('/api/admin/billing/credit').set('X-Elevated-Token', elevatedFor()).send(body).expect(400)
  })

  it('400 when amount is zero, negative, or non-numeric', async () => {
    for (const amount of [0, -5, 'abc', null]) {
      await request(createApp())
        .post('/api/admin/billing/credit')
        .set('X-Elevated-Token', elevatedFor())
        .send({ ...validBody, amount })
        .expect(400)
    }
    expect(ledger.recordTopup).not.toHaveBeenCalled()
  })

  it('400 when reason is empty or whitespace', async () => {
    for (const reason of ['', '   ', undefined]) {
      await request(createApp())
        .post('/api/admin/billing/credit')
        .set('X-Elevated-Token', elevatedFor())
        .send({ ...validBody, reason })
        .expect(400)
    }
  })

  it('201 on happy path — writes ledger entry, returns balance, writes audit_log', async () => {
    const response = await request(createApp({ userId: 'admin-1' }))
      .post('/api/admin/billing/credit')
      .set('X-Elevated-Token', elevatedFor('admin-1'))
      .send(validBody)
      .expect(201)

    expect(response.body).toEqual({
      entry: expect.objectContaining({
        id: 'ledger-entry-1',
        tenant_id: 'agent-42',
        quota_key: 'outbound_whatsapp',
        amount: 500,
        type: 'topup',
      }),
      balance: 500,
    })

    expect(ledger.recordTopup).toHaveBeenCalledTimes(1)
    expect(ledger.recordTopup).toHaveBeenCalledWith(expect.objectContaining({
      tenantId: 'agent-42',
      subscriptionId: null,
      quotaKey: 'outbound_whatsapp',
      amount: 500,
      metadata: expect.objectContaining({
        source: 'admin_manual_credit',
        actor_id: 'admin-1',
        reason: 'Support credit for onboarding delay',
      }),
    }))

    const auditWrites = dal.inserted.filter((w) => w.collection === 'audit_log')
    expect(auditWrites).toHaveLength(1)
    expect(auditWrites[0].row).toEqual(expect.objectContaining({
      agent_id: 'admin-1',
      type: 'billing',
      action: 'admin_credit_grant',
      entity_type: 'ledger_entry',
      entity_id: 'ledger-entry-1',
      metadata: expect.objectContaining({
        tenant_id: 'agent-42',
        quota_key: 'outbound_whatsapp',
        amount: 500,
        reason: 'Support credit for onboarding delay',
      }),
    }))
  })

  it('accepts optional subscription_id and billing_period', async () => {
    await request(createApp())
      .post('/api/admin/billing/credit')
      .set('X-Elevated-Token', elevatedFor())
      .send({ ...validBody, subscription_id: 'sub-9', billing_period: '2026-02' })
      .expect(201)

    expect(ledger.recordTopup).toHaveBeenCalledWith(expect.objectContaining({
      subscriptionId: 'sub-9',
      billingPeriod: '2026-02',
    }))
  })
})
