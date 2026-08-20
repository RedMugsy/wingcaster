import { randomUUID } from 'node:crypto'
import { expect, it } from 'vitest'
import { commandEnv } from '../testing/seed.js'
import { finPostgresSuite } from '../testing/suite.js'
import { insertControls } from '../funding/test-support.js'
import { openDunningCase } from '../dunning/cases.js'
import { seedIssuedInvoice } from './test-support.js'
import { applyPayment, recordPayment } from './payment-allocation.js'

finPostgresSuite('billing dunning cure on PAID', {}, ({ pool, world }) => {
  it('ApplyPayment to PAID cures an open dunning case in the same tx', async () => {
    const issued = await seedIssuedInvoice(pool(), world(), {
      dueAt: '2020-01-01T00:00:00.000Z',
      amountMinor: 50,
    })
    const env = commandEnv(world(), { reasonCode: 'TEST' })
    await insertControls(pool(), {
      subjectType: 'BILLING_ACCOUNT',
      subjectId: world().tenantA.billingAccountId,
    })
    const opened = await openDunningCase({
      ...env,
      invoiceId: issued.invoiceId,
      billingAccountId: world().tenantA.billingAccountId,
      invoiceStatus: 'ISSUED',
      dueAt: '2020-01-01T00:00:00.000Z',
      policyDelayMs: 0,
    })
    const payment = await recordPayment({
      ...env,
      billingAccountId: world().tenantA.billingAccountId,
      currency: 'USD',
      amountMinor: 50,
      clientKey: randomUUID(),
    })
    await applyPayment({
      ...env,
      paymentId: payment.paymentId,
      allocations: [{ invoiceId: issued.invoiceId, amountMinor: 50 }],
    })
    const dunning = await pool().query(
      `SELECT status FROM fin.dunning_cases WHERE id = $1`,
      [opened.caseId],
    )
    expect(dunning.rows[0].status).toBe('CURED')
    const invoice = await pool().query(
      `SELECT status FROM fin.invoices WHERE id = $1`,
      [issued.invoiceId],
    )
    expect(invoice.rows[0].status).toBe('PAID')
  })
})
