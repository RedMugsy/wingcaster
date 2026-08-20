import { randomUUID } from 'node:crypto'
import { expect, it } from 'vitest'
import { commandEnv } from '../testing/seed.js'
import { finPostgresSuite } from '../testing/suite.js'
import { seedIssuedInvoice } from './test-support.js'
import { applyPayment, recordPayment, reversePayment } from './payment-allocation.js'

finPostgresSuite('billing payments', {}, ({ pool, world }) => {
  it('records, partially allocates (stays RECEIVED), fully allocates, then reverses', async () => {
    const issued = await seedIssuedInvoice(pool(), world(), { amountMinor: 100 })
    const env = commandEnv(world(), { reasonCode: 'TEST' })
    const recorded = await recordPayment({
      ...env,
      billingAccountId: world().tenantA.billingAccountId,
      currency: 'USD',
      amountMinor: 100,
      clientKey: randomUUID(),
    })
    expect(recorded.status).toBe('RECEIVED')
    const cash = await pool().query(
      `SELECT balance_minor FROM fin.unapplied_cash
        WHERE billing_account_id = $1 AND currency = 'USD'`,
      [world().tenantA.billingAccountId],
    )
    expect(Number(cash.rows[0].balance_minor)).toBe(100)

    const partial = await applyPayment({
      ...env,
      paymentId: recorded.paymentId,
      allocations: [{ invoiceId: issued.invoiceId, amountMinor: 40 }],
    })
    expect(partial.status).toBe('RECEIVED')
    const inv = await pool().query(`SELECT status FROM fin.invoices WHERE id = $1`, [issued.invoiceId])
    expect(inv.rows[0].status).toBe('PART_PAID')
    const leftover = await pool().query(
      `SELECT balance_minor FROM fin.unapplied_cash
        WHERE billing_account_id = $1 AND currency = 'USD'`,
      [world().tenantA.billingAccountId],
    )
    expect(Number(leftover.rows[0].balance_minor)).toBe(60)

    const full = await applyPayment({
      ...env,
      paymentId: recorded.paymentId,
      allocations: [{ invoiceId: issued.invoiceId, amountMinor: 60 }],
      idempotencyKey: `PAY:APPLY:${recorded.paymentId}:rest`,
    })
    expect(full.status).toBe('ALLOCATED')
    const paid = await pool().query(`SELECT status FROM fin.invoices WHERE id = $1`, [issued.invoiceId])
    expect(paid.rows[0].status).toBe('PAID')

    const reversed = await reversePayment({
      ...env, paymentId: recorded.paymentId, reason: 'TEST',
    })
    expect(reversed.status).toBe('REVERSED')
    const after = await pool().query(`SELECT status FROM fin.invoices WHERE id = $1`, [issued.invoiceId])
    expect(after.rows[0].status).toBe('ISSUED')
  })

  it('dedupes PSP provider_event_id permanently', async () => {
    const env = commandEnv(world(), { reasonCode: 'TEST' })
    const eventId = `evt_${randomUUID()}`
    const first = await recordPayment({
      ...env,
      billingAccountId: world().tenantA.billingAccountId,
      currency: 'USD',
      amountMinor: 25,
      provider: 'STRIPE',
      providerEventId: eventId,
    })
    const second = await recordPayment({
      ...env,
      billingAccountId: world().tenantA.billingAccountId,
      currency: 'USD',
      amountMinor: 25,
      provider: 'STRIPE',
      providerEventId: eventId,
      idempotencyKey: `PAY:RECORD:STRIPE:${eventId}:retry`,
    })
    expect(second.paymentId).toBe(first.paymentId)
    expect(second.replayed).toBe(true)
  })
})
