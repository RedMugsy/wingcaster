import { expect, it } from 'vitest'
import { finPostgresSuite } from '../testing/suite.js'

finPostgresSuite('100_fin_schema', { seed: false }, ({ pool }) => {
  it('creates schema fin, extensions, and helper functions', async () => {
    const schemas = await pool().query(
      `SELECT nspname FROM pg_namespace WHERE nspname = 'fin'`,
    )
    expect(schemas.rows).toHaveLength(1)

    const ext = await pool().query(
      `SELECT extname FROM pg_extension WHERE extname = ANY($1::text[])`,
      [['pgcrypto', 'btree_gist']],
    )
    expect(ext.rows.map((r) => r.extname).sort()).toEqual(['btree_gist', 'pgcrypto'])

    const fns = await pool().query(
      `SELECT proname FROM pg_proc p
         JOIN pg_namespace n ON n.oid = p.pronamespace
        WHERE n.nspname = 'fin'
          AND proname IN ('trg_bump_version', 'platform_admin_bypass', 'trg_env_matches_tenant')
        ORDER BY proname`,
    )
    expect(fns.rows.map((r) => r.proname)).toEqual([
      'platform_admin_bypass',
      'trg_bump_version',
      'trg_env_matches_tenant',
    ])
  })
})
