import { expect, it } from 'vitest'
import { finPostgresSuite } from '../testing/suite.js'

finPostgresSuite('occ-tenants D-T1', {}, ({ pool, world }) => {
  it('D-T1 — two concurrent OCC updates: exactly one rowCount=1', async () => {
    const tenantId = world().tenantA.tenantId
    const a = await pool().connect()
    const b = await pool().connect()
    try {
      const sql = `UPDATE fin.tenants SET status = 'SUSPENDED'
                    WHERE id = $1 AND version = 1`
      const [first, second] = await Promise.all([
        a.query(sql, [tenantId]),
        b.query(sql, [tenantId]),
      ])
      const counts = [first.rowCount, second.rowCount].sort()
      expect(counts).toEqual([0, 1])
      const row = await pool().query(
        `SELECT version, status FROM fin.tenants WHERE id = $1`,
        [tenantId],
      )
      expect(row.rows[0].version).toBe('2')
      expect(row.rows[0].status).toBe('SUSPENDED')
    } finally {
      a.release()
      b.release()
    }
  })

  it('D-T13 — bump trigger increments version even when SET version is supplied', async () => {
    const tenantId = world().tenantA.tenantId
    const before = await pool().query(
      `SELECT version FROM fin.tenants WHERE id = $1`,
      [tenantId],
    )
    const expected = Number(before.rows[0].version)
    await pool().query(
      `UPDATE fin.tenants SET status = 'READ_ONLY', version = 99 WHERE id = $1 AND version = $2`,
      [tenantId, expected],
    )
    const after = await pool().query(
      `SELECT version, status FROM fin.tenants WHERE id = $1`,
      [tenantId],
    )
    expect(after.rows[0].version).toBe(String(expected + 1))
    expect(after.rows[0].status).toBe('READ_ONLY')
  })
})
