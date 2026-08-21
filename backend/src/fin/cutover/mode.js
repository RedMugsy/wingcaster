/**
 * Stage 13a cutover mode resolver (DL-172).
 * FIN_CUTOVER_MODE_GLOBAL=FIN_ONLY wins; else per-tenant allowlist DUAL; else OFF.
 */
import { query } from '../../db.js'

export const CUTOVER_MODES = Object.freeze(['OFF', 'DUAL', 'FIN_ONLY'])

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

/**
 * @param {{ publicTenantId: string, environment?: string, client?: import('pg').PoolClient }} args
 * @returns {Promise<'OFF'|'DUAL'|'FIN_ONLY'>}
 */
export async function resolveCutoverMode({ publicTenantId, environment = 'LIVE', client = null } = {}) {
  const global = process.env.FIN_CUTOVER_MODE_GLOBAL
  if (String(global || '').toUpperCase() === 'FIN_ONLY') return 'FIN_ONLY'

  if (!publicTenantId) return 'OFF'
  const env = environment === 'TEST' ? 'TEST' : 'LIVE'
  const sql = `
    SELECT mode FROM fin.cutover_tenant_allowlist
     WHERE environment = $1 AND tenant_id = $2
     LIMIT 1`
  const params = [env, String(publicTenantId)]
  let rows
  if (client) {
    const result = await client.query(sql, params)
    rows = result.rows
  } else {
    rows = await query(sql, params)
  }
  return resolveCutoverModeFromParts({
    globalMode: global,
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
