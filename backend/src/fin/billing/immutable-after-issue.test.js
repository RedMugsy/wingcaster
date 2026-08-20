import { expect, it } from 'vitest'
import { asRole } from '../testing/seed.js'
import { finPostgresSuite } from '../testing/suite.js'
import { seedIssuedInvoice } from './test-support.js'

finPostgresSuite('billing immutable after issue', {}, ({ pool, world }) => {
  it('rejects UPDATE/DELETE on invoice_lines and invoice_tax_lines after ISSUE', async () => {
    const issued = await seedIssuedInvoice(pool(), world(), { amountMinor: 30 })
    const lines = await pool().query(
      `SELECT id FROM fin.invoice_lines WHERE invoice_id = $1`,
      [issued.invoiceId],
    )
    const tax = await pool().query(
      `SELECT id FROM fin.invoice_tax_lines WHERE invoice_id = $1`,
      [issued.invoiceId],
    )
    const client = await pool().connect()
    try {
      await expect(asRole(client, 'fin_app_role', {
        'fin.environment': 'LIVE',
        'fin.tenant_id': world().tenantA.tenantId,
      }, async (c) => c.query(
        `UPDATE fin.invoice_lines SET amount_minor = 1 WHERE id = $1`,
        [lines.rows[0].id],
      ))).rejects.toBeTruthy()
      await expect(asRole(client, 'fin_app_role', {
        'fin.environment': 'LIVE',
        'fin.tenant_id': world().tenantA.tenantId,
      }, async (c) => c.query(
        `DELETE FROM fin.invoice_lines WHERE id = $1`,
        [lines.rows[0].id],
      ))).rejects.toBeTruthy()
      if (tax.rowCount) {
        await expect(asRole(client, 'fin_app_role', {
          'fin.environment': 'LIVE',
          'fin.tenant_id': world().tenantA.tenantId,
        }, async (c) => c.query(
          `UPDATE fin.invoice_tax_lines SET tax_minor = 1 WHERE id = $1`,
          [tax.rows[0].id],
        ))).rejects.toBeTruthy()
      }
    } finally {
      client.release()
    }
  })
})
