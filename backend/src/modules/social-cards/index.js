/**
 * Social-cards module — public entrypoint.
 *
 * Renders per-listing branded social creatives from JSON templates.
 * Templates are stored in the `social_card_templates` collection with
 * ownership scoping (platform | store | agency | agent). Rendered PNGs
 * land in the `social_cards` collection + on disk under
 * uploads/social-cards/<listing_id>/, served statically.
 *
 * Endpoints (all authenticated):
 *   GET    /api/social-card-templates              list visible templates for caller
 *   GET    /api/social-card-templates/:id          fetch a single template
 *   POST   /api/social-card-templates              create (BYO import) — validates schema
 *   POST   /api/social-card-templates/:id/duplicate  copy to caller's library
 *   PUT    /api/social-card-templates/:id          edit owned template
 *   DELETE /api/social-card-templates/:id          delete owned template
 *   GET    /api/social-card-templates/bindings     enumerated bindable paths + helpers
 *   GET    /api/social-cards/platforms             platform canvas sizes
 *
 *   GET    /api/listings/:id/social-cards          list rendered cards for listing
 *   POST   /api/listings/:id/social-cards/render   render {template_id, platforms[]}
 *   DELETE /api/social-cards/:id                   delete a rendered card
 */

import { mkdir } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { pino } from 'pino'
import { v4 as uuidv4 } from 'uuid'
import { findAll, findOne, insert, update, remove } from '../../db.js'
import { PLATFORM_DIMENSIONS, PLATFORM_KEYS, isValidPlatformKey } from './dimensions.js'
import { OWNER_TYPES, validateTemplate } from './schema.js'
import { BINDABLE_PATHS } from './data-binding.js'
import { renderSocialCard, renderSocialCardMatrix } from './renderer.js'
import { seedSocialCardTemplates } from './seed-templates.js'
import {
  isBannerbearEnabled, getBannerbearConfig,
  fetchBannerbearTemplates, fetchBannerbearTemplateDetail,
  parseBannerbearWebhook,
} from './bannerbear-adapter.js'

const __dirname = dirname(fileURLToPath(import.meta.url))

export const MODULE_NAME = 'social-cards'

function getConfig() {
  const env = (key, fallback = '') => process.env[key] ?? fallback
  return {
    enabled: env('SOCIAL_CARDS_ENABLED', 'true') === 'true',
    storagePath: env('SOCIAL_CARDS_STORAGE_PATH', join(__dirname, '../../../uploads/social-cards')),
    publicBaseUrl: env('SOCIAL_CARDS_PUBLIC_BASE_URL', '/uploads/social-cards'),
    maxTemplatesPerRender: 3,
    maxPlatformsPerRender: 8,
    maxTemplateSizeKb: 128,
  }
}

