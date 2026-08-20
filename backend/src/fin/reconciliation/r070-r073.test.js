import { expect, it } from 'vitest'
import { commandEnv } from '../testing/seed.js'
import { finPostgresSuite } from '../testing/suite.js'
import { runReconciliation } from './runner.js'
import { seedIssuedInvoice } from '../billing/test-support.js'
import { applyPayment, recordPayment } from '../billing/payment-allocation.js'

finPostgresSuite('reconciliation R070–R073', {}, ({ pool, world }) => {
  it('R070–R073 are GREEN after issue + partial apply', async () => {
    const issued = await seedIssuedInvoice(pool(), world(), { amountMinor: 90 })
    const env = commandEnv(world(), { reasonCode: 'TEST' })
    const payment = await recordPayment({
      ...env,
      billingAccountId: world().tenantA.billingAccountId,
      currency: 'USD',
      amountMinor: 90,
      clientKey: issued.invoiceId,
    })
    await applyPayment({
      ...env,
      paymentId: payment.paymentId,
      allocations: [{ invoiceId: issued.invoiceId, amountMinor: 40 }],
    })
    const run = await runReconciliation(pool(), { now: env.now })
    const byCode = Object.fromEntries(run.results.map((r) => [r.check_code, r]))
    expect(byCode.R070.result).toBe('GREEN')
    expect(byCode.R071.result).toBe('GREEN')
    expect(byCode.R072.result).toBe('GREEN')
    expect(byCode.R073.result).toBe('GREEN')
  })
})
