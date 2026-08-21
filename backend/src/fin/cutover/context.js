/**
 * Resolve fin.* mirror context from a public tenant id (DL-171).
 * Same identifier space as FIN_FUNDING_ENABLED funding/http.js.
 */
import { query } from '../../db.js'

/**
 * @param {{ publicTenantId: string, environment?: string, client?: import('pg').PoolClient }} args
 * @returns {Promise<null | {
 *   tenantId: string,
 *   holderId: string,
 *   billingAccountId: string,
 *   bookId: string|null,
 *   environment: 'LIVE'|'TEST',
 *   publicTenantId: string,
 * }>}
 */
export async function resolveFinMirrorContext({
  publicTenantId,
  environment = 'LIVE',
  client = null,
} = {}) {
  if (!publicTenantId) return null
  const sessionEnv = environment === 'TEST' || environment === 'LIVE' ? environment : 'LIVE'
  const run = async (q) => {
    const tenants = await q(
      `SELECT id, environment FROM fin.tenants
        WHERE public_tenant_id = $1 AND environment = $2 AND status = 'ACTIVE'`,
      [publicTenantId, sessionEnv],
    )
    const tenant = tenants[0]
    if (!tenant) return null
    const holders = await q(
      `SELECT id FROM fin.holders
        WHERE tenant_id = $1 AND holder_kind = 'TENANT_ROOT'
        ORDER BY created_at ASC LIMIT 1`,
      [tenant.id],
    )
    const billing = await q(
      `SELECT id FROM fin.billing_accounts
        WHERE tenant_id = $1 ORDER BY created_at ASC LIMIT 1`,
      [tenant.id],
    )
    if (!holders[0] || !billing[0]) return null
    const books = await q(
      `SELECT id FROM fin.ledger_books
        WHERE tenant_id = $1 AND billing_account_id = $2
        ORDER BY created_at ASC LIMIT 1`,
      [tenant.id, billing[0].id],
    )
    return {
      tenantId: tenant.id,
      holderId: holders[0].id,
      billingAccountId: billing[0].id,
      bookId: books[0]?.id || null,
      environment: tenant.environment,
      publicTenantId: String(publicTenantId),
    }
  }

  if (client) {
    return run(async (sql, params) => {
      const { rows } = await client.query(sql, params)
      return rows
    })
  }
  return run(query)
}
