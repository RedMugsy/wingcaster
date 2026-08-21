import { expect, it } from 'vitest'
import { commandEnv, NOW } from '../testing/seed.js'
import { finPostgresSuite } from '../testing/suite.js'
import { CHECKS } from './checks.js'
import { runReconciliation } from './runner.js'
import { rateMeteredUsage } from '../rating/engine.js'
import { rateInput, seedRatedCase } from '../rating/test-support.js'
import { WINDOW_END, WINDOW_START } from '../metering/test-support.js'
import { openBillingPeriod } from '../billing/periods.js'
import { advanceBillingPeriodClose } from '../billing/period-close.js'
import { applyPayment, recordPayment } from '../billing/payment-allocation.js'

const CLOSE_NOW = '2026-09-02T00:00:00.000Z'

finPostgresSuite('reconciliation runner after billing', {}, ({ pool, world }) => {
  it('non-ERROR checks are GREEN after period → rate → issue → pay', async () => {
    const seeded = await seedRatedCase(pool(), world(), {
      label: 'billed',
      eventCount: 2,
      unitRateMinor: 10,
    })
    await rateMeteredUsage(rateInput(seeded))
    const env = commandEnv(world(), { reasonCode: 'TEST', now: CLOSE_NOW })
    const opened = await openBillingPeriod({
      ...env,
      now: NOW,
      billingAccountId: seeded.billingAccountId,
      periodKey: '2026-08',
      startsAt: WINDOW_START,
      endsAt: WINDOW_END,
    })
    await advanceBillingPeriodClose({
      ...env,
      billingPeriodId: opened.periodId,
      targetStatus: 'FINAL',
      fiscalContext: '2026',
    })
    const invoice = await pool().query(
      `SELECT id, total_minor, due_at FROM fin.invoices WHERE billing_period_id = $1`,
      [opened.periodId],
    )
    expect(invoice.rowCount).toBe(1)
    const payment = await recordPayment({
      ...env,
      billingAccountId: seeded.billingAccountId,
      currency: 'USD',
      amountMinor: invoice.rows[0].total_minor,
      clientKey: invoice.rows[0].id,
    })
    await applyPayment({
      ...env,
      paymentId: payment.paymentId,
      allocations: [{
        invoiceId: invoice.rows[0].id,
        amountMinor: invoice.rows[0].total_minor,
      }],
    })

    const run = await runReconciliation(pool(), { now: CLOSE_NOW })
    const byCode = Object.fromEntries(run.results.map((r) => [r.check_code, r]))
    for (const check of CHECKS) {
      expect(byCode[check.check_code].result, check.check_code).toBe('GREEN')
    }
  })
})
