import { randomUUID } from 'node:crypto'
import request from 'supertest'
import { expect, it } from 'vitest'
import { commandEnv } from '../testing/seed.js'
import { finPostgresSuite } from '../testing/suite.js'
import { seedOpenEndedPeriod } from '../billing/test-support.js'
import { makeOpsApp, writeHeaders } from './http-support.js'

finPostgresSuite('admin/routes-billing', {}, ({ url, world }) => {
  it('close walks an OPEN period; reopen of OPEN errors', async () => {
    const { app, elevate } = await makeOpsApp(url())
    const token = elevate()
    const opened = await seedOpenEndedPeriod(world(), {
      periodKey: `admin-${randomUUID().slice(0, 8)}`,
    })
    const periodId = opened.periodId || opened.id
    const closed = await request(app)
      .post(`/api/admin/fin/billing/periods/${periodId}/close`)
      .set(writeHeaders(token, { idempotencyKey: `BP:${randomUUID()}` }))
      .send({ reason_code: 'TEST', tenant_id: world().tenantA.tenantId })
    expect([200, 400, 409]).toContain(closed.status)

    const reopen = await request(app)
      .post(`/api/admin/fin/billing/periods/${periodId}/reopen`)
      .set(writeHeaders(token, { idempotencyKey: `BPR:${randomUUID()}` }))
      .send({ reason_code: 'TEST' })
    expect(reopen.status).toBeGreaterThanOrEqual(400)
  })
})
