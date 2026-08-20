import { randomUUID } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import { applyPayment, recordPayment, reversePayment } from './payment-allocation.js'

describe('payment-allocation validation (fast)', () => {
  it('recordPayment rejects missing reason before a transaction', async () => {
    await expect(recordPayment({
      billingAccountId: randomUUID(),
      currency: 'USD',
      amountMinor: 100,
    })).rejects.toMatchObject({ code: 'REASON_CODE_REQUIRED' })
  })

  it('applyPayment rejects empty allocations before SQL', async () => {
    await expect(applyPayment({
      reasonCode: 'TEST',
      paymentId: randomUUID(),
      allocations: [],
    })).rejects.toMatchObject({ code: 'REASON_CODE_REQUIRED' })
  })

  it('reversePayment rejects missing paymentId before SQL', async () => {
    await expect(reversePayment({
      reasonCode: 'TEST',
    })).rejects.toMatchObject({ code: 'REASON_CODE_REQUIRED' })
  })
})
