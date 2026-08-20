/**
 * Agent routes for the WhatsApp Listing module.
 */

import { authMiddleware } from '../../../auth.js'
import { findOne, update } from '../../../db.js'
import { Collections, findAllModule, findOneModule, updateModule } from '../infrastructure/db.js'
import { CreditScope } from '../domain/types.js'

export function registerAgentRoutes(app, { entitlements, credits, pipeline, config }) {
  app.get('/api/agent/whatsapp-listings/drafts', authMiddleware, async (req, res) => {
    try {
      const drafts = await findAllModule(Collections.DRAFTS, (d) => d.agent_id === req.user.id)
      const sorted = drafts.sort((a, b) => new Date(b.created_at) - new Date(a.created_at))
      res.json(sorted)
    } catch (err) {
      res.status(500).json({ error: err.message })
    }
  })

  app.get('/api/agent/whatsapp-listings/drafts/:id', authMiddleware, async (req, res) => {
    try {
      const draft = await findOneModule(Collections.DRAFTS, (d) => d.id === req.params.id && d.agent_id === req.user.id)
      if (!draft) return res.status(404).json({ error: 'Draft not found' })
      res.json(draft)
    } catch (err) {
      res.status(500).json({ error: err.message })
    }
  })

  app.post('/api/agent/whatsapp-listings/drafts/:id/approve', authMiddleware, async (req, res) => {
    try {
      const draft = await findOneModule(Collections.DRAFTS, (d) => d.id === req.params.id && d.agent_id === req.user.id)
      if (!draft) return res.status(404).json({ error: 'Draft not found' })
      const session = await findOneModule(Collections.SESSIONS, (s) => s.id === draft.session_id)
      if (!session) return res.status(404).json({ error: 'Session not found' })
      const result = await pipeline.publishDraft(session.id, { publishSocial: req.body.publish_social || false })
      res.json({ success: true, result })
    } catch (err) {
      res.status(500).json({ error: err.message })
    }
  })

  app.post('/api/agent/whatsapp-listings/drafts/:id/discard', authMiddleware, async (req, res) => {
    try {
      const draft = await findOneModule(Collections.DRAFTS, (d) => d.id === req.params.id && d.agent_id === req.user.id)
      if (!draft) return res.status(404).json({ error: 'Draft not found' })
      await pipeline.discardDraft(draft.session_id)
      res.json({ success: true })
    } catch (err) {
      res.status(500).json({ error: err.message })
    }
  })

  app.post('/api/agent/whatsapp-listings/drafts/:id/reprocess', authMiddleware, async (req, res) => {
    try {
      const draft = await findOneModule(Collections.DRAFTS, (d) => d.id === req.params.id && d.agent_id === req.user.id)
      if (!draft) return res.status(404).json({ error: 'Draft not found' })
      const session = await findOneModule(Collections.SESSIONS, (s) => s.id === draft.session_id)
      if (!session) return res.status(404).json({ error: 'Session not found' })
      await updateModule(Collections.SESSIONS, (s) => s.id === session.id, (s) => ({ ...s, state: 'collecting', updated_at: new Date().toISOString() }))
      res.json({ success: true, message: 'Send new details or photos to re-process.' })
    } catch (err) {
      res.status(500).json({ error: err.message })
    }
  })

  app.get('/api/agent/whatsapp-listings/settings', authMiddleware, async (req, res) => {
    try {
      const agent = await findOne('agents', (a) => a.id === req.user.id)
      const agencyId = agent?.agency_id || null
      const entitlement = await entitlements.getConfig({ agentId: req.user.id, agencyId })
      res.json({
        ai_provider_preference: agent?.whatsapp_listings_ai_provider || config.aiProvider,
        default_template_variant: agent?.whatsapp_listings_template_variant || 'modern',
        auto_publish_social: agent?.whatsapp_listings_auto_publish_social || entitlement.auto_publish_social || false,
        ai_providers_allowed: entitlement.ai_providers_allowed || [],
        thumbnail_variants_allowed: entitlement.thumbnail_variants || [],
      })
    } catch (err) {
      res.status(500).json({ error: err.message })
    }
  })

  app.patch('/api/agent/whatsapp-listings/settings', authMiddleware, async (req, res) => {
    try {
      const allowed = ['whatsapp_listings_ai_provider', 'whatsapp_listings_template_variant', 'whatsapp_listings_auto_publish_social']
      const patch = {}
      for (const key of allowed) {
        if (req.body[key] !== undefined) patch[key] = req.body[key]
      }
      await update('agents', (a) => a.id === req.user.id, (a) => ({ ...a, ...patch, updated_at: new Date().toISOString() }))
      res.json({ success: true })
    } catch (err) {
      res.status(500).json({ error: err.message })
    }
  })

  app.get('/api/agent/credits/balance', authMiddleware, async (req, res) => {
    try {
      const balance = await credits.balance(CreditScope.AGENT, req.user.id)
      res.json(balance)
    } catch (err) {
      res.status(500).json({ error: err.message })
    }
  })

  app.get('/api/agent/credits/transactions', authMiddleware, async (req, res) => {
    try {
      const rows = await credits.transactions(CreditScope.AGENT, req.user.id, { limit: req.query.limit || 100 })
      res.json(rows)
    } catch (err) {
      res.status(500).json({ error: err.message })
    }
  })

  app.post('/api/agent/credits/top-up', authMiddleware, async (req, res, next) => {
    try {
      const { handleCreditsTopUp } = await import('../../../fin/funding/http.js')
      const { query } = await import('../../../db.js')
      const tenants = await query(
        `SELECT id FROM public.tenants WHERE personal_owner_user_id = $1 LIMIT 1`,
        [req.user.id],
      )
      const publicTenantId = tenants[0]?.id || req.user.id
      return await handleCreditsTopUp(req, res, { publicTenantId, reasonCode: 'USER_TOPUP' })
    } catch (err) {
      next(err)
    }
  })

  app.get('/api/agent/whatsapp-listings/analytics', authMiddleware, async (req, res) => {
    try {
      const drafts = await findAllModule(Collections.DRAFTS, (d) => d.agent_id === req.user.id)
      const published = drafts.filter((d) => d.status === 'published').length
      const discarded = drafts.filter((d) => d.status === 'discarded').length
      const awaiting = drafts.filter((d) => d.status === 'awaiting_approval').length
      const quota = await entitlements.checkMonthlyQuota({ agentId: req.user.id })
      res.json({
        total_drafts: drafts.length,
        published,
        discarded,
        awaiting_approval: awaiting,
        approval_rate: drafts.length ? Math.round((published / drafts.length) * 100) : 0,
        quota,
      })
    } catch (err) {
      res.status(500).json({ error: err.message })
    }
  })
}
