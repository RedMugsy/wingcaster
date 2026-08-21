/**
 * HTTP layer for Stage 7 funding. Feature gate lives HERE, not inside fin.*.
 * FIN_FUNDING_ENABLED=1 AND a fin.tenants row → new flow; otherwise 501.
 */
import { query } from '../../db.js'
import { BusinessClock } from '../clock.js'
import { FinError } from '../errors.js'
import { createPurchaseIntent, submitPurchasePayment } from './purchase-intents.js'
import { submitPayment } from './psp/index.js'
import { confirmWebhook } from './psp/index.js'

export function isFinFundingFlagOn() {
  const value = String(process.env.FIN_FUNDING_ENABLED || '').toLowerCase()
  return value === '1' || value === 'true' || value === 'yes'
}

export async function resolveFinFundingContext({ publicTenantId, environment } = {}) {
  if (!isFinFundingFlagOn()) return null
  if (!publicTenantId) return null
  const sessionEnv = environment === 'TEST' || environment === 'LIVE' ? environment : 'LIVE'
  const tenants = await query(
    `SELECT id, environment FROM fin.tenants
      WHERE public_tenant_id = $1 AND environment = $2 AND status = 'ACTIVE'`,
    [publicTenantId, sessionEnv],
  )
  const tenant = tenants[0]
  if (!tenant) return null
  const holders = await query(
    `SELECT id FROM fin.holders
      WHERE tenant_id = $1 AND holder_kind = 'TENANT_ROOT'
      ORDER BY created_at ASC LIMIT 1`,
    [tenant.id],
  )
  const billing = await query(
    `SELECT id FROM fin.billing_accounts
      WHERE tenant_id = $1 ORDER BY created_at ASC LIMIT 1`,
    [tenant.id],
  )
  if (!holders[0] || !billing[0]) return null
  return {
    tenantId: tenant.id,
    holderId: holders[0].id,
    billingAccountId: billing[0].id,
    environment: tenant.environment,
  }
}

function commercialUnavailable(res) {
  return res.status(501).json({
    error: 'topup_unavailable',
    reason: 'payment_gateway_not_configured',
  })
}

export async function handleCreditsTopUp(req, res, {
  publicTenantId, productId, provider = 'STRIPE', reasonCode = 'USER_TOPUP',
}) {
  const sessionEnv = req.user?.fin_environment || req.user?.environment || 'LIVE'
  const ctx = await resolveFinFundingContext({
    publicTenantId,
    environment: sessionEnv,
  })
  if (!ctx) return commercialUnavailable(res)

  const pid = productId || req.body?.product_id || req.body?.productId
  if (!pid) {
    return res.status(400).json({ error: 'product_id is required' })
  }

  try {
    const created = await createPurchaseIntent({
      environment: ctx.environment,
      tenantId: ctx.tenantId,
      holderId: ctx.holderId,
      billingAccountId: ctx.billingAccountId,
      productId: pid,
      provider,
      actorType: 'USER',
      actorId: null,
      actorEmail: req.user?.email || 'user@fin.local',
      reasonCode,
      now: BusinessClock.now(),
      idempotencyKey: req.get?.('Idempotency-Key') || req.body?.idempotency_key,
      promo: req.body?.promo,
      currency: req.body?.currency,
    })
    const submitted = await submitPurchasePayment({
      intentId: created.id,
      provider,
      environment: ctx.environment,
      tenantId: ctx.tenantId,
      actorType: 'USER',
      actorId: null,
      actorEmail: req.user?.email || 'user@fin.local',
      reasonCode,
      now: BusinessClock.now(),
    })
    const psp = await submitPayment(
      { id: created.id, provider, ...created },
      { provider },
    )
    return res.status(200).json({
      intent_id: created.id,
      status: submitted.status,
      provider,
      action: psp.action,
    })
  } catch (error) {
    if (error instanceof FinError) {
      return res.status(error.httpStatus || 400).json(error.toJSON())
    }
    throw error
  }
}

export async function handleStripeWebhook(req, res) {
  const result = await confirmWebhook(req.rawBody || req.body, req.headers, {
    secret: process.env.STRIPE_WEBHOOK_SECRET,
    environment: process.env.FIN_ENVIRONMENT || 'LIVE',
  })
  if (result.retryAfter) res.set('Retry-After', String(result.retryAfter))
  return res.status(result.httpStatus).json(result.body)
}
