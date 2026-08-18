import { randomUUID } from 'node:crypto'
import { expect, it } from 'vitest'
import { NOW } from '../testing/seed.js'
import { finPostgresSuite } from '../testing/suite.js'

finPostgresSuite('113_fin_metered_usage', {}, ({ pool, world }) => {
  it('A §18 #6 — TEST metered_usage cannot reference a LIVE meter_version', async () => {
    const meterId = randomUUID()
    const versionId = randomUUID()
    await pool().query(
      `INSERT INTO fin.meters (id, environment, code, name, created_at, updated_at)
       VALUES ($1, 'LIVE', 'live.meter', 'Live', $2, $2)`,
      [meterId, NOW],
    )
    await pool().query(
      `INSERT INTO fin.meter_versions (
         id, meter_id, environment, version_n, aggregation_type, filter_definition,
         effective_from
       ) VALUES ($1, $2, 'LIVE', 1, 'SUM', '{}'::jsonb, $3)`,
      [versionId, meterId, NOW],
    )
    const testTenantId = randomUUID()
    await pool().query(
      `INSERT INTO fin.tenants (
         id, environment, public_tenant_id, platform_id, default_legal_entity_id,
         default_residency_key, status, created_at, updated_at
       ) VALUES ($1, 'TEST', $2, $3, $4, 'ksa', 'ACTIVE', $5, $5)`,
      [testTenantId, world().tenantA.publicTenantId, world().platformId, world().legalEntityId, NOW],
    )
    const testHolderId = randomUUID()
    await pool().query(
      `INSERT INTO fin.holders (
         id, environment, tenant_id, holder_kind, display_name, created_at, updated_at
       ) VALUES ($1, 'TEST', $2, 'TENANT_ROOT', 'test holder', $3, $3)`,
      [testHolderId, testTenantId, NOW],
    )
    await expect(pool().query(
      `INSERT INTO fin.metered_usage (
         id, environment, tenant_id, meter_version_id, holder_id, period_key,
         quantity_units, computation_hash, status, metered_at
       ) VALUES ($1, 'TEST', $2, $3, $4, '2026-08', 1, 'hash', 'ACTIVE', $5)`,
      [randomUUID(), testTenantId, versionId, testHolderId, NOW],
    )).rejects.toMatchObject({ code: '23514' })
  })
})
