import { authMiddleware } from '../../../auth.js'
import { v4 as uuidv4 } from 'uuid'
import { Collections } from '../infrastructure/db.js'
import { listAgencyMemberships, listUserAgencyMemberships } from '../../../tenant-authorization.js'

export function registerRoleRoutes(app, services) {
  const { dal, analysisService, recalculationJobService, logger } = services

  app.get('/api/agent/pricing/portfolio', authMiddleware, async (req, res, next) => {
    try {
      const properties = await dal.findAll('properties', (property) => property.agent_id === req.user.id && property.status !== 'deleted')
      const listings = await analyzePortfolio(properties, analysisService, logger)
      const reports = await dal.findAll(Collections.AGENT_PRICE_REPORTS, (report) => report.reporter_id === req.user.id)
      const decisions = await dal.findAll(Collections.PRICING_DECISIONS, (decision) => decision.actor_id === req.user.id)
      res.json({ summary: summarize(listings), listings, reports: newestFirst(reports), decisions: newestFirst(decisions) })
    } catch (err) { next(err) }
  })

  app.get('/api/agency/pricing/portfolio', authMiddleware, async (req, res, next) => {
    try {
      const userMemberships = await listUserAgencyMemberships(req.user.id)
      const membership = userMemberships.find((item) => item.affiliation_mode === 'exclusive')
      if (!membership) return res.status(403).json({ error: 'Active agency membership required' })
      const members = await listAgencyMemberships(membership.agency_id)
      const memberIds = new Set(members.map((member) => member.user_id))
      const agents = await dal.findAll('agents', (agent) => memberIds.has(agent.id))
      const agentNames = new Map(agents.map((agent) => [agent.id, agent.name || agent.email || agent.id]))
      const properties = await dal.findAll('properties', (property) =>
        property.status !== 'deleted' && (property.agency_id === membership.agency_id || memberIds.has(property.agent_id))
      )
      const listings = (await analyzePortfolio(properties, analysisService, logger)).map((listing) => ({
        ...listing,
        agent_name: agentNames.get(listing.agent_id) || listing.agent_id || 'Unassigned',
      }))
      const agentSummaries = [...memberIds].map((agentId) => {
        const agentListings = listings.filter((listing) => listing.agent_id === agentId)
        return { agent_id: agentId, agent_name: agentNames.get(agentId) || agentId, ...summarize(agentListings) }
      })
      const reports = await dal.findAll(Collections.AGENT_PRICE_REPORTS, (report) => memberIds.has(report.reporter_id))
      res.json({
        agency_id: membership.agency_id,
        my_role: membership.role,
        summary: summarize(listings),
        agents: agentSummaries,
        listings,
        reports: newestFirst(reports),
      })
    } catch (err) { next(err) }
  })

  app.post('/api/agent/pricing/properties/:propertyId/keep-price', authMiddleware, async (req, res, next) => {
    try {
      const property = await ownedProperty(dal, req.params.propertyId, req.user.id)
      if (!property) return res.status(404).json({ error: 'Owned property not found' })
      const analysis = await dal.findOne(Collections.PROPERTY_PRICE_ANALYSES, (item) => item.property_id === property.id)
      const decision = await recordDecision(dal, {
        property,
        actorId: req.user.id,
        analysisId: analysis?.id || null,
        action: 'keep_price',
        newPrice: property.price,
        reason: req.body.reason,
      })
      res.status(201).json(decision)
    } catch (err) { next(err) }
  })

  app.post('/api/agent/pricing/properties/:propertyId/adjust-price', authMiddleware, async (req, res, next) => {
    try {
      const property = await ownedProperty(dal, req.params.propertyId, req.user.id)
      if (!property) return res.status(404).json({ error: 'Owned property not found' })
      const newPrice = Number(req.body.new_price)
      if (!Number.isFinite(newPrice) || newPrice <= 0) return res.status(400).json({ error: 'new_price must be a positive number' })
      const analysis = await dal.findOne(Collections.PROPERTY_PRICE_ANALYSES, (item) => item.property_id === property.id)
      const updated = { ...property, price: newPrice, updated_at: new Date().toISOString() }
      await dal.update('properties', (item) => item.id === property.id, () => updated)
      const decision = await recordDecision(dal, {
        property,
        actorId: req.user.id,
        analysisId: analysis?.id || null,
        action: 'adjust_price',
        newPrice,
        reason: req.body.reason,
      })
      await recalculationJobService.invalidateForPropertyChange(updated)
      res.status(201).json({ decision, property: updated })
    } catch (err) { next(err) }
  })
}

async function analyzePortfolio(properties, analysisService, logger) {
  return Promise.all(properties.map(async (property) => {
    try {
      const analysis = await analysisService.getAnalysis(property.id)
      return { ...property, pricing_analysis: analysis, pricing_error: null }
    } catch (err) {
      logger.warn({ err: err.message, propertyId: property.id }, 'Portfolio pricing analysis unavailable')
      return { ...property, pricing_analysis: null, pricing_error: { code: err.code || 'ANALYSIS_UNAVAILABLE', message: err.message } }
    }
  }))
}

function summarize(listings) {
  const analyses = listings.map((listing) => listing.pricing_analysis).filter(Boolean)
  return {
    total_listings: listings.length,
    analyzed_listings: analyses.length,
    above_market: analyses.filter((analysis) => analysis.target_vs_median === 'above').length,
    at_market: analyses.filter((analysis) => analysis.target_vs_median === 'at').length,
    below_market: analyses.filter((analysis) => analysis.target_vs_median === 'below').length,
    low_confidence: analyses.filter((analysis) => analysis.confidence === 'low').length,
    stale_rate: analyses.filter((analysis) => analysis.rate_is_stale).length,
    unavailable: listings.length - analyses.length,
  }
}

async function ownedProperty(dal, propertyId, actorId) {
  return dal.findOne('properties', (property) => property.id === propertyId && property.agent_id === actorId)
}

async function recordDecision(dal, { property, actorId, analysisId, action, newPrice, reason }) {
  const now = new Date().toISOString()
  return dal.insert(Collections.PRICING_DECISIONS, {
    id: uuidv4(),
    property_id: property.id,
    actor_id: actorId,
    analysis_id: analysisId,
    channel: 'web',
    action,
    old_price: Number(property.price) || null,
    new_price: Number(newPrice) || null,
    currency: property.currency || 'USD',
    reason: reason || null,
    created_at: now,
    updated_at: now,
    data: {},
  })
}

function newestFirst(rows) {
  return rows.sort((a, b) => new Date(b.created_at) - new Date(a.created_at))
}
