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

import { findAll, findOne, insert } from '../db.js'
import { requireElevated } from '../auth.js'
import { CAST_RATES_V1, CAST_VALUE_MINOR_SEED, RATE_CARD_LATEST_VERSION } from './rate-card.js'
import { periodSummary, quotaBalance, recordTopup, currentBillingPeriod } from './ledger.js'
import { resolveActiveSubscription } from './entitlements.js'
import {
  effectiveCastValueMinor,
  getActiveRateCard,
  resolveEffectivePrice,
  resolveMarketContext,
} from './pricing/index.js'

export function registerBillingRoutes(app, { authMiddleware, requirePlatformAdmin }) {
  const auth = authMiddleware || ((_req, _res, next) => next())
  const adminGuard = requirePlatformAdmin || ((_req, _res, next) => next())
  // Step-up (Phase 7f/3): credit grants mint money and are irrevocable.
  // A hijacked-but-unelevated admin cookie must not be able to hand out
  // credits without a second live proof.
  const elevated = requireElevated()

  app.get('/api/billing/rate-card', auth, async (req, res) => {
    const active = await resolveActiveSubscription(req.user.id)
    const runtimeRateCard = await getActiveRateCard()
    const rateCard = runtimeRateCard || {
      version: RATE_CARD_LATEST_VERSION,
      name: 'Wingcaster Core Rate Card v1',
      cast_value_minor: CAST_VALUE_MINOR_SEED,
      rates: CAST_RATES_V1,
    }
    const subscription = active?.subscription || null
    const territoryId = subscription?.territory_id || null
    const zoneId = subscription?.zone_id || null
    const market = territoryId
      ? await resolveMarketContext({ territoryId, zoneId })
      : { territory: null, zone: null }
    const effectiveCastValue = effectiveCastValueMinor({
      core: rateCard,
      territory: market.territory,
      zone: market.zone,
    })
    const priceLockedMinor = subscription?.price_locked_minor ?? null
    const priceLocked = Number(priceLockedMinor) > 0
    const rates = {}

    if (priceLocked) {
      const resolvedRates = await Promise.all(Object.entries(rateCard.rates).map(async ([actionKey, casts]) => {
        const price = await resolveEffectivePrice({
          actionKey,
          territoryId,
          zoneId,
          priceLockedMinor,
        })
        return [actionKey, {
          casts: Number(casts),
          price_minor: price.price_minor,
          price_display: formatUsd(price.price_minor),
        }]
      }))
      Object.assign(rates, Object.fromEntries(resolvedRates))
    } else {
      for (const [actionKey, castsValue] of Object.entries(rateCard.rates)) {
        const casts = Number(castsValue)
        const priceMinor = casts * effectiveCastValue
        rates[actionKey] = {
          casts,
          price_minor: priceMinor,
          price_display: formatUsd(priceMinor),
        }
      }
    }

    const marketContext = market.territory ? {
      territory_id: market.territory.id,
      territory_code: market.territory.code,
      territory_name: market.territory.name,
      zone_id: market.zone?.id || null,
      zone_name: market.zone?.name || null,
      territory_multiplier: Number(market.territory.pricing_multiplier),
      zone_multiplier: market.zone ? Number(market.zone.pricing_multiplier) : 1,
      effective_cast_value_minor: effectiveCastValue,
      effective_cast_value_display: formatUsd(effectiveCastValue),
    } : null

    res.json({
      rate_card: {
        version: Number(rateCard.version),
        name: rateCard.name,
        cast_value_minor: Number(rateCard.cast_value_minor),
        cast_value_display: formatUsd(Number(rateCard.cast_value_minor)),
      },
      market_context: marketContext,
      rates,
      price_locked: priceLocked,
      note: runtimeRateCard
        ? 'Prices reflect the active runtime rate card and the tenant market. Zero-rate actions are emitted for telemetry but never charged.'
        : 'Warning: no active runtime rate card was found; seed pricing is shown.',
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

  /**
   * Platform-wide manual credit grant — the ONLY path that mints ledger
   * credit for a tenant until Phase 7e wires a real payment gateway.
   * Tenant-facing top-up endpoints return 501 by design (see the
   * whatsapp-listings agent/agency routes for the mirrored gating).
   *
   * Body:
   *   tenant_id       — target tenant (agent id OR agency id; the ledger
   *                     is scope-agnostic and uses tenant_id as the key)
   *   quota_key       — which quota bucket to credit (e.g. 'outbound_whatsapp',
   *                     'x_posts', 'active_listings'). Not restricted to a
   *                     hard-coded catalog — new quotas defined by future
   *                     entitlements are grantable immediately.
   *   amount          — positive number of quota units to add
   *   reason          — required free-text audit reason
   *   subscription_id — optional; associates the entry with a subscription
   *   billing_period  — optional YYYY-MM; defaults to current UTC period
   *
   * Response: 201 { entry, balance }
   * Audit: writes public.audit_log { type: 'billing', action:
   *        'admin_credit_grant', agent_id: <actor>, metadata: {...} }.
   */
  app.post('/api/admin/billing/credit', auth, adminGuard, elevated, async (req, res) => {
    try {
      const { tenant_id, quota_key, amount, reason, subscription_id, billing_period } = req.body || {}
      if (!tenant_id || typeof tenant_id !== 'string') {
        return res.status(400).json({ error: 'tenant_id is required' })
      }
      if (!quota_key || typeof quota_key !== 'string') {
        return res.status(400).json({ error: 'quota_key is required' })
      }
      const amountNumber = Number(amount)
      if (!Number.isFinite(amountNumber) || amountNumber <= 0) {
        return res.status(400).json({ error: 'amount must be a positive number' })
      }
      const reasonText = String(reason || '').trim()
      if (!reasonText) {
        return res.status(400).json({ error: 'reason is required for audit trail' })
      }
      const period = billing_period || currentBillingPeriod()

      const entry = await recordTopup({
        tenantId: tenant_id,
        subscriptionId: subscription_id || null,
        billingPeriod: period,
        quotaKey: quota_key,
        amount: amountNumber,
        metadata: {
          source: 'admin_manual_credit',
          actor_id: req.user?.id || null,
          reason: reasonText,
        },
      })
      const balance = await quotaBalance({
        tenantId: tenant_id,
        quotaKey: quota_key,
        billingPeriod: period,
      })
      await insert('audit_log', {
        agent_id: req.user?.id || null,
        type: 'billing',
        action: 'admin_credit_grant',
        entity_type: 'ledger_entry',
        entity_id: entry?.id || null,
        metadata: {
          tenant_id,
          quota_key,
          amount: amountNumber,
          billing_period: period,
          subscription_id: subscription_id || null,
          reason: reasonText,
        },
      })
      res.status(201).json({ entry, balance })
    } catch (err) {
      res.status(500).json({ error: err.message })
    }
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

function formatUsd(minor) {
  return `$${(minor / 100).toFixed(2)}`
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
