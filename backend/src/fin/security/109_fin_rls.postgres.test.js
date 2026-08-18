import { expect, it } from 'vitest'
import { finPostgresSuite } from '../testing/suite.js'

finPostgresSuite('109_fin_rls', { seed: false }, ({ pool }) => {
  it('creates the six H §0 roles', async () => {
    const roles = await pool().query(
      `SELECT rolname FROM pg_roles
        WHERE rolname LIKE 'fin_%'
        ORDER BY rolname`,
    )
    expect(roles.rows.map((r) => r.rolname)).toEqual([
      'fin_app_role',
      'fin_auditor_role',
      'fin_finance_role',
      'fin_migrate_role',
      'fin_migrator',
      'fin_recon_role',
    ])
  })
})
