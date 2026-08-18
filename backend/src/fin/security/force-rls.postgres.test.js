import { expect, it } from 'vitest'
import { finPostgresSuite } from '../testing/suite.js'

finPostgresSuite('force-rls H12', { seed: false }, ({ pool }) => {
  it('H12 — relforcerowsecurity is true on every tenant-scoped fin.* table', async () => {
    const { rows } = await pool().query(`
      SELECT c.relname
        FROM pg_class c
        JOIN pg_namespace n ON n.oid = c.relnamespace
        JOIN information_schema.columns col
          ON col.table_schema = n.nspname AND col.table_name = c.relname
       WHERE n.nspname = 'fin'
         AND c.relkind = 'r'
         AND col.column_name = 'tenant_id'
         AND c.relforcerowsecurity = false
       GROUP BY c.relname
       ORDER BY c.relname
    `)
    expect(rows).toEqual([])

    const tenants = await pool().query(`
      SELECT c.relrowsecurity, c.relforcerowsecurity
        FROM pg_class c
        JOIN pg_namespace n ON n.oid = c.relnamespace
       WHERE n.nspname = 'fin' AND c.relname = 'tenants'
    `)
    expect(tenants.rows[0].relrowsecurity).toBe(true)
    expect(tenants.rows[0].relforcerowsecurity).toBe(true)
  })
})
