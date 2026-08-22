/**
 * Stage 13b commercial tenant → fin.* context (DL-180).
 * Returns the four required ids or a classified miss. Callers log a
 * correction and skip the legacy row — they do not invent mappings.
 */
import { query } from '../../../db.js'
import { rowsOf } from './session.js'

function execOf(client, injected) {
  return injected || (client
    ? (sql, params) => client.query(sql, params).then((r) => r.rows)
    : query)
}

/**
 * @param {{ publicTenantId: string, environment?: string, client?: import('pg').PoolClient, query?: Function }} args
 * @returns {Promise<
 *   | { ok: true, tenantId: string, holderId: string, billingAccountId: string, legalEntityId: string, bookId: string|null, environment: string, publicTenantId: string }
 *   | { ok: false, missing: 'MISSING_TENANT_MAP'|'MISSING_HOLDER_MAP'|'MISSING_LEGAL_ENTITY' }
 * >}
 */
export async function resolveFinContextForCommercialTenant({
  publicTenantId,
  environment = 'LIVE',
  client = null,
  query: injected = null,
} = {}) {
  if (!publicTenantId) {
    return { ok: false, missing: 'MISSING_TENANT_MAP' }
  }
  const sessionEnv = environment === 'TEST' || environment === 'LIVE' ? environment : 'LIVE'
  const exec = execOf(client, injected)

  const tenants = await rowsOf(exec,
    `SELECT id, environment, default_legal_entity_id
       FROM fin.tenants
      WHERE public_tenant_id = $1 AND environment = $2 AND status = 'ACTIVE'`,
    [String(publicTenantId), sessionEnv],
  )
  const tenant = tenants[0]
  if (!tenant) return { ok: false, missing: 'MISSING_TENANT_MAP' }

  const holders = await rowsOf(exec,
    `SELECT id FROM fin.holders
      WHERE tenant_id = $1 AND holder_kind = 'TENANT_ROOT'
      ORDER BY created_at ASC LIMIT 1`,
    [tenant.id],
  )
  if (!holders[0]) return { ok: false, missing: 'MISSING_HOLDER_MAP' }

  const billing = await rowsOf(exec,
    `SELECT id, seller_legal_entity_id FROM fin.billing_accounts
      WHERE tenant_id = $1 ORDER BY created_at ASC LIMIT 1`,
    [tenant.id],
  )
  if (!billing[0]) return { ok: false, missing: 'MISSING_HOLDER_MAP' }

  const legalEntityId = tenant.default_legal_entity_id || billing[0].seller_legal_entity_id || null
  if (!legalEntityId) return { ok: false, missing: 'MISSING_LEGAL_ENTITY' }

  const books = await rowsOf(exec,
    `SELECT id FROM fin.ledger_books
      WHERE tenant_id = $1 AND billing_account_id = $2
      ORDER BY created_at ASC LIMIT 1`,
    [tenant.id, billing[0].id],
  )

  return {
    ok: true,
    tenantId: tenant.id,
    holderId: holders[0].id,
    billingAccountId: billing[0].id,
    legalEntityId,
    bookId: books[0]?.id || null,
    environment: tenant.environment,
    publicTenantId: String(publicTenantId),
  }
}
