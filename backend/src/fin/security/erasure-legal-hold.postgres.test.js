import { expect, it } from 'vitest'
import { finPostgresSuite } from '../testing/suite.js'

finPostgresSuite('erasure-legal-hold H9', {}, ({ pool, world }) => {
  it('H9 — legal_hold=true blocks erasure with BLOCKED_LEGAL_HOLD', async () => {
    const tenantId = world().tenantA.tenantId
    await pool().query(
      `UPDATE fin.tenants SET legal_hold = true, legal_hold_reason = 'litigation' WHERE id = $1`,
      [tenantId],
    )
    const blocked = await pool().query(
      `SELECT fin.request_erasure($1) AS status`,
      [tenantId],
    )
    expect(blocked.rows[0].status).toBe('BLOCKED_LEGAL_HOLD')
    const row = await pool().query(
      `SELECT erasure_status FROM fin.tenants WHERE id = $1`,
      [tenantId],
    )
    expect(row.rows[0].erasure_status).toBe('BLOCKED_LEGAL_HOLD')
  })

  it('H9 — without legal hold the request is stored as REQUESTED', async () => {
    const tenantId = world().tenantB.tenantId
    const ok = await pool().query(
      `SELECT fin.request_erasure($1) AS status`,
      [tenantId],
    )
    expect(ok.rows[0].status).toBe('REQUESTED')
  })
})
