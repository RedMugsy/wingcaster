import { randomUUID } from 'node:crypto'
import { expect, it } from 'vitest'
import { asRole, NOW } from '../testing/seed.js'
import { finPostgresSuite } from '../testing/suite.js'

finPostgresSuite('rls-cross-tenant H2', {}, ({ pool, world }) => {
  it('H2 — tenant A GUC cannot see tenant B lots; bypass needs admin+elevated', async () => {
    const { tenantA, tenantB } = world()
    const lotB = randomUUID()
    await pool().query(
      `INSERT INTO fin.lots (
         id, environment, tenant_id, book_id, billing_account_id, holder_id,
         source_kind, granted_units, remaining_units, consideration_minor,
         currency, draw_priority, status, created_at, updated_at
       ) VALUES ($1, 'LIVE', $2, $3, $4, $5, 'PROMOTIONAL_GRANT',
                 100, 100, 0, 'USD', 10, 'ACTIVE', $6, $6)`,
      [
        lotB, tenantB.tenantId, tenantB.bookB.bookId,
        tenantB.billingAccountId, tenantB.holderId, NOW,
      ],
    )

    const client = await pool().connect()
    try {
      const hidden = await asRole(client, 'fin_app_role', {
        'fin.environment': 'LIVE',
        'fin.tenant_id': tenantA.tenantId,
      }, async (c) => c.query(`SELECT id FROM fin.lots WHERE id = $1`, [lotB]))
      expect(hidden.rows).toEqual([])

      const unElevated = await asRole(client, 'fin_app_role', {
        'fin.environment': 'LIVE',
        'fin.tenant_id': tenantA.tenantId,
        'fin.platform_admin': 'on',
        'fin.elevated': 'off',
      }, async (c) => c.query(`SELECT id FROM fin.lots WHERE id = $1`, [lotB]))
      expect(unElevated.rows).toEqual([])

      const bypass = await asRole(client, 'fin_app_role', {
        'fin.environment': 'LIVE',
        'fin.tenant_id': tenantA.tenantId,
        'fin.platform_admin': 'on',
        'fin.elevated': 'on',
      }, async (c) => c.query(`SELECT id FROM fin.lots WHERE id = $1`, [lotB]))
      expect(bypass.rows.map((r) => r.id)).toEqual([lotB])
    } finally {
      client.release()
    }
  })
})
