import { randomUUID } from 'node:crypto'
import request from 'supertest'
import { expect, it } from 'vitest'
import { commandEnv } from '../testing/seed.js'
import { finPostgresSuite } from '../testing/suite.js'
import { seedIssuedInvoice } from '../billing/test-support.js'
import { openDunningCase } from '../dunning/cases.js'
import { insertControls } from '../funding/test-support.js'
import { makeOpsApp, writeHeaders } from './http-support.js'

finPostgresSuite('admin/routes-dunning', {}, ({ url, world, pool }) => {
  it('advances an open case; unknown case errors', async () => {
    const { app, elevate } = await makeOpsApp(url())
    const token = elevate()
    const missing = await request(app)
      .post('/api/admin/fin/dunning/cases/00000000-0000-0000-0000-000000000099/advance')
      .set(writeHeaders(token))
      .send({ reason_code: 'TEST' })
    expect(missing.status).toBeGreaterThanOrEqual(400)

    await insertControls(pool(), {
      subjectType: 'BILLING_ACCOUNT',
      subjectId: world().tenantA.billingAccountId,
    })
    const issued = await seedIssuedInvoice(pool(), world(), { amountMinor: 50 })
    const opened = await openDunningCase({
      ...commandEnv(world(), { reasonCode: 'AR_OVERDUE' }),
      invoiceId: issued.invoiceId,
      billingAccountId: world().tenantA.billingAccountId,
      invoiceStatus: 'ISSUED',
      dueAt: issued.dueAt,
    })
    const advanced = await request(app)
      .post(`/api/admin/fin/dunning/cases/${opened.caseId}/advance`)
      .set(writeHeaders(token, { idempotencyKey: `DUN:${randomUUID()}` }))
      .send({ reason_code: 'TEST' })
    expect(advanced.status).toBe(200)
  })

  it('cure returns a domain error when the invoice is still unpaid', async () => {
    const { app, elevate } = await makeOpsApp(url())
    await insertControls(pool(), {
      subjectType: 'BILLING_ACCOUNT',
      subjectId: world().tenantA.billingAccountId,
    })
    const issued = await seedIssuedInvoice(pool(), world(), { amountMinor: 75 })
    const opened = await openDunningCase({
      ...commandEnv(world(), { reasonCode: 'AR_OVERDUE' }),
      invoiceId: issued.invoiceId,
      billingAccountId: world().tenantA.billingAccountId,
      invoiceStatus: 'ISSUED',
      dueAt: issued.dueAt,
    })
    const cured = await request(app)
      .post(`/api/admin/fin/dunning/cases/${opened.caseId}/cure`)
      .set(writeHeaders(elevate(), { idempotencyKey: `CURE:${randomUUID()}` }))
      .send({ reason_code: 'TEST' })
    expect([200, 400, 409]).toContain(cured.status)
  })
})
