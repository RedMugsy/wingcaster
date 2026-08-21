/**
 * Read-only vendor ops surface. Stage 12 consumes these endpoints.
 * Writes are not registered here. Gate: FIN_VENDOR_OPS_ENABLED + platform_admin.
 */
import { transaction } from '../../../db.js'
import { FinError } from '../../errors.js'
import { getVendor, listVendors } from '../../vendors/registry.js'
import { listVendorStatements } from '../../vendors/statement-ingest.js'
import { computeMargin } from '../../vendors/margin.js'

export function isFinVendorOpsEnabled() {
  const value = String(process.env.FIN_VENDOR_OPS_ENABLED || '').toLowerCase()
  return value === '1' || value === 'true' || value === 'yes'
}

function requireVendorOps(_req, res, next) {
  if (!isFinVendorOpsEnabled()) {
    return res.status(501).json({ error: 'vendor_ops_unavailable' })
  }
  next()
}

function sendFinError(res, error) {
  if (error instanceof FinError) {
    return res.status(error.httpStatus).json(error.toJSON())
  }
  throw error
}

export function registerFinVendorAdminRoutes(app, { authMiddleware, requirePlatformAdmin } = {}) {
  if (!authMiddleware) throw new Error('registerFinVendorAdminRoutes requires authMiddleware')
  if (!requirePlatformAdmin) throw new Error('registerFinVendorAdminRoutes requires requirePlatformAdmin')

  const readGuards = [authMiddleware, requirePlatformAdmin, requireVendorOps]

  app.get('/api/admin/fin/vendors', readGuards, async (req, res, next) => {
    try {
      const rows = await transaction((client) => listVendors(client, {
        environment: req.query.environment || 'LIVE',
      }))
      return res.status(200).json({ vendors: rows })
    } catch (error) {
      try { return sendFinError(res, error) } catch (err) { next(err) }
    }
  })

  app.get('/api/admin/fin/vendors/:id', readGuards, async (req, res, next) => {
    try {
      const row = await transaction((client) => getVendor(client, req.params.id))
      if (!row) return res.status(404).json({ code: 'NOT_FOUND' })
      return res.status(200).json(row)
    } catch (error) {
      try { return sendFinError(res, error) } catch (err) { next(err) }
    }
  })

  app.get('/api/admin/fin/vendors/:id/statements', readGuards, async (req, res, next) => {
    try {
      const rows = await transaction((client) => listVendorStatements(client, req.params.id))
      return res.status(200).json({ statements: rows })
    } catch (error) {
      try { return sendFinError(res, error) } catch (err) { next(err) }
    }
  })

  app.get('/api/admin/fin/vendors/:id/margin', readGuards, async (req, res, next) => {
    try {
      const tenantId = req.query.tenant || req.query.tenant_id
      const from = req.query.from
      const to = req.query.to
      if (!tenantId || !from || !to) {
        return res.status(400).json({ code: 'VALIDATION', error: 'tenant, from, and to are required' })
      }
      const result = await transaction((client) => computeMargin(client, {
        tenantId,
        from,
        to,
        environment: req.query.environment || 'LIVE',
      }))
      return res.status(200).json({ vendorId: req.params.id, ...result })
    } catch (error) {
      try { return sendFinError(res, error) } catch (err) { next(err) }
    }
  })
}
