/**
 * Agency admin routes for the WhatsApp Listing module.
 */

import { authMiddleware } from '../../../auth.js'
import {
  getAgencyMembership,
  listAgencyMemberships,
  listUserAgencyMemberships,
} from '../../../tenant-authorization.js'
import { CreditScope } from '../domain/types.js'
import { Collections, findAllModule } from '../infrastructure/db.js'

async function requireAgencyAdmin(req, res, next) {
  if (!req.user) return res.status(401).json({ error: 'Unauthorized' })
  try {
    const memberships = await listUserAgencyMemberships(req.user.id)
    const member = memberships.find((item) => ['admin', 'owner'].includes(item.role))
    if (!member) return res.status(403).json({ error: 'Forbidden: agency admin required' })
    req.agencyId = member.agency_id
    next()
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
}

export function registerAgencyRoutes(app, { entitlements, credits, pipeline, config }) {
  app.get('/api/agency/entitlements', authMiddleware, requireAgencyAdmin, async (req, res) => {
    try {
      const agencyMembers = await listAgencyMemberships(req.agencyId)
      const agentIds = agencyMembers.map((m) => m.user_id)
      const all = await entitlements.listEntitlements({ scope: 'agent' })
      const rows = all.filter((e) => agentIds.includes(e.scope_id))
      res.json(rows)
    } catch (err) {
      res.status(500).json({ error: err.message })
    }
  })

  app.post('/api/agency/entitlements', authMiddleware, requireAgencyAdmin, async (req, res) => {
    try {
      const { agent_id, enabled, config: entitlementConfig } = req.body
      if (!agent_id) return res.status(400).json({ error: 'agent_id is required' })
      const member = await getAgencyMembership(req.agencyId, agent_id)
      if (!member) return res.status(403).json({ error: 'Agent is not in your agency' })

      const existing = (await entitlements.listEntitlements({ scope: 'agent', scope_id: agent_id }))[0]
      if (existing) {
        res.json(await entitlements.updateEntitlement(existing.id, { enabled, config: entitlementConfig }))
      } else {
        res.status(201).json(await entitlements.createEntitlement({ scope: 'agent', scope_id: agent_id, enabled, config: entitlementConfig }))
      }
    } catch (err) {
      res.status(500).json({ error: err.message })
    }
  })

  app.patch('/api/agency/entitlements/:id', authMiddleware, requireAgencyAdmin, async (req, res) => {
    try {
      const entitlement = (await entitlements.listEntitlements({})).find((e) => e.id === req.params.id)
      // Return 404 instead of 403 for cross-agency entitlements — otherwise
      // callers can enumerate entitlement IDs by probing for 403 vs 404.
      if (!entitlement) return res.status(404).json({ error: 'Entitlement not found' })
      if (entitlement.scope === 'agent') {
        const member = await getAgencyMembership(req.agencyId, entitlement.scope_id)
        if (!member) return res.status(404).json({ error: 'Entitlement not found' })
      } else if (entitlement.scope === 'agency') {
        // Cross-agency entitlement PATCH must be blocked — an agency admin
        // can only mutate entitlements scoped to their OWN agency.
        if (entitlement.scope_id !== req.agencyId) {
          return res.status(404).json({ error: 'Entitlement not found' })
        }
      } else {
        // 'platform'-scoped entitlements are platform-admin only.
        return res.status(403).json({ error: 'Platform-scoped entitlements are managed by platform admins' })
      }
      res.json(await entitlements.updateEntitlement(req.params.id, req.body))
    } catch (err) {
      res.status(500).json({ error: err.message })
    }
  })

  app.get('/api/agency/whatsapp-listings/usage', authMiddleware, requireAgencyAdmin, async (req, res) => {
    try {
      const agencyMembers = await listAgencyMemberships(req.agencyId)
      const agentIds = new Set(agencyMembers.map((m) => m.user_id))
      const drafts = await findAllModule(Collections.DRAFTS, (d) => agentIds.has(d.agent_id))

      const byAgent = {}
      for (const d of drafts) {
        byAgent[d.agent_id] = byAgent[d.agent_id] || { drafts: 0, published: 0, discarded: 0, error: 0 }
        byAgent[d.agent_id].drafts += 1
        if (d.status === 'published') byAgent[d.agent_id].published += 1
        if (d.status === 'discarded') byAgent[d.agent_id].discarded += 1
        if (d.status === 'error') byAgent[d.agent_id].error += 1
      }

      res.json({
        agency_id: req.agencyId,
        total_drafts: drafts.length,
        by_agent: byAgent,
      })
    } catch (err) {
      res.status(500).json({ error: err.message })
    }
  })

  app.get('/api/agency/credits/balance', authMiddleware, requireAgencyAdmin, async (req, res) => {
    try {
      const balance = await credits.balance(CreditScope.AGENCY, req.agencyId)
      res.json(balance)
    } catch (err) {
      res.status(500).json({ error: err.message })
    }
  })

  app.post('/api/agency/credits/top-up', authMiddleware, requireAgencyAdmin, async (req, res, next) => {
    try {
      const { handleCreditsTopUp } = await import('../../../fin/funding/http.js')
      return await handleCreditsTopUp(req, res, {
        publicTenantId: req.agencyId,
        reasonCode: 'USER_TOPUP',
      })
    } catch (err) {
      next(err)
    }
  })

  app.post('/api/agency/credits/allocate', authMiddleware, requireAgencyAdmin, async (req, res) => {
    try {
      const { agent_id, amount_usd } = req.body
      if (!agent_id || !amount_usd || Number(amount_usd) <= 0) return res.status(400).json({ error: 'agent_id and amount_usd are required' })
      const member = await getAgencyMembership(req.agencyId, agent_id)
      if (!member) return res.status(403).json({ error: 'Agent is not in your agency' })
      const result = await credits.allocateAgencyToAgent(req.agencyId, agent_id, Number(amount_usd))
      if (!result.ok) return res.status(400).json({ error: result.error })
      res.json(result)
    } catch (err) {
      res.status(500).json({ error: err.message })
    }
  })

  app.get('/api/agency/credits/transactions', authMiddleware, requireAgencyAdmin, async (req, res) => {
    try {
      const rows = await credits.transactions(CreditScope.AGENCY, req.agencyId, { limit: req.query.limit || 100 })
      res.json(rows)
    } catch (err) {
      res.status(500).json({ error: err.message })
    }
  })
}
