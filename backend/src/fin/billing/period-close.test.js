import { expect, it } from 'vitest'
import { commandEnv, NOW } from '../testing/seed.js'
import { finPostgresSuite } from '../testing/suite.js'
import { rateMeteredUsage } from '../rating/engine.js'
import { rateInput, seedRatedCase } from '../rating/test-support.js'
import { meterInput, usagePayload, WINDOW_END, WINDOW_START } from '../metering/test-support.js'
import { ingestUsageEvent } from '../usage/ingest.js'
import { meterPeriod } from '../metering/pipeline.js'
import { openBillingPeriod } from './periods.js'
import {
  advanceBillingPeriodClose,
  drainMeteringQueue,
  freezeUsageWindow,
  verifyMeteredRated,
} from './period-close.js'

const CLOSE_NOW = '2026-09-02T00:00:00.000Z'

finPostgresSuite('billing period-close 12-step', {}, ({ pool, world }) => {
  async function openAugustPeriod(billingAccountId) {
    const env = commandEnv(world(), { reasonCode: 'TEST', now: CLOSE_NOW })
    const opened = await openBillingPeriod({
      ...env,
      now: NOW,
      billingAccountId,
      periodKey: `2026-08-${billingAccountId.slice(0, 8)}`,
      startsAt: WINDOW_START,
      endsAt: WINDOW_END,
    })
    return { env, periodId: opened.periodId }
  }

  it('refuses freeze before ends_at, drainage before metering, and rating before rate', async () => {
    const seeded = await seedRatedCase(pool(), world(), {
      label: 'pre',
      eventCount: 1,
      unitRateMinor: 10,
    })
    const { env, periodId } = await openAugustPeriod(seeded.billingAccountId)

    await expect(freezeUsageWindow({
      ...env,
      now: NOW,
      billingPeriodId: periodId,
      idempotencyKey: `BP:CLOSE:1:early:${periodId}`,
    })).rejects.toMatchObject({ code: 'BILLING_PERIOD_NOT_ENDED' })

    await freezeUsageWindow({ ...env, billingPeriodId: periodId })
    await ingestUsageEvent(usagePayload(world(), {
      eventType: seeded.eventType,
      holderId: seeded.holderId,
      billingAccountId: seeded.billingAccountId,
      occurredAt: '2026-08-15T00:00:00.000Z',
      receivedAt: '2026-08-15T00:00:00.000Z',
    }))
    await expect(drainMeteringQueue({
      ...env,
      billingPeriodId: periodId,
      idempotencyKey: `BP:CLOSE:2:drain:${periodId}`,
    })).rejects.toMatchObject({ code: 'BILLING_PERIOD_DRAINAGE_INCOMPLETE' })

    await meterPeriod(meterInput(world(), {
      meterVersionId: seeded.meterVersionId,
      extra: { holderId: seeded.holderId },
    }))
    const drained = await drainMeteringQueue({ ...env, billingPeriodId: periodId })
    expect(drained.status).toBe('USAGE_CLOSED')

    await expect(verifyMeteredRated({
      ...env,
      billingPeriodId: periodId,
      idempotencyKey: `BP:CLOSE:3:rate:${periodId}`,
    })).rejects.toMatchObject({ code: 'BILLING_PERIOD_RATING_INCOMPLETE' })
  })

  it('walks OPEN through FINAL when usage is metered and rated', async () => {
    const seeded = await seedRatedCase(pool(), world(), {
      label: 'walk',
      eventCount: 2,
      unitRateMinor: 10,
    })
    await rateMeteredUsage(rateInput(seeded))
    const { env, periodId } = await openAugustPeriod(seeded.billingAccountId)
    const closed = await advanceBillingPeriodClose({
      ...env,
      billingPeriodId: periodId,
      targetStatus: 'FINAL',
      fiscalContext: '2026',
    })
    expect(closed.status).toBe('FINAL')
    expect(closed.invoiceStatus).toBe('ISSUED')
    const period = await pool().query(
      `SELECT status FROM fin.billing_periods WHERE id = $1`,
      [periodId],
    )
    expect(period.rows[0].status).toBe('FINAL')
    const invoice = await pool().query(
      `SELECT status, invoice_number FROM fin.invoices WHERE billing_period_id = $1`,
      [periodId],
    )
    expect(invoice.rows[0].status).toBe('ISSUED')
    expect(invoice.rows[0].invoice_number).toMatch(/^INV-SA-2026-/)
  })
})
