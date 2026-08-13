export function registerPublicRoutes(
  app,
  { areaService, scoreService, dimensionService, googleService, adapter, config, logger }
) {
  app.get('/api/areas', async (req, res) => {
    try {
      const { level, search, limit, offset } = req.query
      const result = await areaService.listPublic({
        level,
        search,
        limit: Number(limit || 100),
        offset: Number(offset || 0),
      })
      res.json(result)
    } catch (err) {
      logger.error({ err: err.message }, 'Failed to list public areas')
      res.status(500).json({ error: err.message })
    }
  })

  app.get('/api/areas/:slug', async (req, res) => {
    try {
      const area = await areaService.getBySlug(req.params.slug)
      if (!area) return res.status(404).json({ error: 'Area not found' })
      if (area.status !== 'scoring_enabled') {
        return res.status(404).json({ error: 'Area not found' })
      }

      const [scores, dimensions] = await Promise.all([
        scoreService.getCurrentScores(area.id),
        dimensionService.list({ isActive: true }),
      ])

      const scoreMap = new Map(scores.map((s) => [s.dimension_id, s]))
      const scoreCards = dimensions.map((d) => {
        const calc = scoreMap.get(d.id)
        return {
          dimension: d,
          score: calc?.score_value ?? null,
          confidence: calc?.confidence ?? null,
          rationale: calc?.score_rationale ?? null,
          calculated_at: calc?.calculated_at ?? null,
        }
      })

      res.json({ area, scores: scoreCards })
    } catch (err) {
      logger.error({ err: err.message, slug: req.params.slug }, 'Failed to get public area')
      res.status(500).json({ error: err.message })
    }
  })

  app.get('/api/areas/:slug/scores', async (req, res) => {
    try {
      const area = await areaService.getBySlug(req.params.slug)
      if (!area || area.status !== 'scoring_enabled') {
        return res.status(404).json({ error: 'Area not found' })
      }
      const scores = await scoreService.getCurrentScores(area.id)
      res.json({ area_id: area.id, scores })
    } catch (err) {
      logger.error({ err: err.message, slug: req.params.slug }, 'Failed to get area scores')
      res.status(500).json({ error: err.message })
    }
  })

  app.get('/api/areas/:slug/google-scores', async (req, res) => {
    try {
      const area = await areaService.getBySlug(req.params.slug)
      if (!area || area.status !== 'scoring_enabled') {
        return res.status(404).json({ error: 'Area not found' })
      }
      const items = await googleService.listCachedScores(area.id)
      res.json({ items })
    } catch (err) {
      logger.error({ err: err.message, slug: req.params.slug }, 'Failed to get Google cached scores')
      res.status(500).json({ error: err.message })
    }
  })

  app.get('/api/areas/:slug/properties', async (req, res) => {
    try {
      const area = await areaService.getBySlug(req.params.slug)
      if (!area || area.status !== 'scoring_enabled') {
        return res.status(404).json({ error: 'Area not found' })
      }
      const items = await adapter?.getPropertiesForArea?.(area.id, {
        limit: Number(req.query.limit || 20),
      }) || []
      res.json({ items })
    } catch (err) {
      logger.error({ err: err.message, slug: req.params.slug }, 'Failed to get area properties')
      res.status(500).json({ error: err.message })
    }
  })

  app.get('/api/areas/:slug/comparison', async (req, res) => {
    try {
      const { with: otherSlug } = req.query
      if (!otherSlug) return res.status(400).json({ error: 'with query parameter is required' })

      const [areaA, areaB] = await Promise.all([
        areaService.getBySlug(req.params.slug),
        areaService.getBySlug(otherSlug),
      ])

      if (!areaA || areaA.status !== 'scoring_enabled') {
        return res.status(404).json({ error: 'Primary area not found' })
      }
      if (!areaB || areaB.status !== 'scoring_enabled') {
        return res.status(404).json({ error: 'Comparison area not found' })
      }

      const [scoresA, scoresB, dimensions] = await Promise.all([
        scoreService.getCurrentScores(areaA.id),
        scoreService.getCurrentScores(areaB.id),
        dimensionService.list({ isActive: true }),
      ])

      const mapA = new Map(scoresA.map((s) => [s.dimension_id, s]))
      const mapB = new Map(scoresB.map((s) => [s.dimension_id, s]))

      const comparisons = dimensions.map((d) => {
        const a = mapA.get(d.id)
        const b = mapB.get(d.id)
        return {
          dimension: d,
          area_a: { score: a?.score_value ?? null, confidence: a?.confidence ?? null },
          area_b: { score: b?.score_value ?? null, confidence: b?.confidence ?? null },
        }
      })

      res.json({ area_a: areaA, area_b: areaB, comparisons })
    } catch (err) {
      logger.error({ err: err.message }, 'Failed to compare areas')
      res.status(500).json({ error: err.message })
    }
  })
}
