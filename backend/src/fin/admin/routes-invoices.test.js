import { randomUUID } from 'node:crypto'
import request from 'supertest'
import { expect, it } from 'vitest'
import { finPostgresSuite } from '../testing/suite.js'
import { seedIssuedInvoice } from '../billing/test-support.js'
import { makeOpsApp, writeHeaders } from './http-support.js'

finPostgresSuite('admin/routes-invoices', {}, ({ url, world, pool }) => {
  it('voids an issued unpaid invoice', async () => {
    const { app, elevate } = await makeOpsApp(url())
    const issued = await seedIssuedInvoice(pool(), world(), { amountMinor: 30 })
    const voided = await request(app)
      .post(`/api/admin/fin/invoices/${issued.invoiceId}/void`)
      .set(writeHeaders(elevate(), { idempotencyKey: `VOID:${randomUUID()}` }))
      .send({ reason_code: 'TEST' })
    expect(voided.status).toBe(200)
  })

  it('issues a credit note against an issued invoice; missing amount errors', async () => {
    const { app, elevate } = await makeOpsApp(url())
    const issued = await seedIssuedInvoice(pool(), world(), { amountMinor: 80 })
    const missing = await request(app)
      .post(`/api/admin/fin/invoices/${issued.invoiceId}/credit-note`)
      .set(writeHeaders(elevate(), { idempotencyKey: `CN:${randomUUID()}` }))
      .send({ reason_code: 'TEST' })
    expect(missing.status).toBeGreaterThanOrEqual(400)

    const note = await request(app)
      .post(`/api/admin/fin/invoices/${issued.invoiceId}/credit-note`)
      .set(writeHeaders(elevate(), { idempotencyKey: `CN:${randomUUID()}` }))
      .send({ reason_code: 'TEST', amount_minor: 10 })
    expect(note.status).toBe(200)
  })

  it('issues a debit note against an issued invoice', async () => {
    const { app, elevate } = await makeOpsApp(url())
    const issued = await seedIssuedInvoice(pool(), world(), { amountMinor: 80 })
    const note = await request(app)
      .post(`/api/admin/fin/invoices/${issued.invoiceId}/debit-note`)
      .set(writeHeaders(elevate(), { idempotencyKey: `DN:${randomUUID()}` }))
      .send({ reason_code: 'TEST', amount_minor: 5 })
    expect(note.status).toBe(200)
  })
})