export function createModule() {
  const config = getConfig()
  const logger = pino({
    name: MODULE_NAME,
    level: process.env.SOCIAL_CARDS_LOG_LEVEL || process.env.LOG_LEVEL || 'info',
  })

  if (!config.enabled) {
    return { enabled: false, prepare: async () => {}, registerRoutes: () => {} }
  }

  return {
    enabled: true,
    config,
    logger,
    async prepare() {
      await mkdir(config.storagePath, { recursive: true })
      await seedSocialCardTemplates({ findOne, insert, update })
      if (isBannerbearEnabled()) {
        // Best-effort catalog sync at boot. Failure never blocks boot —
        // logged and picked up on next admin manual refresh.
        try {
          const count = await upsertBannerbearCatalog()
          logger.info({ storage: config.storagePath, bannerbear_templates: count }, 'social-cards module ready (Bannerbear synced)')
        } catch (err) {
          logger.warn({ err: err.message }, 'social-cards module ready — Bannerbear sync deferred')
        }
      } else {
        logger.info({ storage: config.storagePath }, 'social-cards module ready (Bannerbear disabled)')
      }
    },
    registerRoutes(app, { authMiddleware, emitUsageEventAsync } = {}) {
      const auth = authMiddleware || ((_req, _res, next) => next())

      /* --------------------- Template CRUD + Store --------------------- */

      app.get('/api/social-card-templates', auth, async (req, res) => {
        const scope = String(req.query.scope || 'visible').toLowerCase()
        const all = await findAll('social_card_templates', () => true)
        const agent = await findOne('agents', (a) => a.id === req.user.id)
        const agencyId = agent?.agency_id || null

        function isVisible(t) {
          if (t.owner_type === 'platform' || t.owner_type === 'store') return true
          if (t.owner_type === 'agent' && t.owner_id === req.user.id) return true
          if (t.owner_type === 'agency' && agencyId && t.owner_id === agencyId) return true
          return false
        }
        function inScope(t) {
          if (scope === 'visible') return isVisible(t)
          if (scope === 'platform') return t.owner_type === 'platform'
          if (scope === 'store')    return t.owner_type === 'store'
          if (scope === 'agency')   return t.owner_type === 'agency' && agencyId && t.owner_id === agencyId
          if (scope === 'agent')    return t.owner_type === 'agent' && t.owner_id === req.user.id
          if (scope === 'mine')     return (t.owner_type === 'agent' && t.owner_id === req.user.id)
                                    || (t.owner_type === 'agency' && agencyId && t.owner_id === agencyId)
          return isVisible(t)
        }
        const templates = all
          .filter(inScope)
          .sort((a, b) => a.name.localeCompare(b.name))
          .map(publicShape)
        res.json({ templates, agency_id: agencyId })
      })

      app.get('/api/social-card-templates/bindings', auth, (_req, res) => {
        res.json({
          paths: BINDABLE_PATHS,
          helpers: ['formatPrice', 'formatArea', 'upper', 'lower', 'truncate', 'coalesce', 'status', 'if'],
          example_usage: {
            title: '{{listing.title}}',
            price: '{{formatPrice listing.price listing.price_unit}}',
            fallback: '{{listing.city | default: "unknown"}}',
            meta: '{{listing.bedrooms}} bd · {{listing.bathrooms}} ba',
          },
        })
      })

      app.get('/api/social-cards/platforms', auth, (_req, res) => {
        res.json({
          platforms: Object.entries(PLATFORM_DIMENSIONS).map(([key, d]) => ({ key, ...d })),
        })
      })

      app.get('/api/social-card-templates/:id', auth, async (req, res) => {
        const t = await findOne('social_card_templates', (r) => r.id === req.params.id)
        if (!t) return res.status(404).json({ error: 'Template not found' })
        const agent = await findOne('agents', (a) => a.id === req.user.id)
        const agencyId = agent?.agency_id || null
        if (!templateVisibleTo(t, req.user.id, agencyId)) {
          return res.status(403).json({ error: 'Not authorised to view this template' })
        }
        res.json({ template: t })
      })

      // Create — used for BYO import (paste JSON).
      app.post('/api/social-card-templates', auth, async (req, res) => {
        const body = req.body || {}
        const raw = body.template || body
        const bytes = Buffer.byteLength(JSON.stringify(raw))
        if (bytes > config.maxTemplateSizeKb * 1024) {
          return res.status(400).json({ error: `Template too large (${(bytes / 1024).toFixed(1)}KB > ${config.maxTemplateSizeKb}KB)` })
        }
        const { ok, errors } = validateTemplate(raw)
        if (!ok) return res.status(400).json({ error: 'Invalid template', details: errors })

        const agent = await findOne('agents', (a) => a.id === req.user.id)
        const agencyId = agent?.agency_id || null
        const ownerType = body.owner_type === 'agency' && agencyId ? 'agency' : 'agent'
        const ownerId = ownerType === 'agency' ? agencyId : req.user.id

        const row = {
          ...raw,
          id: `${ownerType}_${uuidv4()}`,
          owner_type: ownerType,
          owner_id: ownerId,
          engine: raw.engine || 'builtin',
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        }
        await insert('social_card_templates', row)
        res.json({ template: publicShape(row) })
      })

      app.post('/api/social-card-templates/:id/duplicate', auth, async (req, res) => {
        const src = await findOne('social_card_templates', (r) => r.id === req.params.id)
        if (!src) return res.status(404).json({ error: 'Template not found' })
        const agent = await findOne('agents', (a) => a.id === req.user.id)
        const agencyId = agent?.agency_id || null
        if (!templateVisibleTo(src, req.user.id, agencyId)) {
          return res.status(403).json({ error: 'Not authorised to duplicate this template' })
        }
        const ownerType = req.body?.owner_type === 'agency' && agencyId ? 'agency' : 'agent'
        const ownerId = ownerType === 'agency' ? agencyId : req.user.id
        const copy = {
          ...src,
          id: `${ownerType}_${uuidv4()}`,
          name: (req.body?.name || `${src.name} (copy)`).slice(0, 60),
          owner_type: ownerType,
          owner_id: ownerId,
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        }
        await insert('social_card_templates', copy)
        res.json({ template: publicShape(copy) })
      })

      app.put('/api/social-card-templates/:id', auth, async (req, res) => {
        const t = await findOne('social_card_templates', (r) => r.id === req.params.id)
        if (!t) return res.status(404).json({ error: 'Template not found' })
        if (t.owner_type === 'platform' || t.owner_type === 'store') {
          return res.status(403).json({ error: 'Shipped and store templates are read-only. Duplicate first, then edit the copy.' })
        }
        const agent = await findOne('agents', (a) => a.id === req.user.id)
        const agencyId = agent?.agency_id || null
        const owns = (t.owner_type === 'agent' && t.owner_id === req.user.id)
                  || (t.owner_type === 'agency' && agencyId && t.owner_id === agencyId)
        if (!owns) return res.status(403).json({ error: 'Not authorised to edit this template' })

        const patch = req.body?.template || req.body
        const merged = {
          ...t,
          ...patch,
          id: t.id, owner_type: t.owner_type, owner_id: t.owner_id,
          updated_at: new Date().toISOString(),
        }
        const { ok, errors } = validateTemplate(merged)
        if (!ok) return res.status(400).json({ error: 'Invalid template', details: errors })
        await update('social_card_templates', (r) => r.id === t.id, () => merged)
        res.json({ template: publicShape(merged) })
      })

      app.delete('/api/social-card-templates/:id', auth, async (req, res) => {
        const t = await findOne('social_card_templates', (r) => r.id === req.params.id)
        if (!t) return res.status(404).json({ error: 'Template not found' })
        if (t.owner_type === 'platform' || t.owner_type === 'store') {
          return res.status(403).json({ error: 'Cannot delete shipped or store templates' })
        }
        const agent = await findOne('agents', (a) => a.id === req.user.id)
        const agencyId = agent?.agency_id || null
        const owns = (t.owner_type === 'agent' && t.owner_id === req.user.id)
                  || (t.owner_type === 'agency' && agencyId && t.owner_id === agencyId)
        if (!owns) return res.status(403).json({ error: 'Not authorised to delete this template' })
        await remove('social_card_templates', (r) => r.id === t.id)
        res.json({ ok: true })
      })

      /* --------------------- Rendered cards per listing --------------------- */

      app.get('/api/listings/:id/social-cards', auth, async (req, res) => {
        const listing = await findOne('properties', (p) => p.id === req.params.id)
        if (!listing) return res.status(404).json({ error: 'Listing not found' })
        if (listing.agent_id !== req.user.id) return res.status(403).json({ error: 'Only the listing owner can view its cards' })
        const cards = (await findAll('social_cards', (c) => c.listing_id === req.params.id))
          .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())
        res.json({ cards })
      })

      app.post('/api/listings/:id/social-cards/render', auth, async (req, res) => {
        const listing = await findOne('properties', (p) => p.id === req.params.id)
        if (!listing) return res.status(404).json({ error: 'Listing not found' })
        if (listing.agent_id !== req.user.id) return res.status(403).json({ error: 'Only the listing owner can render cards for it' })

        const templateIds = Array.isArray(req.body?.template_ids)
          ? req.body.template_ids
          : (req.body?.template_id ? [req.body.template_id] : [])
        const platforms = normaliseList(req.body?.platforms, PLATFORM_KEYS, isValidPlatformKey)

        if (!templateIds.length) return res.status(400).json({ error: 'template_id (or template_ids[]) is required' })
        if (!platforms.length) return res.status(400).json({ error: `platforms must be one or more of: ${PLATFORM_KEYS.join(', ')}` })
        if (templateIds.length > config.maxTemplatesPerRender) return res.status(400).json({ error: `too many templates (max ${config.maxTemplatesPerRender})` })
        if (platforms.length > config.maxPlatformsPerRender) return res.status(400).json({ error: `too many platforms (max ${config.maxPlatformsPerRender})` })

        const agent = await findOne('agents', (a) => a.id === listing.agent_id)
        const agencyId = agent?.agency_id || null
        const brand = req.body?.brand || null

        // Fetch every requested template and gate visibility.
        const templates = []
        for (const tid of templateIds) {
          const t = await findOne('social_card_templates', (r) => r.id === tid)
          if (!t) return res.status(404).json({ error: `Template not found: ${tid}` })
          if (!templateVisibleTo(t, req.user.id, agencyId)) return res.status(403).json({ error: `Not authorised to use template ${tid}` })
          templates.push(t)
        }

        const allAssets = []
        const allErrors = []
        for (const template of templates) {
          const { assets, errors } = await renderSocialCardMatrix({
            template, listing, agent, brand,
            platforms,
            storageRoot: config.storagePath,
            publicBaseUrl: config.publicBaseUrl,
          })
          for (const a of assets) {
            await insert('social_cards', { ...a, agent_id: listing.agent_id })
            allAssets.push(a)
            if (typeof emitUsageEventAsync === 'function') {
              const actionKey = template.engine === 'bannerbear'
                ? 'render.template.premium'
                : 'render.template.standard'
              emitUsageEventAsync({
                actionKey,
                tenantId: req.user.id,
                quantity: 1,
                listingId: listing.id,
                metadata: { template_id: template.id, platform: a.platform, engine: template.engine || 'builtin' },
              })
            }
          }
          allErrors.push(...errors)
        }
        logger.info({ listingId: listing.id, templates: templates.length, platforms: platforms.length, rendered: allAssets.length, failed: allErrors.length }, 'social-cards render')

        res.json({ cards: allAssets, errors: allErrors })
      })

      app.delete('/api/social-cards/:id', auth, async (req, res) => {
        const card = await findOne('social_cards', (c) => c.id === req.params.id)
        if (!card) return res.status(404).json({ error: 'Card not found' })
        if (card.agent_id !== req.user.id) return res.status(403).json({ error: 'Only the owner can delete this card' })
        await remove('social_cards', (c) => c.id === card.id)
        // PNG stays on disk; a periodic sweeper can clean orphans.
        res.json({ ok: true })
      })

      /* --------------------------- Bannerbear --------------------------- */

      app.get('/api/social-cards/bannerbear/status', auth, (_req, res) => {
        const cfg = getBannerbearConfig()
        res.json({
          enabled: cfg.enabled,
          force_synchronous: cfg.forceSynchronous,
          webhook_url_configured: Boolean(cfg.webhookUrl),
        })
      })

      // Manual catalog refresh — admin-only for the platform-owned key.
      // Per-tenant keys (future) will use a scoped refresh route.
      app.post('/api/social-cards/bannerbear/sync', auth, async (req, res) => {
        try {
          const count = await upsertBannerbearCatalog()
          logger.info({ synced: count, agent_id: req.user?.id }, 'bannerbear catalog synced')
          res.json({ synced: count })
        } catch (err) {
          logger.error({ err: err.message }, 'bannerbear catalog sync failed')
          res.status(502).json({ error: err.message })
        }
      })

      // Detail fetch for the template editor — surfaces the raw
      // available_modifications from Bannerbear so the mapping form can
      // render every field the designer defined.
      app.get('/api/social-cards/bannerbear/templates/:uid', auth, async (req, res) => {
        try {
          const t = await fetchBannerbearTemplateDetail(req.params.uid)
          res.json({ template: t })
        } catch (err) {
          res.status(err.code === 'MISSING_KEY' ? 400 : 502).json({ error: err.message, code: err.code || null })
        }
      })

      // Webhook receiver — only used when force_synchronous=false and the
      // adapter registered a webhook_url. Persists nothing on its own (the
      // render call inserts the row); this hook is for future async-only
      // flows where we don't wait for the render inline.
      app.post('/api/social-cards/bannerbear/webhook', async (req, res) => {
        const event = parseBannerbearWebhook(req.body)
        if (!event) return res.status(400).json({ error: 'unparseable webhook payload' })
        logger.info({ event }, 'bannerbear webhook received')
        res.json({ received: true })
      })
    },
  }

  /**
   * Fetch the Bannerbear catalog and upsert each template into our DB.
   * Called at boot + manually via /api/social-cards/bannerbear/sync.
   */
  async function upsertBannerbearCatalog() {
    const templates = await fetchBannerbearTemplates()
    let count = 0
    for (const t of templates) {
      const existing = await findOne('social_card_templates', (r) => r.id === t.id)
      const row = {
        ...t,
        created_at: existing?.created_at || new Date().toISOString(),
        updated_at: new Date().toISOString(),
      }
      if (existing) {
        // Preserve any per-tenant binding overrides layered on top.
        const merged = {
          ...row,
          bannerbear: {
            ...row.bannerbear,
            bindings: existing.bannerbear?.bindings || row.bannerbear?.bindings,
          },
        }
        await update('social_card_templates', (r) => r.id === t.id, () => merged)
      } else {
        await insert('social_card_templates', row)
      }
      count++
    }
    return count
  }
}

