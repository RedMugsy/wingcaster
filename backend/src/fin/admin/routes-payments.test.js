import { randomUUID } from 'node:crypto'
import request from 'supertest'
import { expect, it } from 'vitest'
import { finPostgresSuite } from '../testing/suite.js'
import { seedIssuedInvoice } from '../billing/test-support.js'
import { makeOpsApp, writeHeaders } from './http-support.js'

finPostgresSuite('admin/routes-payments', {}, ({ url, world, pool }) => {
  it('records a payment then reverses the unallocated remainder', async () => {
    const { app, elevate } = await makeOpsApp(url())
    const token = elevate()
    const created = await request(app)
      .post('/api/admin/fin/payments')
      .set(writeHeaders(token, { idempotencyKey: `PAY:${randomUUID()}` }))
      .send({
        reason_code: 'TEST',
        tenant_id: world().tenantA.tenantId,
        billing_account_id: world().tenantA.billingAccountId,
        currency: 'USD',
        amount_minor: 40,
      })
    expect(created.status).toBe(200)
    expect(created.body.paymentId).toBeTruthy()

    const reversed = await request(app)
      .post(`/api/admin/fin/payments/${created.body.paymentId}/reverse`)
      .set(writeHeaders(token, { idempotencyKey: `PAYR:${randomUUID()}` }))
      .send({ reason_code: 'TEST' })
    expect(reversed.status).toBe(200)
    expect(reversed.body.status).toBe('REVERSED')
  })

  it('apply without allocations is a validation error', async () => {
    const { app, elevate } = await makeOpsApp(url())
    const issued = await seedIssuedInvoice(pool(), world(), { amountMinor: 20 })
    const created = await request(app)
      .post('/api/admin/fin/payments')
      .set(writeHeaders(elevate(), { idempotencyKey: `PAY:${randomUUID()}` }))
      .send({
        reason_code: 'TEST',
        tenant_id: world().tenantA.tenantId,
        billing_account_id: world().tenantA.billingAccountId,
        currency: 'USD',
        amount_minor: 20,
      })
    const applied = await request(app)
      .post(`/api/admin/fin/payments/${created.body.paymentId}/apply`)
      .set(writeHeaders(elevate(), { idempotencyKey: `PAYA:${randomUUID()}` }))
      .send({ reason_code: 'TEST', allocations: [] })
    expect(applied.status).toBeGreaterThanOrEqual(400)
    expect(issued.invoiceId).toBeTruthy()
  })
})
