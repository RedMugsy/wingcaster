import { randomUUID } from 'node:crypto'
import { expect, it } from 'vitest'
import { NOW } from '../testing/seed.js'
import { finPostgresSuite } from '../testing/suite.js'

finPostgresSuite('101_fin_environments_entities', {}, ({ pool, world }) => {
  it('rejects a holder whose environment does not match its tenant', async () => {
    const w = world()
    await expect(pool().query(
      `INSERT INTO fin.holders (
         id, environment, tenant_id, holder_kind, display_name, created_at, updated_at
       ) VALUES ($1, 'TEST', $2, 'TENANT_ROOT', 'mismatch', $3, $3)`,
      [randomUUID(), w.tenantA.tenantId, NOW],
    )).rejects.toMatchObject({ code: '23514' })
  })

  it('projects the same public tenant into LIVE and TEST independently', async () => {
    const w = world()
    const testId = randomUUID()
    await pool().query(
      `INSERT INTO fin.tenants (
         id, environment, public_tenant_id, platform_id, default_legal_entity_id,
         default_residency_key, status, created_at, updated_at
       ) VALUES ($1, 'TEST', $2, $3, $4, 'ksa', 'ACTIVE', $5, $5)`,
      [testId, w.tenantA.publicTenantId, w.platformId, w.legalEntityId, NOW],
    )
    const rows = await pool().query(
      `SELECT environment FROM fin.tenants WHERE public_tenant_id = $1 ORDER BY environment`,
      [w.tenantA.publicTenantId],
    )
    expect(rows.rows.map((r) => r.environment)).toEqual(['LIVE', 'TEST'])
  })
})