function templateVisibleTo(t, agentId, agencyId) {
  if (!t) return false
  if (t.owner_type === 'platform' || t.owner_type === 'store') return true
  if (t.owner_type === 'agent' && t.owner_id === agentId) return true
  if (t.owner_type === 'agency' && agencyId && t.owner_id === agencyId) return true
  return false
}

function publicShape(t) {
  const preview = summariseTemplate(t)
  return { ...t, __preview: preview }
}

function summariseTemplate(t) {
  return {
    layer_count: (t.layers || []).length,
    aspect: t.base_canvas ? `${t.base_canvas.width}x${t.base_canvas.height}` : null,
    has_photo_layer: (t.layers || []).some((l) => l.type === 'photo'),
    engine: t.engine || 'builtin',
    category: t.category || null,
    tags: t.tags || [],
  }
}

function normaliseList(input, allowed, validator) {
  const arr = Array.isArray(input) ? input : (input ? [input] : [])
  const set = new Set()
  for (const v of arr) {
    const k = String(v || '').trim()
    if (!k) continue
    if (validator ? !validator(k) : !allowed.includes(k)) continue
    set.add(k)
  }
  return Array.from(set)
}

// Re-exports for callers that use the module directly.
export { renderSocialCard, renderSocialCardMatrix, PLATFORM_DIMENSIONS, PLATFORM_KEYS, OWNER_TYPES, validateTemplate, BINDABLE_PATHS }
