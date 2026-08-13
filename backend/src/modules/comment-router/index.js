/**
 * Comment router module — public entrypoint.
 *
 * Exposes the router dispatcher and the tenant-facing routing_config
 * endpoints. Called from server.js after the classifier stage runs.
 */

import {
  DEFAULT_ROUTING_CONFIG,
  ROUTING_CATEGORIES,
  loadRoutingConfig,
  upsertRoutingConfig,
} from './config.js'
import { routeClassifiedMessage } from './router.js'
import { findAll } from '../../db.js'

export {
  DEFAULT_ROUTING_CONFIG,
  ROUTING_CATEGORIES,
  loadRoutingConfig,
  upsertRoutingConfig,
  routeClassifiedMessage,
}

/**
 * Register the tenant routing-config CRUD routes. The dispatcher itself is
 * invoked directly from ingestInboundMessage + the AI reclassifier worker
 * (see server.js), so no HTTP surface is required for dispatch.
 */
export function registerCommentRouterRoutes(app, { authMiddleware }) {
  const auth = authMiddleware || ((_req, _res, next) => next())

  app.get('/api/routing-config', auth, async (req, res) => {
    const agentId = req.user?.id
    const agency = agentId
      ? (await findAll('agents', (a) => a.id === agentId))[0]
      : null
    const agencyId = agency?.agency_id || null
    const effective = await loadRoutingConfig({ agentId, agencyId })
    res.json({ config: effective, agency_id: agencyId, agent_id: agentId })
  })

  app.get('/api/routing-config/defaults', auth, (_req, res) => {
    res.json({ defaults: DEFAULT_ROUTING_CONFIG, categories: ROUTING_CATEGORIES })
  })

  app.put('/api/routing-config', auth, async (req, res) => {
    const ownerType = req.body?.owner_type === 'agency' ? 'agency' : 'agent'
    let ownerId
    if (ownerType === 'agent') {
      ownerId = req.user?.id
    } else {
      const agents = await findAll('agents', (a) => a.id === req.user?.id)
      ownerId = agents[0]?.agency_id
      if (!ownerId) return res.status(400).json({ error: 'You are not affiliated with an agency' })
      // TODO: also verify the user has an agency-admin role. For now, any
      // affiliated agent can write agency defaults.
    }
    try {
      const row = await upsertRoutingConfig({ ownerType, ownerId, routes: req.body?.routes || {} })
      res.json({ config: row })
    } catch (err) {
      res.status(400).json({ error: err.message })
    }
  })
}
