/**
 * Platform admin routes for the WhatsApp Listing module.
 */

import { v4 as uuidv4 } from 'uuid'
import { authMiddleware } from '../../../auth.js'
import { Collections, findAllModule, insertModule } from '../infrastructure/db.js'

async function requirePlatformAdmin(req, res, next) {
  if (!req.user) return res.status(401).json({ error: 'Unauthorized' })
  try {
    if (req.user.platform_role !== 'platform_admin') {
      return res.status(403).json({ error: 'Forbidden: platform admin required' })
    }
    next()
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
}

export function registerAdminRoutes(app, { entitlements, credits, pipeline, config }) {
  app.get('/api/admin/whatsapp-listings/health', authMiddleware, requirePlatformAdmin, (_req, res) => {
    res.json({
      enabled: true,
      ai_provider: config.aiProvider,
      fallback_providers: config.fallbackAiProviders,
      storage_path: config.storagePath,
    })
  })

  app.get('/api/admin/entitlements', authMiddleware, requirePlatformAdmin, async (req, res) => {
    try {
      const { scope, scope_id, feature } = req.query
      const rows = await entitlements.listEntitlements({ scope, scope_id, feature })
      res.json(rows)
    } catch (err) {
      res.status(500).json({ error: err.message })
    }
  })

  app.post('/api/admin/entitlements', authMiddleware, requirePlatformAdmin, async (req, res) => {
    try {
      const { scope, scope_id, feature, enabled, config: entitlementConfig } = req.body
      if (!scope || !scope_id) return res.status(400).json({ error: 'scope and scope_id are required' })
      const created = await entitlements.createEntitlement({ scope, scope_id, feature, enabled, config: entitlementConfig })
      res.status(201).json(created)
    } catch (err) {
      res.status(500).json({ error: err.message })
    }
  })

  app.delete('/api/admin/entitlements/:id', authMiddleware, requirePlatformAdmin, async (req, res) => {
    try {
      await entitlements.deleteEntitlement(req.params.id)
      res.json({ success: true })
    } catch (err) {
      res.status(500).json({ error: err.message })
    }
  })

  app.get('/api/admin/whatsapp-listings/usage', authMiddleware, requirePlatformAdmin, async (_req, res) => {
    try {
      const drafts = await findAllModule(Collections.DRAFTS, () => true)
      const transactions = await findAllModule(Collections.AI_CREDIT_TRANSACTIONS, () => true)

      const now = new Date()
      const startOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate()).toISOString()
      const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1).toISOString()

      const byAgent = {}
      for (const d of drafts) {
        byAgent[d.agent_id] = byAgent[d.agent_id] || { drafts: 0, approved: 0, published: 0, discarded: 0, error: 0 }
        byAgent[d.agent_id].drafts += 1
        if (d.status === 'approved' || d.status === 'published') byAgent[d.agent_id].approved += 1
        if (d.status === 'published') byAgent[d.agent_id].published += 1
        if (d.status === 'discarded') byAgent[d.agent_id].discarded += 1
        if (d.status === 'error') byAgent[d.agent_id].error += 1
      }

      res.json({
        total_drafts: drafts.length,
        drafts_today: drafts.filter((d) => d.created_at >= startOfDay).length,
        drafts_this_month: drafts.filter((d) => d.created_at >= startOfMonth).length,
        ai_credits_consumed: transactions.filter((t) => t.type === 'consumption').reduce((sum, t) => sum + Number(t.amount), 0),
        ai_credits_consumed_today: transactions.filter((t) => t.type === 'consumption' && t.created_at >= startOfDay).reduce((sum, t) => sum + Number(t.amount), 0),
        approval_rate: drafts.length ? Math.round(((drafts.filter((d) => d.status === 'published').length / drafts.length) * 100)) : 0,
        by_agent: byAgent,
      })
    } catch (err) {
      res.status(500).json({ error: err.message })
    }
  })

  app.get('/api/admin/whatsapp-listings/audit-log', authMiddleware, requirePlatformAdmin, async (req, res) => {
    try {
      const { agent_id, limit = 100, offset = 0 } = req.query
      let logs = await findAllModule(Collections.AUDIT_LOGS, () => true)
      if (agent_id) logs = logs.filter((l) => l.agent_id === agent_id)
      logs = logs.sort((a, b) => new Date(b.created_at) - new Date(a.created_at))
      const total = logs.length
      const items = logs.slice(Number(offset), Number(offset) + Number(limit))
      res.json({ total, offset: Number(offset), limit: Number(limit), items })
    } catch (err) {
      res.status(500).json({ error: err.message })
    }
  })

  app.post('/api/admin/whatsapp-listings/audit-log', authMiddleware, requirePlatformAdmin, async (req, res) => {
    try {
      const log = await insertModule(Collections.AUDIT_LOGS, {
        id: uuidv4(),
        ...req.body,
        created_at: new Date().toISOString(),
      })
      res.status(201).json(log)
    } catch (err) {
      res.status(500).json({ error: err.message })
    }
  })
}
