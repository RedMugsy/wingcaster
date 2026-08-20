import { randomUUID } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import { openBillingPeriod, reopenBillingPeriod } from './periods.js'

describe('billing periods validation (fast)', () => {
  it('rejects missing reason before opening a transaction', async () => {
    await expect(openBillingPeriod({
      billingAccountId: randomUUID(),
      periodKey: '2026-01',
      startsAt: '2026-01-01T00:00:00.000Z',
      endsAt: '2026-02-01T00:00:00.000Z',
    })).rejects.toMatchObject({ code: 'REASON_CODE_REQUIRED' })
  })

  it('rejects reopen without a period id before SQL', async () => {
    await expect(reopenBillingPeriod({
      reasonCode: 'TEST',
    })).rejects.toMatchObject({ code: 'REASON_CODE_REQUIRED' })
  })
})
