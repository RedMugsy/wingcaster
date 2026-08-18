import { expect, it } from 'vitest'
import { asRole } from '../testing/seed.js'
import { finPostgresSuite } from '../testing/suite.js'

finPostgresSuite('append-only-revoke H1', {}, ({ pool, world }) => {
  it('A §18 #4 / H1 — fin_app_role cannot UPDATE append-only ledger or audit rows', async () => {
    const gucs = {
      'fin.environment': 'LIVE',
      'fin.tenant_id': world().tenantA.tenantId,
    }
    const client = await pool().connect()
    try {
      await expect(asRole(client, 'fin_app_role', gucs, (c) => c.query(
        `UPDATE fin.ledger_postings SET amount_units = 1`,
      ))).rejects.toThrow(/permission denied|insufficient privilege/i)

      await expect(asRole(client, 'fin_app_role', gucs, (c) => c.query(
        `UPDATE fin.ledger_transactions SET reason_code = 'x'`,
      ))).rejects.toThrow(/permission denied|insufficient privilege/i)

      await expect(asRole(client, 'fin_app_role', gucs, (c) => c.query(
        `UPDATE fin.financial_audit_events SET action = 'tamper'`,
      ))).rejects.toThrow(/permission denied|insufficient privilege/i)
    } finally {
      client.release()
    }
  })
})
