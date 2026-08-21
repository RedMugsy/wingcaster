/**
 * Stage 12 admin context (DL-164 / DL-101).
 * environment comes from the operator session. now comes from BusinessClock.
 * Callers MUST NOT inject either via req.body.
 */
import { BusinessClock } from '../clock.js'

export const LIVE = 'LIVE'

export function sessionEnvironment(req) {
  const fromSession = req.user?.fin_environment
    || req.user?.environment
    || req.finEnvironment
  if (fromSession === 'TEST' || fromSession === 'LIVE') return fromSession
  return LIVE
}

export function adminNow() {
  return BusinessClock.now()
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export function actorFrom(req) {
  const rawId = req.user?.id || null
  return {
    actorType: 'USER',
    actorId: rawId && UUID_RE.test(String(rawId)) ? rawId : null,
    actorEmail: req.user?.email || 'admin@fin.local',
    tenantId: req.body?.tenant_id || req.body?.tenantId || null,
    reasonCode: req.body?.reason_code || req.body?.reasonCode || 'ADMIN_OPS',
    idempotencyKey: req.get?.('Idempotency-Key')
      || req.body?.idempotency_key
      || req.body?.idempotencyKey,
    expectedVersion: req.expectedVersion,
    now: adminNow(),
    environment: sessionEnvironment(req),
  }
}

export function commandBody(req) {
  const body = { ...(req.body || {}) }
  delete body.environment
  delete body.now
  return body
}

export function pick(obj, ...keys) {
  for (const key of keys) {
    if (obj?.[key] != null && obj[key] !== '') return obj[key]
  }
  return undefined
}

export function resolveAdminContext(req, _res, next) {
  req.fin = {
    environment: sessionEnvironment(req),
    now: adminNow(),
  }
  next()
}
