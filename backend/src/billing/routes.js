/**
 * Billing HTTP routes — Phase 7a surface.
 *
 * Tenant-scoped:
 *   GET  /api/billing/usage              — tenant sees own usage stream
 *   GET  /api/billing/usage/summary      — quota balances + $ estimate this period
 *   GET  /api/billing/rate-card          — the rate card + cast value for the tenant
 *
 * Admin-scoped (§15 telemetry — pricing decisions rely on this):
 *   GET  /api/admin/billing/usage        — cross-tenant event stream
 *   GET  /api/admin/billing/telemetry    — the §15 mix table (P50/P75/P90 etc.)
 *
 * Rate-card + entitlement CRUD lands in Phase 7b (admin territory /
 * zone UI). Subscription + topup + payment endpoints land in 7c–7e.
 */

import { findAll, findOne } from '../db.js'
import { CAST_RATES_V1, CAST_VALUE_MINOR_SEED, RATE_CARD_LATEST_VERSION } from './rate-card.js'
import { periodSummary, currentBillingPeriod } from './ledger.js'
import { resolveActiveSubscription } from './entitlements.js'

export function registerBillingRoutes(app, { authMiddleware, requirePlatformAdmin }) {
  const auth = authMiddleware || ((_req, _res, next) => next())
  const adminGuard = requirePlatformAdmin || ((_req, _res, next) => next())

  app.get('/api/billing/rate-card', auth, async (req, res) => {
    const active = await resolveActiveSubscription(req.user.id)
    const rateCardVersion = active?.subscription?.rate_card_version || RATE_CARD_LATEST_VERSION
    const castValueMinor = active?.subscription?.cast_value_minor || CAST_VALUE_MINOR_SEED
    res.json({
      rate_card_version: rateCardVersion,
      cast_value_minor: castValueMinor,
      cast_value_display: `$${(castValueMinor / 100).toFixed(2)}`,
      rates: CAST_RATES_V1,
      note: 'Casts × cast_value_minor / 100 = retail price per action in USD. Zero-rate actions are always emitted for telemetry but never charged.',
    })
  })

  app.get('/api/billing/usage', auth, async (req, res) => {
    const period = req.query.period || currentBillingPeriod()
    const limit = Math.min(500, Number(req.query.limit) || 200)
    const events = (await findAll('usage_events', (e) => e.tenant_id === req.user.id && e.billing_period === period))
      .sort((a, b) => new Date(b.occurred_at).getTime() - new Date(a.occurred_at).getTime())
      .slice(0, limit)
    res.json({
      tenant_id: req.user.id,
      billing_period: period,
      event_count: events.length,
      events,
    })
  })

  app.get('/api/billing/usage/summary', auth, async (req, res) => {
    const period = req.query.period || currentBillingPeriod()
    const [ledger, events] = await Promise.all([
      periodSummary({ tenantId: req.user.id, billingPeriod: period }),
      findAll('usage_events', (e) => e.tenant_id === req.user.id && e.billing_period === period),
    ])
    const totalCastsCharged = events.reduce((s, e) => s + (Number(e.casts_charged) || 0), 0)
    const totalPriceMinor = events.reduce((s, e) => s + (Number(e.price_minor) || 0), 0)
    const totalCogsMinor = events.reduce((s, e) => s + (Number(e.cogs_estimate_minor) || 0), 0)
    const byAction = {}
    for (const e of events) {
      if (!byAction[e.action_key]) {
        byAction[e.action_key] = { count: 0, quantity: 0, casts: 0, price_minor: 0, cogs_minor: 0 }
      }
      byAction[e.action_key].count += 1
      byAction[e.action_key].quantity += Number(e.quantity) || 1
      byAction[e.action_key].casts += Number(e.casts_charged) || 0
      byAction[e.action_key].price_minor += Number(e.price_minor) || 0
      byAction[e.action_key].cogs_minor += Number(e.cogs_estimate_minor) || 0
    }
    res.json({
      billing_period: period,
      tenant_id: req.user.id,
      event_count: events.length,
      totals: {
        casts_charged: totalCastsCharged,
        estimated_bill_usd: (totalPriceMinor / 100).toFixed(2),
        estimated_cogs_usd: (totalCogsMinor / 100).toFixed(4),
        estimated_margin_usd: ((totalPriceMinor - totalCogsMinor) / 100).toFixed(2),
      },
      by_action: byAction,
      ledger: ledger.by_quota,
    })
  })

  app.get('/api/admin/billing/usage', auth, adminGuard, async (req, res) => {
    const period = req.query.period || currentBillingPeriod()
    const limit = Math.min(2000, Number(req.query.limit) || 500)
    const events = (await findAll('usage_events', (e) => e.billing_period === period))
      .sort((a, b) => new Date(b.occurred_at).getTime() - new Date(a.occurred_at).getTime())
      .slice(0, limit)
    res.json({ billing_period: period, event_count: events.length, events })
  })

  app.get('/api/admin/billing/telemetry', auth, adminGuard, async (req, res) => {
    const period = req.query.period || currentBillingPeriod()
    const events = await findAll('usage_events', (e) => e.billing_period === period)
    if (!events.length) return res.json({ billing_period: period, tenants: 0, summary: null })

    // Group by tenant then compute per-tenant per-action counts.
    const byTenant = new Map()
    for (const e of events) {
      if (!byTenant.has(e.tenant_id)) byTenant.set(e.tenant_id, {})
      const t = byTenant.get(e.tenant_id)
      if (!t[e.action_key]) t[e.action_key] = { count: 0, quantity: 0, casts: 0, cogs_minor: 0 }
      t[e.action_key].count += 1
      t[e.action_key].quantity += Number(e.quantity) || 1
      t[e.action_key].casts += Number(e.casts_charged) || 0
      t[e.action_key].cogs_minor += Number(e.cogs_estimate_minor) || 0
    }

    // Percentile summary per action — powers §15 sizing decisions.
    const perAction = {}
    const actionKeys = new Set(events.map((e) => e.action_key))
    for (const key of actionKeys) {
      const perTenantValues = []
      for (const t of byTenant.values()) {
        perTenantValues.push(t[key]?.quantity || 0)
      }
      perTenantValues.sort((a, b) => a - b)
      const p = (pct) => {
        if (!perTenantValues.length) return 0
        const idx = Math.min(perTenantValues.length - 1, Math.floor((perTenantValues.length - 1) * pct))
        return perTenantValues[idx]
      }
      perAction[key] = {
        tenants: perTenantValues.length,
        total_quantity: perTenantValues.reduce((s, v) => s + v, 0),
        p50: p(0.50), p75: p(0.75), p90: p(0.90), p95: p(0.95),
      }
    }

    const totalCogs = events.reduce((s, e) => s + (Number(e.cogs_estimate_minor) || 0), 0)
    const totalCasts = events.reduce((s, e) => s + (Number(e.casts_charged) || 0), 0)
    res.json({
      billing_period: period,
      tenants: byTenant.size,
      total_events: events.length,
      total_casts_charged: totalCasts,
      total_cogs_usd: (totalCogs / 100).toFixed(4),
      blended_cost_per_cast_usd: totalCasts > 0 ? ((totalCogs / 100) / totalCasts).toFixed(6) : null,
      per_action: perAction,
    })
  })
}

/**
 * Tiny helper so server.js can look up if the current user is a platform
 * admin without pulling in the full billing surface. Optional — supplied
 * when we register the routes.
 */
export function makePlatformAdminGuard(isPlatformAdmin) {
  return async (req, res, next) => {
    if (!req.user?.id) return res.status(401).json({ error: 'Auth required' })
    const admin = await isPlatformAdmin(req.user.id).catch(() => false)
    if (!admin) return res.status(403).json({ error: 'Platform admin only' })
    next()
  }
}
