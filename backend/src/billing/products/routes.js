/**
 * Admin CRUD routes for the product catalog.
 *
 * All routes are platform-admin only — product / tier / pricing decisions
 * affect every tenant. Tenant-facing "what plans exist?" lives at the
 * public /api/billing/plans endpoint below.
 */

import {
  listProducts, listPublicProducts, getProduct, createProduct, updateProduct,
  publishProduct, deprecateProduct, retireProduct, cloneAsNewVersion,
} from './products.js'
import {
  listTiers, getTier, createTier, updateTier, activateTier, deprecateTier, retireTier,
} from './tiers.js'
import {
  listOverrides, getOverride, createOverride, updateOverride, deactivateOverride,
  resolveEffectivePrice,
} from './pricing-overrides.js'
import {
  cancelSubscription, createSubscription, expireSubscription, getSubscription,
  markPastDue, pauseSubscription, resolvePastDue, resumeSubscription, tickRenewals,
} from './lifecycle.js'
import { listEvents as listSubscriptionEvents } from './subscription-history.js'
import { findAll, findOne, query } from '../../db.js'
import { resolveMarketContext } from '../pricing/index.js'

function actorFrom(req) {
  return req.user?.id || req.agent?.id || null
}

export function registerProductCatalogRoutes(app, { authMiddleware, requirePlatformAdmin } = {}) {
  const guards = [authMiddleware, requirePlatformAdmin].filter(Boolean)

  // ---------- Products ----------
  app.get('/api/admin/billing/products', ...guards, async (req, res) => {
    try {
      const products = await listProducts({
        includeAllStatuses: String(req.query.include_all_statuses || '') === 'true',
        productType: req.query.product_type || null,
      })
      res.json({ products })
    } catch (err) {
      res.status(500).json({ error: err.message })
    }
  })

  app.get('/api/admin/billing/products/:id', ...guards, async (req, res) => {
    try {
      const product = await getProduct(req.params.id)
      if (!product) return res.status(404).json({ error: 'Product not found' })
      const [tiers, overrides] = await Promise.all([
        listTiers({ productId: product.id, productVersion: product.version, includeAllStatuses: true }),
        listOverrides({ productId: product.id, productVersion: product.version }),
      ])
      res.json({ product, tiers, overrides })
    } catch (err) {
      res.status(500).json({ error: err.message })
    }
  })

  app.post('/api/admin/billing/products', ...guards, async (req, res) => {
    try {
      const product = await createProduct(req.body || {}, { actorId: actorFrom(req) })
      res.status(201).json({ product })
    } catch (err) {
      res.status(errStatus(err, 400)).json({ error: err.message, code: err.code })
    }
  })

  app.patch('/api/admin/billing/products/:id', ...guards, async (req, res) => {
    try {
      const product = await updateProduct(req.params.id, req.body || {})
      res.json({ product })
    } catch (err) {
      res.status(errStatus(err, 400)).json({ error: err.message, code: err.code })
    }
  })

  app.post('/api/admin/billing/products/:id/publish', ...guards, async (req, res) => {
    try {
      const product = await publishProduct(req.params.id)
      res.json({ product })
    } catch (err) {
      res.status(errStatus(err, 400)).json({ error: err.message, code: err.code })
    }
  })

  app.post('/api/admin/billing/products/:id/deprecate', ...guards, async (req, res) => {
    try {
      const product = await deprecateProduct(req.params.id)
      res.json({ product })
    } catch (err) {
      res.status(errStatus(err, 400)).json({ error: err.message, code: err.code })
    }
  })

  app.post('/api/admin/billing/products/:id/retire', ...guards, async (req, res) => {
    try {
      const product = await retireProduct(req.params.id)
      res.json({ product })
    } catch (err) {
      res.status(errStatus(err, 400)).json({ error: err.message, code: err.code })
    }
  })

  app.post('/api/admin/billing/products/:id/clone-as-new-version', ...guards, async (req, res) => {
    try {
      const product = await cloneAsNewVersion(req.params.id, { actorId: actorFrom(req) })
      res.status(201).json({ product })
    } catch (err) {
      res.status(errStatus(err, 400)).json({ error: err.message, code: err.code })
    }
  })

  // ---------- Tiers ----------
  app.get('/api/admin/billing/products/:productId/tiers', ...guards, async (req, res) => {
    try {
      const product = await getProduct(req.params.productId)
      if (!product) return res.status(404).json({ error: 'Product not found' })
      const tiers = await listTiers({
        productId: product.id,
        productVersion: product.version,
        includeAllStatuses: String(req.query.include_all_statuses || '') === 'true',
      })
      res.json({ tiers })
    } catch (err) {
      res.status(500).json({ error: err.message })
    }
  })

  app.post('/api/admin/billing/products/:productId/tiers', ...guards, async (req, res) => {
    try {
      const product = await getProduct(req.params.productId)
      if (!product) return res.status(404).json({ error: 'Product not found' })
      const tier = await createTier({
        ...req.body,
        product_id: product.id,
        product_version: product.version,
      })
      res.status(201).json({ tier })
    } catch (err) {
      res.status(errStatus(err, 400)).json({ error: err.message, code: err.code })
    }
  })

  app.patch('/api/admin/billing/tiers/:id', ...guards, async (req, res) => {
    try {
      const tier = await updateTier(req.params.id, req.body || {})
      res.json({ tier })
    } catch (err) {
      res.status(errStatus(err, 400)).json({ error: err.message, code: err.code })
    }
  })

  app.post('/api/admin/billing/tiers/:id/activate', ...guards, async (req, res) => {
    try {
      const tier = await activateTier(req.params.id)
      res.json({ tier })
    } catch (err) {
      res.status(errStatus(err, 400)).json({ error: err.message, code: err.code })
    }
  })

  app.post('/api/admin/billing/tiers/:id/deprecate', ...guards, async (req, res) => {
    try {
      const tier = await deprecateTier(req.params.id)
      res.json({ tier })
    } catch (err) {
      res.status(errStatus(err, 400)).json({ error: err.message, code: err.code })
    }
  })

  app.post('/api/admin/billing/tiers/:id/retire', ...guards, async (req, res) => {
    try {
      const tier = await retireTier(req.params.id)
      res.json({ tier })
    } catch (err) {
      res.status(errStatus(err, 400)).json({ error: err.message, code: err.code })
    }
  })

  // ---------- Pricing overrides ----------
  app.get('/api/admin/billing/products/:productId/pricing-overrides', ...guards, async (req, res) => {
    try {
      const product = await getProduct(req.params.productId)
      if (!product) return res.status(404).json({ error: 'Product not found' })
      const overrides = await listOverrides({ productId: product.id, productVersion: product.version })
      res.json({ overrides })
    } catch (err) {
      res.status(500).json({ error: err.message })
    }
  })

  app.post('/api/admin/billing/products/:productId/pricing-overrides', ...guards, async (req, res) => {
    try {
      const product = await getProduct(req.params.productId)
      if (!product) return res.status(404).json({ error: 'Product not found' })
      const override = await createOverride({
        ...req.body,
        product_id: product.id,
        product_version: product.version,
      })
      res.status(201).json({ override })
    } catch (err) {
      res.status(errStatus(err, 400)).json({ error: err.message, code: err.code })
    }
  })

  app.patch('/api/admin/billing/pricing-overrides/:id', ...guards, async (req, res) => {
    try {
      const override = await updateOverride(req.params.id, req.body || {})
      res.json({ override })
    } catch (err) {
      res.status(errStatus(err, 400)).json({ error: err.message, code: err.code })
    }
  })

  app.delete('/api/admin/billing/pricing-overrides/:id', ...guards, async (req, res) => {
    try {
      const override = await deactivateOverride(req.params.id)
      res.json({ override })
    } catch (err) {
      res.status(errStatus(err, 400)).json({ error: err.message, code: err.code })
    }
  })

  // ---------- Price preview (admin) ----------
  // Returns the resolved effective price for a (product, tier, market)
  // combination, applying override → tier base → product base fallback.
  app.post('/api/admin/billing/pricing-preview', ...guards, async (req, res) => {
    try {
      const { product_id, tier_id, territory_id, city, country_code, zone_id } = req.body || {}
      if (!product_id) return res.status(400).json({ error: 'product_id is required' })
      const product = await getProduct(product_id)
      if (!product) return res.status(404).json({ error: 'Product not found' })
      const tier = tier_id ? await getTier(tier_id) : null
      const market = territory_id || country_code || city || zone_id
        ? await resolveMarketContext({ territoryId: territory_id, zoneId: zone_id, city, countryCode: country_code })
        : { territory: null, zone: null, source: 'fallback' }
      const resolved = await resolveEffectivePrice({
        product,
        tier,
        territoryId: market.territory?.id || null,
      })
      res.json({ product, tier, market, price: resolved })
    } catch (err) {
      res.status(errStatus(err, 500)).json({ error: err.message, code: err.code })
    }
  })

  // =====================================================================
  // Subscription lifecycle
  // =====================================================================

  // ---------- Tenant self-serve ----------
  app.get('/api/billing/my-subscription', authMiddleware, async (req, res) => {
    try {
      const subs = await findAll('billing_subscriptions', (s) =>
        s.tenant_id === req.user.id &&
        ['trialing', 'active', 'past_due', 'paused'].includes(s.status),
      )
      const primary = subs.find((s) => true) || null
      let history = []
      if (primary) history = await listSubscriptionEvents(primary.id, { limit: 25 })
      res.json({ subscription: primary, other_subscriptions: subs.filter((s) => s.id !== primary?.id), history })
    } catch (err) {
      res.status(500).json({ error: err.message })
    }
  })

  app.post('/api/billing/subscribe', authMiddleware, async (req, res) => {
    try {
      const { tier_id, product_id, trial_days, auto_renew, territory_id, zone_id, custom_period_days, metadata } = req.body || {}
      const sub = await createSubscription({
        tenantId: req.user.id,
        productId: product_id,
        tierId: tier_id,
        trialDays: trial_days ? Number(trial_days) : 0,
        autoRenew: auto_renew !== false,
        territoryId: territory_id || null,
        zoneId: zone_id || null,
        customPeriodDays: custom_period_days ? Number(custom_period_days) : null,
        metadata: metadata || {},
        actorId: req.user.id,
        actorType: 'tenant',
      })
      res.status(201).json({ subscription: sub })
    } catch (err) {
      res.status(subStatus(err, 400)).json({ error: err.message, code: err.code })
    }
  })

  app.post('/api/billing/my-subscription/cancel', authMiddleware, async (req, res) => {
    try {
      const sub = await findOne('billing_subscriptions', (s) => s.id === req.body?.subscription_id && s.tenant_id === req.user.id)
      if (!sub) return res.status(404).json({ error: 'Subscription not found' })
      const updated = await cancelSubscription(sub.id, {
        reason: req.body?.reason || null,
        actorId: req.user.id,
        actorType: 'tenant',
        atPeriodEnd: req.body?.immediate !== true,
      })
      res.json({ subscription: updated })
    } catch (err) {
      res.status(subStatus(err, 400)).json({ error: err.message, code: err.code })
    }
  })

  app.post('/api/billing/my-subscription/pause', authMiddleware, async (req, res) => {
    try {
      const sub = await findOne('billing_subscriptions', (s) => s.id === req.body?.subscription_id && s.tenant_id === req.user.id)
      if (!sub) return res.status(404).json({ error: 'Subscription not found' })
      const updated = await pauseSubscription(sub.id, {
        reason: req.body?.reason || null,
        actorId: req.user.id,
        actorType: 'tenant',
      })
      res.json({ subscription: updated })
    } catch (err) {
      res.status(subStatus(err, 400)).json({ error: err.message, code: err.code })
    }
  })

  app.post('/api/billing/my-subscription/resume', authMiddleware, async (req, res) => {
    try {
      const sub = await findOne('billing_subscriptions', (s) => s.id === req.body?.subscription_id && s.tenant_id === req.user.id)
      if (!sub) return res.status(404).json({ error: 'Subscription not found' })
      const updated = await resumeSubscription(sub.id, {
        actorId: req.user.id,
        actorType: 'tenant',
      })
      res.json({ subscription: updated })
    } catch (err) {
      res.status(subStatus(err, 400)).json({ error: err.message, code: err.code })
    }
  })

  // ---------- Admin subscription management ----------
  app.get('/api/admin/billing/subscriptions', ...guards, async (req, res) => {
    try {
      const status = req.query.status ? String(req.query.status).split(',') : null
      const tenantId = req.query.tenant_id || null
      const productId = req.query.product_id || null
      const tierId = req.query.tier_id || null
      const limit = Math.min(500, Number(req.query.limit) || 100)
      const params = []
      const where = []
      if (status) { params.push(status); where.push(`status = ANY($${params.length}::text[])`) }
      if (tenantId) { params.push(tenantId); where.push(`tenant_id = $${params.length}`) }
      if (productId) { params.push(productId); where.push(`product_id = $${params.length}`) }
      if (tierId) { params.push(tierId); where.push(`tier_id = $${params.length}`) }
      params.push(limit)
      const rows = await query(
        `SELECT * FROM commercial.billing_subscriptions
          ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
          ORDER BY created_at DESC
          LIMIT $${params.length}`,
        params,
      )
      res.json({ subscriptions: rows })
    } catch (err) {
      res.status(500).json({ error: err.message })
    }
  })

  app.get('/api/admin/billing/subscriptions/:id', ...guards, async (req, res) => {
    try {
      const subscription = await getSubscription(req.params.id)
      if (!subscription) return res.status(404).json({ error: 'Subscription not found' })
      const history = await listSubscriptionEvents(subscription.id, { limit: 200 })
      res.json({ subscription, history })
    } catch (err) {
      res.status(500).json({ error: err.message })
    }
  })

  app.post('/api/admin/billing/subscriptions/:id/cancel', ...guards, async (req, res) => {
    try {
      const updated = await cancelSubscription(req.params.id, {
        reason: req.body?.reason || null,
        actorId: actorFrom(req),
        actorType: 'admin',
        atPeriodEnd: req.body?.immediate !== true,
      })
      res.json({ subscription: updated })
    } catch (err) {
      res.status(subStatus(err, 400)).json({ error: err.message, code: err.code })
    }
  })

  app.post('/api/admin/billing/subscriptions/:id/expire', ...guards, async (req, res) => {
    try {
      const updated = await expireSubscription(req.params.id, {
        reason: req.body?.reason || null,
        actorId: actorFrom(req),
        actorType: 'admin',
      })
      res.json({ subscription: updated })
    } catch (err) {
      res.status(subStatus(err, 400)).json({ error: err.message, code: err.code })
    }
  })

  app.post('/api/admin/billing/subscriptions/:id/mark-past-due', ...guards, async (req, res) => {
    try {
      const updated = await markPastDue(req.params.id, {
        reason: req.body?.reason || null,
        actorId: actorFrom(req),
        actorType: 'admin',
      })
      res.json({ subscription: updated })
    } catch (err) {
      res.status(subStatus(err, 400)).json({ error: err.message, code: err.code })
    }
  })

  app.post('/api/admin/billing/subscriptions/:id/resolve-past-due', ...guards, async (req, res) => {
    try {
      const updated = await resolvePastDue(req.params.id, {
        reason: req.body?.reason || null,
        actorId: actorFrom(req),
        actorType: 'admin',
      })
      res.json({ subscription: updated })
    } catch (err) {
      res.status(subStatus(err, 400)).json({ error: err.message, code: err.code })
    }
  })

  // Manual scheduler kick — for admins to force a renewal sweep without
  // waiting for the interval tick. Useful during debugging + on cell
  // failover.
  app.post('/api/admin/billing/subscriptions/tick', ...guards, async (_req, res) => {
    try {
      const summary = await tickRenewals()
      res.json(summary)
    } catch (err) {
      res.status(500).json({ error: err.message })
    }
  })

  // ---------- Public tenant-facing catalog ----------
  app.get('/api/billing/plans', authMiddleware || ((_req, _res, next) => next()), async (_req, res) => {
    try {
      const products = await listPublicProducts()
      const enriched = await Promise.all(products.map(async (product) => {
        const tiers = await listTiers({
          productId: product.id,
          productVersion: product.version,
          includeAllStatuses: false,
        })
        return {
          product,
          tiers: tiers
            .filter((t) => t.status === 'active' && t.is_public !== false)
            .sort((a, b) => (a.sort_order || 0) - (b.sort_order || 0)),
        }
      }))
      res.json({ plans: enriched })
    } catch (err) {
      res.status(500).json({ error: err.message })
    }
  })
}

function errStatus(err, fallback) {
  if (err?.code === 'NOT_FOUND') return 404
  if (err?.code === 'DUPLICATE_VERSION' || err?.code === 'DUPLICATE_CODE' || err?.code === 'DUPLICATE_OVERRIDE') return 409
  if (err?.code === 'INVALID_TRANSITION' || err?.code === 'PRODUCT_LOCKED' || err?.code === 'TIER_LOCKED') return 409
  if (err?.code === 'RETIRE_HAS_ACTIVE_SUBS') return 409
  return fallback
}

function subStatus(err, fallback) {
  if (err?.code === 'NOT_FOUND' || err?.code === 'PRODUCT_NOT_FOUND' || err?.code === 'TIER_NOT_FOUND') return 404
  if (err?.code === 'PLAN_ALREADY_SUBSCRIBED') return 409
  if (err?.code === 'INVALID_TRANSITION') return 409
  if (err?.code === 'PRODUCT_NOT_SUBSCRIBABLE' || err?.code === 'TIER_NOT_SUBSCRIBABLE' || err?.code === 'TIER_NOT_PUBLIC') return 403
  if (err?.code === 'TIER_PRODUCT_MISMATCH' || err?.code === 'MISSING_FIELD') return 400
  return fallback
}
