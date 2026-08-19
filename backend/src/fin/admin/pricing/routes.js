/**
 * First real /api/admin/fin/** surface (DL-053 Stage 1 was test-only).
 * writeGuards copy platform-templates/routes.js:175 plus H §5 limiter
 * and Stage 1 requireIfMatch.
 */
import { requireElevated } from '../../../auth.js'
import { transaction } from '../../../db.js'
import { FinError } from '../../errors.js'
import { requireIfMatch, sendPreconditionFailed, setETag } from '../../middleware/if-match.js'
import { adminMutationLimiter } from '../../../lib/admin-limiter.js'
import {
  activatePriceVersion,
  createPrice,
  deprecatePriceVersion,
  draftPriceVersion,
  getPrice,
  listPrices,
} from '../../pricing/prices.js'
import {
  activateContractVersion,
  createContract,
  draftContractVersion,
  suspendContract,
  terminateContract,
} from '../../pricing/contracts.js'

function requireExplicitPlatformAdmin(req, res, next) {
  if (req.user?.platform_role !== 'platform_admin') {
    return res.status(403).json({ error: 'Forbidden: platform admin required' })
  }
  next()
}

function actorFrom(req) {
  return {
    actorType: 'USER',
    actorId: null,
    actorEmail: req.user?.email || 'admin@fin.local',
    tenantId: req.body?.tenant_id || req.body?.tenantId || null,
    reasonCode: req.body?.reason_code || req.body?.reasonCode || 'ADMIN_PRICING',
    idempotencyKey: req.get('Idempotency-Key') || req.body?.idempotency_key || req.body?.idempotencyKey,
    expectedVersion: req.expectedVersion,
    now: req.body?.now,
    environment: req.body?.environment || req.query?.environment || 'LIVE',
  }
}

function sendFinError(res, error) {
  if (error instanceof FinError && error.httpStatus === 412) {
    return sendPreconditionFailed(res, error.details || {})
  }
  if (error instanceof FinError) {
    return res.status(error.httpStatus).json(error.toJSON())
  }
  throw error
}

export function registerFinPricingAdminRoutes(app, { authMiddleware, requirePlatformAdmin } = {}) {
  if (!authMiddleware) throw new Error('registerFinPricingAdminRoutes requires authMiddleware')
  if (!requirePlatformAdmin) throw new Error('registerFinPricingAdminRoutes requires requirePlatformAdmin')

  const readGuards = [authMiddleware, requirePlatformAdmin]
  const writeGuards = [
    authMiddleware,
    requirePlatformAdmin,
    requireExplicitPlatformAdmin,
    requireElevated(),
    adminMutationLimiter,
    requireIfMatch,
  ]

  app.post('/api/admin/fin/prices', writeGuards, async (req, res, next) => {
    try {
      const result = await createPrice({ ...actorFrom(req), ...req.body })
      setETag(res, result.version)
      return res.status(200).json(result)
    } catch (error) {
      try { return sendFinError(res, error) } catch (err) { next(err) }
    }
  })

  app.post('/api/admin/fin/prices/:id/versions', writeGuards, async (req, res, next) => {
    try {
      const result = await draftPriceVersion({
        ...actorFrom(req),
        ...req.body,
        priceId: req.params.id,
      })
      setETag(res, result.version)
      return res.status(200).json(result)
    } catch (error) {
      try { return sendFinError(res, error) } catch (err) { next(err) }
    }
  })

  app.post('/api/admin/fin/prices/:id/versions/:vid/activate', writeGuards, async (req, res, next) => {
    try {
      const result = await activatePriceVersion({
        ...actorFrom(req),
        ...req.body,
        priceId: req.params.id,
        priceVersionId: req.params.vid,
      })
      setETag(res, result.version)
      return res.status(200).json(result)
    } catch (error) {
      try { return sendFinError(res, error) } catch (err) { next(err) }
    }
  })

  app.post('/api/admin/fin/prices/:id/versions/:vid/deprecate', writeGuards, async (req, res, next) => {
    try {
      const result = await deprecatePriceVersion({
        ...actorFrom(req),
        ...req.body,
        priceId: req.params.id,
        priceVersionId: req.params.vid,
      })
      setETag(res, result.version)
      return res.status(200).json(result)
    } catch (error) {
      try { return sendFinError(res, error) } catch (err) { next(err) }
    }
  })

  app.get('/api/admin/fin/prices', readGuards, async (req, res, next) => {
    try {
      const rows = await transaction((client) => listPrices(client, {
        environment: req.query.environment || 'LIVE',
      }))
      return res.status(200).json({ prices: rows })
    } catch (error) {
      next(error)
    }
  })

  app.get('/api/admin/fin/prices/:id', readGuards, async (req, res, next) => {
    try {
      const row = await transaction((client) => getPrice(client, req.params.id))
      if (!row) return res.status(404).json({ code: 'NOT_FOUND' })
      setETag(res, row.version)
      return res.status(200).json(row)
    } catch (error) {
      next(error)
    }
  })

  app.post('/api/admin/fin/contracts', writeGuards, async (req, res, next) => {
    try {
      const result = await createContract({ ...actorFrom(req), ...req.body })
      setETag(res, result.version)
      return res.status(200).json(result)
    } catch (error) {
      try { return sendFinError(res, error) } catch (err) { next(err) }
    }
  })

  app.post('/api/admin/fin/contracts/:id/versions', writeGuards, async (req, res, next) => {
    try {
      const result = await draftContractVersion({
        ...actorFrom(req),
        ...req.body,
        contractId: req.params.id,
      })
      setETag(res, result.version)
      return res.status(200).json(result)
    } catch (error) {
      try { return sendFinError(res, error) } catch (err) { next(err) }
    }
  })

  app.post('/api/admin/fin/contracts/:id/versions/:vid/activate', writeGuards, async (req, res, next) => {
    try {
      const result = await activateContractVersion({
        ...actorFrom(req),
        ...req.body,
        contractId: req.params.id,
        contractVersionId: req.params.vid,
      })
      setETag(res, result.version)
      return res.status(200).json(result)
    } catch (error) {
      try { return sendFinError(res, error) } catch (err) { next(err) }
    }
  })

  app.post('/api/admin/fin/contracts/:id/suspend', writeGuards, async (req, res, next) => {
    try {
      const result = await suspendContract({
        ...actorFrom(req),
        ...req.body,
        contractId: req.params.id,
      })
      setETag(res, result.version)
      return res.status(200).json(result)
    } catch (error) {
      try { return sendFinError(res, error) } catch (err) { next(err) }
    }
  })

  app.post('/api/admin/fin/contracts/:id/terminate', writeGuards, async (req, res, next) => {
    try {
      const result = await terminateContract({
        ...actorFrom(req),
        ...req.body,
        contractId: req.params.id,
      })
      setETag(res, result.version)
      return res.status(200).json(result)
    } catch (error) {
      try { return sendFinError(res, error) } catch (err) { next(err) }
    }
  })
}

export const __testables = { requireExplicitPlatformAdmin }
