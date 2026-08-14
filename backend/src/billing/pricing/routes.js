/**
 * Admin CRUD API for the pricing hierarchy.
 *
 * All routes are platform-admin only — territory/zone/city changes and
 * rate-card edits affect every tenant. Tenant-facing "what am I paying?"
 * lives in backend/src/billing/routes.js (rate-card summary endpoint).
 */

import {
  listRateCards, getActiveRateCard, createRateCard, updateRateCard, activateRateCard,
} from './core-rate-cards.js'
import {
  listTerritories, getTerritory, getTerritoryByCode,
  createTerritory, updateTerritory, deactivateTerritory,
} from './territories.js'
import {
  listZones, getZone, createZone, updateZone, deactivateZone,
} from './zones.js'
import {
  listCities, getCity, createCity, updateCity, deactivateCity, assignCitiesToZone,
} from './cities.js'
import { resolveMarketContext, resolveEffectivePrice } from './resolver.js'

export function registerPricingRoutes(app, { authMiddleware, requirePlatformAdmin } = {}) {
  const guards = [authMiddleware, requirePlatformAdmin].filter(Boolean)

  // ---------- Core Rate Cards ----------
  app.get('/api/admin/pricing/rate-cards', ...guards, async (_req, res) => {
    try {
      const cards = await listRateCards()
      const active = await getActiveRateCard()
      res.json({ cards, active_id: active?.id || null })
    } catch (err) {
      res.status(500).json({ error: err.message })
    }
  })

  app.post('/api/admin/pricing/rate-cards', ...guards, async (req, res) => {
    try {
      const created = await createRateCard({
        ...req.body,
        created_by: req.user?.id || req.agent?.id || null,
      })
      res.status(201).json({ card: created })
    } catch (err) {
      res.status(400).json({ error: err.message })
    }
  })

  app.patch('/api/admin/pricing/rate-cards/:id', ...guards, async (req, res) => {
    try {
      const card = await updateRateCard(req.params.id, req.body || {})
      res.json({ card })
    } catch (err) {
      res.status(400).json({ error: err.message })
    }
  })

  app.post('/api/admin/pricing/rate-cards/:id/activate', ...guards, async (req, res) => {
    try {
      const active = await activateRateCard(req.params.id)
      res.json({ active })
    } catch (err) {
      res.status(400).json({ error: err.message })
    }
  })

  // ---------- Territories ----------
  app.get('/api/admin/pricing/territories', ...guards, async (req, res) => {
    try {
      const includeInactive = String(req.query.include_inactive || '') === 'true'
      const territories = await listTerritories({ includeInactive })
      res.json({ territories })
    } catch (err) {
      res.status(500).json({ error: err.message })
    }
  })

  app.get('/api/admin/pricing/territories/:id', ...guards, async (req, res) => {
    try {
      const territory = await getTerritory(req.params.id)
      if (!territory) return res.status(404).json({ error: 'not found' })
      const zones = await listZones({ territoryId: territory.id, includeInactive: true })
      res.json({ territory, zones })
    } catch (err) {
      res.status(500).json({ error: err.message })
    }
  })

  app.post('/api/admin/pricing/territories', ...guards, async (req, res) => {
    try {
      const territory = await createTerritory(req.body || {})
      res.status(201).json({ territory })
    } catch (err) {
      res.status(400).json({ error: err.message })
    }
  })

  app.patch('/api/admin/pricing/territories/:id', ...guards, async (req, res) => {
    try {
      const territory = await updateTerritory(req.params.id, req.body || {})
      res.json({ territory })
    } catch (err) {
      res.status(400).json({ error: err.message })
    }
  })

  app.delete('/api/admin/pricing/territories/:id', ...guards, async (req, res) => {
    try {
      const territory = await deactivateTerritory(req.params.id)
      res.json({ territory })
    } catch (err) {
      res.status(400).json({ error: err.message })
    }
  })

  // ---------- Zones ----------
  app.get('/api/admin/pricing/zones', ...guards, async (req, res) => {
    try {
      const zones = await listZones({
        territoryId: req.query.territory_id || null,
        includeInactive: String(req.query.include_inactive || '') === 'true',
      })
      res.json({ zones })
    } catch (err) {
      res.status(500).json({ error: err.message })
    }
  })

  app.post('/api/admin/pricing/zones', ...guards, async (req, res) => {
    try {
      const zone = await createZone(req.body || {})
      res.status(201).json({ zone })
    } catch (err) {
      res.status(400).json({ error: err.message })
    }
  })

  app.patch('/api/admin/pricing/zones/:id', ...guards, async (req, res) => {
    try {
      const zone = await updateZone(req.params.id, req.body || {})
      res.json({ zone })
    } catch (err) {
      res.status(400).json({ error: err.message })
    }
  })

  app.delete('/api/admin/pricing/zones/:id', ...guards, async (req, res) => {
    try {
      const zone = await deactivateZone(req.params.id)
      res.json({ zone })
    } catch (err) {
      res.status(400).json({ error: err.message })
    }
  })

  // ---------- Cities ----------
  app.get('/api/admin/pricing/cities', ...guards, async (req, res) => {
    try {
      const cities = await listCities({
        territoryId: req.query.territory_id || null,
        zoneId: req.query.zone_id || null,
        includeInactive: String(req.query.include_inactive || '') === 'true',
      })
      res.json({ cities })
    } catch (err) {
      res.status(500).json({ error: err.message })
    }
  })

  app.post('/api/admin/pricing/cities', ...guards, async (req, res) => {
    try {
      const city = await createCity(req.body || {})
      res.status(201).json({ city })
    } catch (err) {
      res.status(400).json({ error: err.message })
    }
  })

  app.patch('/api/admin/pricing/cities/:id', ...guards, async (req, res) => {
    try {
      const city = await updateCity(req.params.id, req.body || {})
      res.json({ city })
    } catch (err) {
      res.status(400).json({ error: err.message })
    }
  })

  app.delete('/api/admin/pricing/cities/:id', ...guards, async (req, res) => {
    try {
      const city = await deactivateCity(req.params.id)
      res.json({ city })
    } catch (err) {
      res.status(400).json({ error: err.message })
    }
  })

  app.post('/api/admin/pricing/cities/bulk-assign-zone', ...guards, async (req, res) => {
    try {
      const { city_ids, zone_id } = req.body || {}
      const cities = await assignCitiesToZone(city_ids || [], zone_id || null)
      res.json({ cities })
    } catch (err) {
      res.status(400).json({ error: err.message })
    }
  })

  // ---------- Resolver preview (admin/onboarding aid) ----------
  app.post('/api/admin/pricing/preview', ...guards, async (req, res) => {
    try {
      const body = req.body || {}
      const context = await resolveMarketContext({
        countryCode: body.country_code,
        city: body.city,
        territoryId: body.territory_id,
        zoneId: body.zone_id,
      })
      const price = await resolveEffectivePrice({
        actionKey: body.action_key || 'publish.meta.facebook',
        quantity: body.quantity || 1,
        country: body.country_code,
        whatsappCategory: body.whatsapp_category,
        territoryId: context.territory?.id,
        zoneId: context.zone?.id,
      })
      res.json({ context, price })
    } catch (err) {
      res.status(400).json({ error: err.message })
    }
  })

  // Public: any authenticated user can look up their market to see what
  // territory + zone the system pinned them to.
  app.get('/api/pricing/my-market', authMiddleware || ((req, _res, next) => next()), async (req, res) => {
    try {
      const territory = req.query.country
        ? await getTerritoryByCode(String(req.query.country))
        : null
      const context = territory
        ? await resolveMarketContext({
            countryCode: String(req.query.country),
            city: req.query.city ? String(req.query.city) : undefined,
          })
        : { territory: null, zone: null, source: 'unknown' }
      res.json({ context })
    } catch (err) {
      res.status(500).json({ error: err.message })
    }
  })
}
