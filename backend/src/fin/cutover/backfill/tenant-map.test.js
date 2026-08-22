/**
 * Fast suite — classified null-return paths for missing fin mappings.
 */
import { describe, expect, it } from 'vitest'
import { resolveFinContextForCommercialTenant } from './tenant-map.js'

const TENANT_SQL = 'FROM fin.tenants'
const HOLDER_SQL = 'FROM fin.holders'
const BILLING_SQL = 'FROM fin.billing_accounts'

function execReturning({ tenants = [], holders = [], billing = [] } = {}) {
  return async (sql) => {
    if (sql.includes(TENANT_SQL)) return tenants
    if (sql.includes(HOLDER_SQL)) return holders
    if (sql.includes(BILLING_SQL)) return billing
    if (sql.includes('FROM fin.ledger_books')) return []
    return []
  }
}

describe('resolveFinContextForCommercialTenant', () => {
  it('MISSING_TENANT_MAP when publicTenantId is empty', async () => {
    const result = await resolveFinContextForCommercialTenant({
      publicTenantId: '',
      query: execReturning(),
    })
    expect(result).toEqual({ ok: false, missing: 'MISSING_TENANT_MAP' })
  })

  it('MISSING_TENANT_MAP when fin.tenants has no ACTIVE row', async () => {
    const result = await resolveFinContextForCommercialTenant({
      publicTenantId: 'pt-ghost',
      query: execReturning({ tenants: [] }),
    })
    expect(result).toEqual({ ok: false, missing: 'MISSING_TENANT_MAP' })
  })

  it('MISSING_HOLDER_MAP when TENANT_ROOT holder is missing', async () => {
    const result = await resolveFinContextForCommercialTenant({
      publicTenantId: 'pt-a',
      query: execReturning({
        tenants: [{ id: 't1', environment: 'LIVE', default_legal_entity_id: 'le1' }],
        holders: [],
      }),
    })
    expect(result).toEqual({ ok: false, missing: 'MISSING_HOLDER_MAP' })
  })

  it('MISSING_HOLDER_MAP when billing_account is missing', async () => {
    const result = await resolveFinContextForCommercialTenant({
      publicTenantId: 'pt-a',
      query: execReturning({
        tenants: [{ id: 't1', environment: 'LIVE', default_legal_entity_id: 'le1' }],
        holders: [{ id: 'h1' }],
        billing: [],
      }),
    })
    expect(result).toEqual({ ok: false, missing: 'MISSING_HOLDER_MAP' })
  })

  it('MISSING_LEGAL_ENTITY when tenant and billing have no seller id', async () => {
    const result = await resolveFinContextForCommercialTenant({
      publicTenantId: 'pt-a',
      query: execReturning({
        tenants: [{ id: 't1', environment: 'LIVE', default_legal_entity_id: null }],
        holders: [{ id: 'h1' }],
        billing: [{ id: 'ba1', seller_legal_entity_id: null }],
      }),
    })
    expect(result).toEqual({ ok: false, missing: 'MISSING_LEGAL_ENTITY' })
  })

  it('returns the four ids when the map is complete', async () => {
    const result = await resolveFinContextForCommercialTenant({
      publicTenantId: 'pt-a',
      query: execReturning({
        tenants: [{ id: 't1', environment: 'LIVE', default_legal_entity_id: 'le1' }],
        holders: [{ id: 'h1' }],
        billing: [{ id: 'ba1', seller_legal_entity_id: 'le1' }],
      }),
    })
    expect(result).toMatchObject({
      ok: true,
      tenantId: 't1',
      holderId: 'h1',
      billingAccountId: 'ba1',
      legalEntityId: 'le1',
      publicTenantId: 'pt-a',
    })
  })
})
