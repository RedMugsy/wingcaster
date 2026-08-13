import { authMiddleware } from '../../../auth.js'
import { AreaStatus } from '../domain/types.js'

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

export function registerAdminRoutes(
  app,
  {
    areaService,
    dimensionService,
    sourceTypeService,
    sourceService,
    signalService,
    scoreService,
    aiConfigService,
    googleService,
    inspectorService,
    config,
    logger,
  }
) {
  // Areas
  app.get('/api/admin/areas', authMiddleware, requirePlatformAdmin, async (req, res) => {
    try {
      const { status, level, search, limit, offset } = req.query
      const result = await areaService.list({
        status,
        level,
        search,
        limit: Number(limit || 100),
        offset: Number(offset || 0),
      })
      res.json(result)
    } catch (err) {
      logger.error({ err: err.message }, 'Failed to list areas')
      res.status(500).json({ error: err.message })
    }
  })

  app.post('/api/admin/areas', authMiddleware, requirePlatformAdmin, async (req, res) => {
    try {
      const area = await areaService.create(req.body)
      res.status(201).json(area)
    } catch (err) {
      logger.error({ err: err.message }, 'Failed to create area')
      res.status(500).json({ error: err.message })
    }
  })

  app.get('/api/admin/areas/:id', authMiddleware, requirePlatformAdmin, async (req, res) => {
    try {
      const area = await areaService.getById(req.params.id)
      if (!area) return res.status(404).json({ error: 'Area not found' })
      res.json(area)
    } catch (err) {
      logger.error({ err: err.message }, 'Failed to get area')
      res.status(500).json({ error: err.message })
    }
  })

  app.put('/api/admin/areas/:id', authMiddleware, requirePlatformAdmin, async (req, res) => {
    try {
      const area = await areaService.update(req.params.id, req.body)
      if (!area) return res.status(404).json({ error: 'Area not found' })
      res.json(area)
    } catch (err) {
      logger.error({ err: err.message }, 'Failed to update area')
      res.status(500).json({ error: err.message })
    }
  })

  app.delete('/api/admin/areas/:id', authMiddleware, requirePlatformAdmin, async (req, res) => {
    try {
      await areaService.remove(req.params.id)
      res.json({ success: true })
    } catch (err) {
      logger.error({ err: err.message }, 'Failed to delete area')
      res.status(500).json({ error: err.message })
    }
  })

  app.post('/api/admin/areas/:id/enable-scoring', authMiddleware, requirePlatformAdmin, async (req, res) => {
    try {
      const area = await areaService.update(req.params.id, { status: AreaStatus.SCORING_ENABLED })
      if (!area) return res.status(404).json({ error: 'Area not found' })
      res.json(area)
    } catch (err) {
      logger.error({ err: err.message }, 'Failed to enable scoring')
      res.status(500).json({ error: err.message })
    }
  })

  app.post('/api/admin/areas/:id/disable-scoring', authMiddleware, requirePlatformAdmin, async (req, res) => {
    try {
      const area = await areaService.update(req.params.id, { status: AreaStatus.DRAFT })
      if (!area) return res.status(404).json({ error: 'Area not found' })
      res.json(area)
    } catch (err) {
      logger.error({ err: err.message }, 'Failed to disable scoring')
      res.status(500).json({ error: err.message })
    }
  })

  // Score dimensions
  app.get('/api/admin/scoring/dimensions', authMiddleware, requirePlatformAdmin, async (req, res) => {
    try {
      const { isActive, isDefault, search } = req.query
      const items = await dimensionService.list({
        isActive: isActive !== undefined ? isActive === 'true' : undefined,
        isDefault: isDefault !== undefined ? isDefault === 'true' : undefined,
        search,
      })
      res.json({ items })
    } catch (err) {
      logger.error({ err: err.message }, 'Failed to list dimensions')
      res.status(500).json({ error: err.message })
    }
  })

  app.post('/api/admin/scoring/dimensions', authMiddleware, requirePlatformAdmin, async (req, res) => {
    try {
      const dim = await dimensionService.create(req.body)
      res.status(201).json(dim)
    } catch (err) {
      logger.error({ err: err.message }, 'Failed to create dimension')
      res.status(500).json({ error: err.message })
    }
  })

  app.get('/api/admin/scoring/dimensions/:id', authMiddleware, requirePlatformAdmin, async (req, res) => {
    try {
      const dim = await dimensionService.getById(req.params.id)
      if (!dim) return res.status(404).json({ error: 'Dimension not found' })
      res.json(dim)
    } catch (err) {
      logger.error({ err: err.message }, 'Failed to get dimension')
      res.status(500).json({ error: err.message })
    }
  })

  app.put('/api/admin/scoring/dimensions/:id', authMiddleware, requirePlatformAdmin, async (req, res) => {
    try {
      const dim = await dimensionService.update(req.params.id, req.body)
      if (!dim) return res.status(404).json({ error: 'Dimension not found' })
      res.json(dim)
    } catch (err) {
      logger.error({ err: err.message }, 'Failed to update dimension')
      res.status(500).json({ error: err.message })
    }
  })

  app.delete('/api/admin/scoring/dimensions/:id', authMiddleware, requirePlatformAdmin, async (req, res) => {
    try {
      await dimensionService.remove(req.params.id)
      res.json({ success: true })
    } catch (err) {
      logger.error({ err: err.message }, 'Failed to delete dimension')
      res.status(500).json({ error: err.message })
    }
  })

  // Source types
  app.get('/api/admin/scoring/source-types', authMiddleware, requirePlatformAdmin, async (req, res) => {
    try {
      const { isActive, isDefault, archetype, search } = req.query
      const items = await sourceTypeService.list({
        isActive: isActive !== undefined ? isActive === 'true' : undefined,
        isDefault: isDefault !== undefined ? isDefault === 'true' : undefined,
        archetype,
        search,
      })
      res.json({ items })
    } catch (err) {
      logger.error({ err: err.message }, 'Failed to list source types')
      res.status(500).json({ error: err.message })
    }
  })

  app.post('/api/admin/scoring/source-types', authMiddleware, requirePlatformAdmin, async (req, res) => {
    try {
      const st = await sourceTypeService.create(req.body)
      res.status(201).json(st)
    } catch (err) {
      logger.error({ err: err.message }, 'Failed to create source type')
      res.status(500).json({ error: err.message })
    }
  })

  app.get('/api/admin/scoring/source-types/:id', authMiddleware, requirePlatformAdmin, async (req, res) => {
    try {
      const st = await sourceTypeService.getById(req.params.id)
      if (!st) return res.status(404).json({ error: 'Source type not found' })
      res.json(st)
    } catch (err) {
      logger.error({ err: err.message }, 'Failed to get source type')
      res.status(500).json({ error: err.message })
    }
  })

  app.put('/api/admin/scoring/source-types/:id', authMiddleware, requirePlatformAdmin, async (req, res) => {
    try {
      const st = await sourceTypeService.update(req.params.id, req.body)
      if (!st) return res.status(404).json({ error: 'Source type not found' })
      res.json(st)
    } catch (err) {
      logger.error({ err: err.message }, 'Failed to update source type')
      res.status(500).json({ error: err.message })
    }
  })

  app.delete('/api/admin/scoring/source-types/:id', authMiddleware, requirePlatformAdmin, async (req, res) => {
    try {
      await sourceTypeService.remove(req.params.id)
      res.json({ success: true })
    } catch (err) {
      logger.error({ err: err.message }, 'Failed to delete source type')
      res.status(500).json({ error: err.message })
    }
  })

  // AI configs
  app.get('/api/admin/scoring/ai-configs', authMiddleware, requirePlatformAdmin, async (req, res) => {
    try {
      const { isActive } = req.query
      const items = await aiConfigService.list({
        isActive: isActive !== undefined ? isActive === 'true' : undefined,
      })
      res.json({ items })
    } catch (err) {
      logger.error({ err: err.message }, 'Failed to list AI configs')
      res.status(500).json({ error: err.message })
    }
  })

  app.post('/api/admin/scoring/ai-configs', authMiddleware, requirePlatformAdmin, async (req, res) => {
    try {
      const cfg = await aiConfigService.create(req.body)
      res.status(201).json(cfg)
    } catch (err) {
      logger.error({ err: err.message }, 'Failed to create AI config')
      res.status(500).json({ error: err.message })
    }
  })

  app.get('/api/admin/scoring/ai-configs/:id', authMiddleware, requirePlatformAdmin, async (req, res) => {
    try {
      const cfg = await aiConfigService.getById(req.params.id)
      if (!cfg) return res.status(404).json({ error: 'AI config not found' })
      res.json(cfg)
    } catch (err) {
      logger.error({ err: err.message }, 'Failed to get AI config')
      res.status(500).json({ error: err.message })
    }
  })

  app.put('/api/admin/scoring/ai-configs/:id', authMiddleware, requirePlatformAdmin, async (req, res) => {
    try {
      const cfg = await aiConfigService.update(req.params.id, req.body)
      if (!cfg) return res.status(404).json({ error: 'AI config not found' })
      res.json(cfg)
    } catch (err) {
      logger.error({ err: err.message }, 'Failed to update AI config')
      res.status(500).json({ error: err.message })
    }
  })

  app.delete('/api/admin/scoring/ai-configs/:id', authMiddleware, requirePlatformAdmin, async (req, res) => {
    try {
      await aiConfigService.remove(req.params.id)
      res.json({ success: true })
    } catch (err) {
      logger.error({ err: err.message }, 'Failed to delete AI config')
      res.status(500).json({ error: err.message })
    }
  })

  // Area sources
  app.get('/api/admin/areas/:areaId/sources', authMiddleware, requirePlatformAdmin, async (req, res) => {
    try {
      const items = await sourceService.listForArea(req.params.areaId, {
        isMonitored: req.query.is_monitored !== undefined ? req.query.is_monitored === 'true' : undefined,
      })
      res.json({ items })
    } catch (err) {
      logger.error({ err: err.message }, 'Failed to list area sources')
      res.status(500).json({ error: err.message })
    }
  })

  app.post('/api/admin/areas/:areaId/sources', authMiddleware, requirePlatformAdmin, async (req, res) => {
    try {
      const source = await sourceService.create({ ...req.body, area_id: req.params.areaId })
      res.status(201).json(source)
    } catch (err) {
      logger.error({ err: err.message }, 'Failed to create area source')
      res.status(500).json({ error: err.message })
    }
  })

  app.put('/api/admin/areas/:areaId/sources/:id', authMiddleware, requirePlatformAdmin, async (req, res) => {
    try {
      const source = await sourceService.update(req.params.id, req.body)
      if (!source) return res.status(404).json({ error: 'Source not found' })
      res.json(source)
    } catch (err) {
      logger.error({ err: err.message }, 'Failed to update area source')
      res.status(500).json({ error: err.message })
    }
  })

  app.delete('/api/admin/areas/:areaId/sources/:id', authMiddleware, requirePlatformAdmin, async (req, res) => {
    try {
      await sourceService.remove(req.params.id)
      res.json({ success: true })
    } catch (err) {
      logger.error({ err: err.message }, 'Failed to delete area source')
      res.status(500).json({ error: err.message })
    }
  })

  // Signals
  app.get('/api/admin/scoring/signals', authMiddleware, requirePlatformAdmin, async (req, res) => {
    try {
      const { areaId, status, sourceTypeId, limit, offset } = req.query
      const result = await signalService.list({
        areaId,
        status,
        sourceTypeId,
        limit: Number(limit || 100),
        offset: Number(offset || 0),
      })
      res.json(result)
    } catch (err) {
      logger.error({ err: err.message }, 'Failed to list signals')
      res.status(500).json({ error: err.message })
    }
  })

  app.post('/api/admin/scoring/signals/:id/verify', authMiddleware, requirePlatformAdmin, async (req, res) => {
    try {
      const signal = await signalService.verify(req.params.id, {
        verifiedBy: req.user.id,
        notes: req.body.notes,
      })
      if (!signal) return res.status(404).json({ error: 'Signal not found' })
      res.json(signal)
    } catch (err) {
      logger.error({ err: err.message }, 'Failed to verify signal')
      res.status(500).json({ error: err.message })
    }
  })

  app.post('/api/admin/scoring/signals/:id/reject', authMiddleware, requirePlatformAdmin, async (req, res) => {
    try {
      const signal = await signalService.reject(req.params.id, {
        verifiedBy: req.user.id,
        reason: req.body.reason,
      })
      if (!signal) return res.status(404).json({ error: 'Signal not found' })
      res.json(signal)
    } catch (err) {
      logger.error({ err: err.message }, 'Failed to reject signal')
      res.status(500).json({ error: err.message })
    }
  })

  // Score calculation
  app.post('/api/admin/scoring/calculate', authMiddleware, requirePlatformAdmin, async (req, res) => {
    try {
      const { area_id } = req.body
      if (!area_id) return res.status(400).json({ error: 'area_id is required' })

      const area = await areaService.getById(area_id)
      if (!area) return res.status(404).json({ error: 'Area not found' })

      const dimensions = await dimensionService.list({ isActive: true })
      const signals = await signalService.list({ areaId: area.id, limit: 10000 })
      const submissions = await inspectorService.listSubmissions({
        areaId: area.id,
        status: 'approved',
        limit: 10000,
      })
      const aiConfig = await aiConfigService.getActive()

      const results = await scoreService.calculateForArea(area, dimensions, {
        signals: signals.items || [],
        submissions: submissions || [],
        aiConfig,
      })

      res.json({ area_id: area.id, calculated: results.length, results })
    } catch (err) {
      logger.error({ err: err.message }, 'Failed to calculate scores')
      res.status(500).json({ error: err.message })
    }
  })

  // Manual override
  app.post('/api/admin/scoring/override', authMiddleware, requirePlatformAdmin, async (req, res) => {
    try {
      const { area_id, dimension_id, score, rationale, reason } = req.body
      if (!area_id || !dimension_id || score == null) {
        return res.status(400).json({ error: 'area_id, dimension_id, and score are required' })
      }
      const recorded = await scoreService.manualOverride({
        areaId: area_id,
        dimensionId: dimension_id,
        score,
        rationale,
        overriddenBy: req.user.id,
        reason,
      })
      res.json(recorded)
    } catch (err) {
      logger.error({ err: err.message }, 'Failed to override score')
      res.status(500).json({ error: err.message })
    }
  })

  // Google usage
  app.get('/api/admin/google-usage', authMiddleware, requirePlatformAdmin, async (req, res) => {
    try {
      const { areaId, limit } = req.query
      const items = await googleService.listUsage({ areaId, limit: Number(limit || 100) })
      const monthlySpend = await googleService.getMonthlySpend()
      res.json({ items, monthly_spend_usd: monthlySpend, budget_usd_monthly: config.googleMapsBudgetUsdMonthly })
    } catch (err) {
      logger.error({ err: err.message }, 'Failed to list Google usage')
      res.status(500).json({ error: err.message })
    }
  })
}
