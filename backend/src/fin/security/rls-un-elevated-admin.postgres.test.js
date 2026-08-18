import { expect, it } from 'vitest'
import { asRole } from '../testing/seed.js'
import { finPostgresSuite } from '../testing/suite.js'

finPostgresSuite('rls-un-elevated-admin H4', {}, ({ pool, world }) => {
  it('H4 — platform_admin=on and elevated=off sees no cross-tenant rows', async () => {
    const { tenantA, tenantB } = world()
    const client = await pool().connect()
    try {
      const rows = await asRole(client, 'fin_app_role', {
        'fin.environment': 'LIVE',
        'fin.tenant_id': tenantA.tenantId,
        'fin.platform_admin': 'on',
        'fin.elevated': 'off',
      }, async (c) => c.query(
        `SELECT id FROM fin.tenants WHERE id = $1`,
        [tenantB.tenantId],
      ))
      expect(rows.rows).toEqual([])
    } finally {
      client.release()
    }
  })
})
