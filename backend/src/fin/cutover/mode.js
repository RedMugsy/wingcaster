/**
 * Stage 13a+13d cutover mode resolver (DL-172 / DL-207 / DL-208).
 * FIN_ONLY from fin.cutover_active_environment wins; else
 * FIN_CUTOVER_MODE_GLOBAL=FIN_ONLY; else per-tenant allowlist DUAL; else OFF.
 */
import { query } from '../../db.js'
import { BusinessClock } from '../clock.js'
import { CATEGORY, finError } from '../errors.js'
import { ATTESTATION_FRESH_DAYS } from './parity/attestation.js'

export const CUTOVER_MODES = Object.freeze(['OFF', 'DUAL', 'FIN_ONLY'])

function skipAttestationDefense() {
  return String(process.env.FIN_CUTOVER_SKIP_ATTESTATION_GATE || '').toLowerCase() === 'true'
}

function envOf(environment) {
  return environment === 'TEST' ? 'TEST' : 'LIVE'
}

async function runQuery(client, sql, params) {
  if (client) {
    const result = await client.query(sql, params)
    return result.rows
  }
  return query(sql, params)
}

/**
 * Pure resolver used by tests and by resolveCutoverMode after DB lookup.
 * @param {{ globalMode?: string|null, allowlistMode?: string|null }} input
 * @returns {'OFF'|'DUAL'|'FIN_ONLY'}
 */
export function resolveCutoverModeFromParts({ globalMode = null, allowlistMode = null } = {}) {
  const global = String(globalMode || process.env.FIN_CUTOVER_MODE_GLOBAL || 'OFF').toUpperCase()
  if (global === 'FIN_ONLY') return 'FIN_ONLY'
  const rowMode = String(allowlistMode || '').toUpperCase()
  if (rowMode === 'DUAL') return 'DUAL'
  return 'OFF'
}

export function isAttestationFresh(signedAt, now, { freshDays = ATTESTATION_FRESH_DAYS } = {}) {
  if (!signedAt) return false
  const stamped = Date.parse(now instanceof Date ? now.toISOString() : String(now))
  const signed = Date.parse(signedAt instanceof Date ? signedAt.toISOString() : String(signedAt))
  if (!Number.isFinite(stamped) || !Number.isFinite(signed)) return false
  return (stamped - signed) <= freshDays * 24 * 60 * 60 * 1000
}

export async function readActiveEnvironment(client, environment = 'LIVE') {
  const env = envOf(environment)
  const rows = await runQuery(
    client,
    `SELECT environment, mode, attestation_id, activated_at,
            activated_by_email, activated_by_actor_type, updated_at
       FROM fin.cutover_active_environment
      WHERE environment = $1`,
    [env],
  )
  return rows[0] || null
}

async function loadAttestation(client, attestationId) {
  if (!attestationId) return null
  const rows = await runQuery(
    client,
    `SELECT id, environment, attestation_hash, signed_at, signed_by_email
       FROM fin.cutover_parity_attestations
      WHERE id = $1`,
    [attestationId],
  )
  return rows[0] || null
}

async function latestSignedAt(client, environment) {
  const rows = await runQuery(
    client,
    `SELECT signed_at, id, attestation_hash
       FROM fin.cutover_parity_attestations
      WHERE environment = $1
      ORDER BY signed_at DESC
      LIMIT 1`,
    [envOf(environment)],
  )
  return rows[0] || null
}

/**
 * Fail-closed defense (DL-208): FIN_ONLY without a fresh attestation
 * throws so callers cannot continue issuing.
 */
export async function assertFreshAttestationForFinOnly({
  client = null,
  environment = 'LIVE',
  attestationId = null,
  now = null,
} = {}) {
  if (skipAttestationDefense()) return { ok: true, skipped: true }
  const stamped = now || BusinessClock.now()
  const env = envOf(environment)
  if (attestationId) {
    const row = await loadAttestation(client, attestationId)
    if (!row || row.environment !== env || !isAttestationFresh(row.signed_at, stamped)) {
      throw finError('ATTESTATION_STALE', {
        category: CATEGORY.CONTROL,
        httpStatus: 403,
        details: { environment: env, attestation_id: attestationId },
      })
    }
    return { ok: true, attestation: row }
  }
  const latest = await latestSignedAt(client, env)
  if (!latest || !isAttestationFresh(latest.signed_at, stamped)) {
    throw finError('ATTESTATION_STALE', {
      category: CATEGORY.CONTROL,
      httpStatus: 403,
      details: { environment: env, attestation_id: null },
    })
  }
  return { ok: true, attestation: latest }
}

/**
 * DB-row + env-var resolver (no tenant allowlist). DL-207:
 * FIN_ONLY on the singleton short-circuits; OFF/DUAL fall back.
 * @returns {Promise<'OFF'|'DUAL'|'FIN_ONLY'>}
 */
export async function resolveGlobalCutoverMode({
  client = null,
  environment = 'LIVE',
  now = null,
} = {}) {
  const env = envOf(environment)
  const stamped = now || BusinessClock.now()
  const row = await readActiveEnvironment(client, env)
  if (row?.mode === 'FIN_ONLY') {
    await assertFreshAttestationForFinOnly({
      client,
      environment: env,
      attestationId: row.attestation_id,
      now: stamped,
    })
    return 'FIN_ONLY'
  }
  const global = process.env.FIN_CUTOVER_MODE_GLOBAL
  if (String(global || '').toUpperCase() === 'FIN_ONLY') {
    await assertFreshAttestationForFinOnly({
      client,
      environment: env,
      now: stamped,
    })
    return 'FIN_ONLY'
  }
  return resolveCutoverModeFromParts({
    globalMode: global,
    allowlistMode: null,
  })
}

/**
 * @param {{ publicTenantId: string, environment?: string, client?: import('pg').PoolClient, now?: string }} args
 * @returns {Promise<'OFF'|'DUAL'|'FIN_ONLY'>}
 */
export async function resolveCutoverMode({
  publicTenantId,
  environment = 'LIVE',
  client = null,
  now = null,
} = {}) {
  const globalResolved = await resolveGlobalCutoverMode({ client, environment, now })
  if (globalResolved === 'FIN_ONLY') return 'FIN_ONLY'

  if (!publicTenantId) return 'OFF'
  const env = envOf(environment)
  const sql = `
    SELECT mode FROM fin.cutover_tenant_allowlist
     WHERE environment = $1 AND tenant_id = $2
     LIMIT 1`
  const params = [env, String(publicTenantId)]
  const rows = await runQuery(client, sql, params)
  return resolveCutoverModeFromParts({
    globalMode: process.env.FIN_CUTOVER_MODE_GLOBAL,
    allowlistMode: rows[0]?.mode || null,
  })
}

/**
 * Attach req.finCutover = { mode, environment, publicTenantId }.
 * Cached per request — call once in middleware.
 */
export function attachFinCutoverMiddleware(opts = {}) {
  const defaultEnv = opts.environment || 'LIVE'
  return async function finCutoverMiddleware(req, _res, next) {
    try {
      const environment = req.user?.fin_environment
        || req.user?.environment
        || req.fin?.environment
        || defaultEnv
      const publicTenantId = req.tenantId
        || req.user?.tenant_id
        || req.user?.id
        || null
      const mode = await resolveCutoverMode({ publicTenantId, environment })
      req.finCutover = { mode, environment, publicTenantId }
      next()
    } catch (err) {
      next(err)
    }
  }
}
