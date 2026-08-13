import { authMiddleware } from '../../../auth.js'

export function registerPublicRoutes(app, services) {
  const { analysisService, comparableService, trendService, configService, dal, logger } = services

  app.get('/api/pricing/analysis/:propertyId', async (req, res, next) => {
    try {
      const analysis = await analysisService.getAnalysis(req.params.propertyId, {
        matchConfigId: req.query.match_config_id || null,
      })
      res.json(analysis)
    } catch (err) {
      logger.warn({ err: err.message, propertyId: req.params.propertyId }, 'public price analysis failed')
      if (err.code === 'CURRENCY_RATE_UNAVAILABLE') {
        return res.status(503).json({ error: err.message, code: err.code, details: err.details })
      }
      next(err)
    }
  })

  app.get('/api/pricing/comparables/:propertyId', async (req, res, next) => {
    try {
      const config = await configService.getDefaultConfig()
      const property = await services.adapter.getPropertyById(req.params.propertyId)
      if (!property) return res.status(404).json({ error: 'Property not found' })
      const comparables = await comparableService.findComparables(property, {
        matchConfig: config?.config_json,
      })
      res.json(comparables)
    } catch (err) {
      logger.warn({ err: err.message, propertyId: req.params.propertyId }, 'public comparables failed')
      next(err)
    }
  })

  app.get('/api/pricing/trends/:areaId', async (req, res, next) => {
    try {
      const { property_type } = req.query
      if (!property_type) return res.status(400).json({ error: 'property_type query param is required' })
      const trends = await trendService.getTrends(req.params.areaId, property_type)
      res.json(trends)
    } catch (err) {
      logger.warn({ err: err.message, areaId: req.params.areaId }, 'public trends failed')
      next(err)
    }
  })

  app.post('/api/pricing/report-comparable', authMiddleware, async (req, res, next) => {
    try {
      const { comparable_id, comparable_type, reason, notes } = req.body
      if (!comparable_id || !comparable_type || !reason) {
        return res.status(400).json({ error: 'comparable_id, comparable_type, and reason are required' })
      }
      if (!['internal', 'external', 'agent_report'].includes(comparable_type)) {
        return res.status(400).json({ error: 'comparable_type must be internal, external, or agent_report' })
      }
      if (!['fake_listing', 'incorrect_price', 'already_sold', 'wrong_details', 'other'].includes(reason)) {
        return res.status(400).json({ error: 'Invalid report reason' })
      }
      const report = await dal.insert('comparable_reports', {
        id: crypto.randomUUID(),
        reporter_id: req.user?.id || null,
        comparable_id,
        comparable_type,
        reason,
        notes: notes || null,
        status: 'pending',
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
        data: {},
      })
      res.status(201).json(report)
    } catch (err) {
      logger.warn({ err: err.message }, 'report comparable failed')
      next(err)
    }
  })

  // Agent-reported sold prices. Authenticated agents can submit; platform admin reviews.
  app.post('/api/pricing/agent-price-reports', authMiddleware, async (req, res, next) => {
    try {
      const {
        property_id,
        external_property_title,
        external_property_location,
        property_type,
        bedrooms,
        bathrooms,
        area_sqm,
        sold_price,
        currency,
        sold_date,
        notes,
        supporting_document_url,
      } = req.body
      if (!sold_price || Number(sold_price) <= 0) {
        return res.status(400).json({ error: 'sold_price is required' })
      }
      if (sold_date && Number.isNaN(new Date(sold_date).getTime())) {
        return res.status(400).json({ error: 'sold_date must be a valid date' })
      }
      const normalizedCurrency = String(currency || 'USD').trim().toUpperCase()
      if (!/^[A-Z]{3,10}$/.test(normalizedCurrency)) {
        return res.status(400).json({ error: 'currency must be a valid currency code' })
      }
      const report = await dal.insert('agent_price_reports', {
        id: crypto.randomUUID(),
        reporter_id: req.user?.id || null,
        agent_id: req.user?.id || null,
        property_id: property_id || null,
        external_property_title: external_property_title || null,
        external_property_location: external_property_location || null,
        property_type: property_type || null,
        bedrooms: bedrooms != null ? Number(bedrooms) : null,
        bathrooms: bathrooms != null ? Number(bathrooms) : null,
        area_sqm: area_sqm != null ? Number(area_sqm) : null,
        sold_price: Number(sold_price),
        currency: normalizedCurrency,
        sold_date: sold_date || null,
        notes: notes || null,
        supporting_document_url: supporting_document_url || null,
        status: 'pending',
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
        data: {},
      })
      res.status(201).json(report)
    } catch (err) {
      logger.warn({ err: err.message }, 'agent price report failed')
      next(err)
    }
  })

  app.get('/api/pricing/my-comparable-reports', authMiddleware, async (req, res, next) => {
    try {
      const reports = await dal.findAll('comparable_reports', (report) => report.reporter_id === req.user.id)
      res.json(reports.sort((a, b) => new Date(b.created_at) - new Date(a.created_at)))
    } catch (err) { next(err) }
  })

  app.get('/api/pricing/my-agent-price-reports', authMiddleware, async (req, res, next) => {
    try {
      const reports = await dal.findAll('agent_price_reports', (report) => report.reporter_id === req.user.id)
      res.json(reports.sort((a, b) => new Date(b.created_at) - new Date(a.created_at)))
    } catch (err) { next(err) }
  })
}
