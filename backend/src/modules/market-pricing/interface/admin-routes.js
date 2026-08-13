import { authMiddleware } from '../../../auth.js'

async function requirePlatformAdmin(req, res, next) {
  if (!req.user) return res.status(401).json({ error: 'Unauthorized' })
  if (req.user.platform_role !== 'platform_admin') {
    return res.status(403).json({ error: 'Forbidden: platform admin required' })
  }
  next()
}

export function parseCsv(text) {
  if (!text || typeof text !== 'string') return { headers: [], rows: [] }
  const lines = text.split(/\r?\n/).filter((l) => l.trim().length > 0)
  if (lines.length === 0) return { headers: [], rows: [] }

  const headers = splitCsvLine(lines[0]).map((h) => h.trim().toLowerCase())
  const rows = []
  for (let i = 1; i < lines.length; i++) {
    const values = splitCsvLine(lines[i])
    const row = {}
    for (let j = 0; j < headers.length; j++) {
      row[headers[j]] = values[j] !== undefined ? values[j].trim() : ''
    }
    if (Object.values(row).some((v) => v !== '')) rows.push(row)
  }
  return { headers, rows }
}

function splitCsvLine(line) {
  const result = []
  let current = ''
  let inQuotes = false
  for (let i = 0; i < line.length; i++) {
    const char = line[i]
    const next = line[i + 1]
    if (char === '"') {
      if (inQuotes && next === '"') {
        current += '"'
        i++
      } else {
        inQuotes = !inQuotes
      }
    } else if (char === ',' && !inQuotes) {
      result.push(current)
      current = ''
    } else {
      current += char
    }
  }
  result.push(current)
  return result
}

export function normalizeExternalComparable(row) {
  const price = Number(row.price)
  if (!Number.isFinite(price) || price <= 0) return null

  return {
    source: String(row.source || 'manual_csv').trim().toLowerCase().replace(/[^a-z0-9]+/g, '_'),
    source_url: row.source_url || null,
    external_id: row.external_id || null,
    title: row.title || row.location_text || 'Imported comparable',
    price,
    currency: String(row.currency || 'USD').trim().toUpperCase(),
    price_normalized_usd: row.currency?.toUpperCase() === 'USD' ? price : null,
    property_type: String(row.property_type || 'apartment').trim().toLowerCase().replace(/[^a-z0-9]+/g, '_'),
    bedrooms: row.bedrooms ? Number(row.bedrooms) : null,
    bathrooms: row.bathrooms ? Number(row.bathrooms) : null,
    area_sqm: row.area_sqm ? Number(row.area_sqm) : null,
    condition: row.condition || 'unknown',
    furnished: row.furnished || 'unknown',
    view_type: row.view_type || 'unknown',
    payment_method: row.payment_method || 'unknown',
    location_text: row.location_text || row.city || null,
    latitude: row.latitude ? Number(row.latitude) : null,
    longitude: row.longitude ? Number(row.longitude) : null,
    status: 'active',
  }
}

export function registerAdminRoutes(app, services) {
  const {
    configService,
    currencyService,
    comparableService,
    analysisService,
    trendService,
    scraperService,
    recalculationJobService,
    dal,
    logger,
  } = services

  const admin = [authMiddleware, requirePlatformAdmin]
  const invalidateAllPricing = () => recalculationJobService?.invalidateAll
    ? recalculationJobService.invalidateAll({ enqueueJob: true })
    : Promise.resolve(null)

  // Match configs
  app.get('/api/admin/pricing/configs', admin, async (_req, res, next) => {
    try {
      res.json(await configService.listConfigs())
    } catch (err) { next(err) }
  })

  app.post('/api/admin/pricing/configs', admin, async (req, res, next) => {
    try {
      const created = await configService.createConfig(req.body)
      await invalidateAllPricing()
      res.status(201).json(created)
    } catch (err) { next(err) }
  })

  app.put('/api/admin/pricing/configs/:id', admin, async (req, res, next) => {
    try {
      const updated = await configService.updateConfig(req.params.id, req.body)
      if (!updated) return res.status(404).json({ error: 'Config not found' })
      await invalidateAllPricing()
      res.json(updated)
    } catch (err) { next(err) }
  })

  app.delete('/api/admin/pricing/configs/:id', admin, async (req, res, next) => {
    try {
      await configService.deleteConfig(req.params.id)
      await invalidateAllPricing()
      res.json({ success: true })
    } catch (err) { next(err) }
  })

  // Sources
  app.get('/api/admin/pricing/sources', admin, async (_req, res, next) => {
    try {
      res.json(await scraperService.listSources())
    } catch (err) { next(err) }
  })

  app.post('/api/admin/pricing/sources', admin, async (req, res, next) => {
    try {
      const created = await scraperService.createSource(req.body)
      await invalidateAllPricing()
      res.status(201).json(created)
    } catch (err) { next(err) }
  })

  app.put('/api/admin/pricing/sources/:source', admin, async (req, res, next) => {
    try {
      const updated = await scraperService.updateSource(req.params.source, req.body)
      if (!updated) return res.status(404).json({ error: 'Source not found' })
      await invalidateAllPricing()
      res.json(updated)
    } catch (err) { next(err) }
  })

  app.delete('/api/admin/pricing/sources/:source', admin, async (req, res, next) => {
    try {
      await scraperService.deleteSource(req.params.source)
      await invalidateAllPricing()
      res.json({ success: true })
    } catch (err) { next(err) }
  })

  // CSV import for external comparables
  app.post('/api/admin/pricing/external-comparables/import-csv', admin, async (req, res, next) => {
    try {
      const { csv_text } = req.body
      if (!csv_text || typeof csv_text !== 'string') {
        return res.status(400).json({ error: 'csv_text is required' })
      }
      const { rows } = parseCsv(csv_text)
      const imported = []
      const errors = []
      for (let i = 0; i < rows.length; i++) {
        const row = rows[i]
        const comparable = normalizeExternalComparable(row)
        if (!comparable) {
          errors.push({ row: i + 2, reason: 'Invalid or missing price' })
          continue
        }
        try {
          const inserted = await scraperService.upsertExternalComparable(comparable)
          imported.push(inserted)
        } catch (err) {
          errors.push({ row: i + 2, reason: err.message })
        }
      }
      await dal.insert('csv_import_logs', {
        id: crypto.randomUUID(),
        uploaded_by: req.user.id,
        source: 'manual_csv',
        filename: req.body.filename || 'import.csv',
        rows_received: rows.length,
        rows_imported: imported.length,
        rows_failed: errors.length,
        errors,
        created_at: new Date().toISOString(),
        data: {},
      })
      if (imported.length > 0) await invalidateAllPricing()
      res.json({ imported: imported.length, failed: errors.length, errors })
    } catch (err) { next(err) }
  })

  app.get('/api/admin/pricing/csv-import-logs', admin, async (_req, res, next) => {
    try {
      const logs = await dal.findAll('csv_import_logs', () => true)
      res.json(logs.sort((a, b) => new Date(b.created_at) - new Date(a.created_at)))
    } catch (err) { next(err) }
  })

  // Currency rates
  app.get('/api/admin/pricing/currency-rates', admin, async (_req, res, next) => {
    try {
      res.json(await currencyService.listRates())
    } catch (err) { next(err) }
  })

  app.post('/api/admin/pricing/currency-rates', admin, async (req, res, next) => {
    try {
      const created = await currencyService.createRate(req.body)
      await invalidateAllPricing()
      res.status(201).json(created)
    } catch (err) { next(err) }
  })

  app.put('/api/admin/pricing/currency-rates/:id', admin, async (req, res, next) => {
    try {
      const updated = await currencyService.updateRate(req.params.id, req.body)
      if (!updated) return res.status(404).json({ error: 'Rate not found' })
      await invalidateAllPricing()
      res.json(updated)
    } catch (err) { next(err) }
  })

  app.delete('/api/admin/pricing/currency-rates/:id', admin, async (req, res, next) => {
    try {
      await currencyService.deleteRate(req.params.id)
      await invalidateAllPricing()
      res.json({ success: true })
    } catch (err) { next(err) }
  })

  app.post('/api/admin/pricing/currency-rates/refresh', admin, async (_req, res, next) => {
    try {
      const result = await currencyService.refreshRates()
      if (!result) return res.status(503).json({ error: 'All currency rate providers failed' })
      await invalidateAllPricing()
      res.json(result)
    } catch (err) { next(err) }
  })

  // Normalization rules
  app.get('/api/admin/pricing/normalization-rules', admin, async (_req, res, next) => {
    try {
      const rules = await dal.findAll('pricing_normalization_rules', () => true)
      res.json(rules)
    } catch (err) { next(err) }
  })

  app.post('/api/admin/pricing/normalization-rules', admin, async (req, res, next) => {
    try {
      const rule = await dal.insert('pricing_normalization_rules', {
        id: crypto.randomUUID(),
        ...req.body,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
        data: req.body.data || {},
      })
      await invalidateAllPricing()
      res.status(201).json(rule)
    } catch (err) { next(err) }
  })

  app.put('/api/admin/pricing/normalization-rules/:id', admin, async (req, res, next) => {
    try {
      const existing = await dal.findOne('pricing_normalization_rules', (r) => r.id === req.params.id)
      if (!existing) return res.status(404).json({ error: 'Rule not found' })
      const updated = {
        ...existing,
        ...req.body,
        adjustment_percent: req.body.adjustment_percent !== undefined ? Number(req.body.adjustment_percent) : existing.adjustment_percent,
        updated_at: new Date().toISOString(),
        data: { ...existing.data, ...(req.body.data || {}) },
      }
      await dal.update('pricing_normalization_rules', (r) => r.id === req.params.id, () => updated)
      await invalidateAllPricing()
      res.json(updated)
    } catch (err) { next(err) }
  })

  app.delete('/api/admin/pricing/normalization-rules/:id', admin, async (req, res, next) => {
    try {
      await dal.remove('pricing_normalization_rules', (r) => r.id === req.params.id)
      await invalidateAllPricing()
      res.json({ success: true })
    } catch (err) { next(err) }
  })

  async function enqueueRecalculation(req, res, next) {
    try {
      const job = await recalculationJobService.enqueue(req.body, req.user.id)
      res.status(202).json({ success: true, job })
    } catch (err) {
      if (err.status === 400) return res.status(400).json({ error: err.message })
      next(err)
    }
  }

  // Compatibility alias; recalculation is now asynchronous and restart-safe.
  app.post('/api/admin/pricing/recalculate', admin, enqueueRecalculation)
  app.post('/api/admin/pricing/recalculation-jobs', admin, enqueueRecalculation)

  app.get('/api/admin/pricing/recalculation-jobs', admin, async (req, res, next) => {
    try {
      res.json(await recalculationJobService.list({ status: req.query.status, scope_type: req.query.scope_type }))
    } catch (err) { next(err) }
  })

  app.get('/api/admin/pricing/recalculation-jobs/:id', admin, async (req, res, next) => {
    try {
      const job = await recalculationJobService.get(req.params.id, { includeItems: req.query.include_items === 'true' })
      if (!job) return res.status(404).json({ error: 'Recalculation job not found' })
      res.json(job)
    } catch (err) { next(err) }
  })

  app.post('/api/admin/pricing/recalculation-jobs/:id/cancel', admin, async (req, res, next) => {
    try {
      const job = await recalculationJobService.cancel(req.params.id)
      if (!job) return res.status(404).json({ error: 'Recalculation job not found' })
      res.json(job)
    } catch (err) { next(err) }
  })

  app.post('/api/admin/pricing/recalculation-jobs/:id/retry-failed', admin, async (req, res, next) => {
    try {
      const job = await recalculationJobService.retryFailed(req.params.id)
      if (!job) return res.status(404).json({ error: 'Recalculation job not found' })
      res.json(job)
    } catch (err) { next(err) }
  })

  // Trends
  app.get('/api/admin/pricing/trends', admin, async (_req, res, next) => {
    try {
      res.json(await trendService.getAdminTrendDashboard())
    } catch (err) { next(err) }
  })

  app.post('/api/admin/pricing/trends/run', admin, async (req, res, next) => {
    try {
      const result = await trendService.runAllSnapshots()
      res.json({ success: true, ...result })
    } catch (err) { next(err) }
  })

  // Agent price reports
  app.get('/api/admin/pricing/agent-price-reports', admin, async (_req, res, next) => {
    try {
      const reports = await dal.findAll('agent_price_reports', () => true)
      res.json(reports.sort((a, b) => new Date(b.created_at) - new Date(a.created_at)))
    } catch (err) { next(err) }
  })

  app.post('/api/admin/pricing/agent-price-reports/:id/review', admin, async (req, res, next) => {
    try {
      const { status, notes } = req.body
      if (!['verified', 'rejected'].includes(status)) {
        return res.status(400).json({ error: 'status must be verified or rejected' })
      }
      const existing = await dal.findOne('agent_price_reports', (r) => r.id === req.params.id)
      if (!existing) return res.status(404).json({ error: 'Report not found' })
      await dal.update('agent_price_reports', (r) => r.id === req.params.id, (r) => ({
        ...r,
        status: status || r.status,
        review_notes: notes !== undefined ? notes : r.review_notes,
        reviewed_by: req.user.id,
        reviewed_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      }))
      res.json({ success: true })
    } catch (err) { next(err) }
  })

  // Comparable reports
  app.get('/api/admin/pricing/reports', admin, async (_req, res, next) => {
    try {
      const reports = await dal.findAll('comparable_reports', () => true)
      res.json(reports)
    } catch (err) { next(err) }
  })

  app.post('/api/admin/pricing/reports/:id/review', admin, async (req, res, next) => {
    try {
      const { status, notes } = req.body
      if (!['reviewed', 'dismissed', 'actioned'].includes(status)) {
        return res.status(400).json({ error: 'status must be reviewed, dismissed, or actioned' })
      }
      const existing = await dal.findOne('comparable_reports', (r) => r.id === req.params.id)
      if (!existing) return res.status(404).json({ error: 'Report not found' })
      await dal.update('comparable_reports', (r) => r.id === req.params.id, (r) => ({
        ...r,
        status: status || r.status,
        notes: notes !== undefined ? notes : r.notes,
        reviewed_by: req.user.id,
        reviewed_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      }))
      res.json({ success: true })
    } catch (err) { next(err) }
  })
}
