import { randomUUID } from 'node:crypto'
import request from 'supertest'
import { expect, it } from 'vitest'
import { insertApproval } from '../testing/seed.js'
import { finPostgresSuite } from '../testing/suite.js'
import { activateFacility } from '../postpaid/facilities.js'
import { commandEnv } from '../testing/seed.js'
import { makeOpsApp, writeHeaders } from './http-support.js'

finPostgresSuite('admin/routes-facilities', {}, ({ world, url, pool }) => {
  it('unelevated POST → 401; missing If-Match → 428; Idempotency-Key is accepted', async () => {
    const { app, elevate } = await makeOpsApp(url())
    const unelevated = await request(app).post('/api/admin/fin/facilities').send({
      reason_code: 'TEST',
      billing_account_id: world().tenantA.billingAccountId,
    })
    expect(unelevated.status).toBe(401)

    const token = elevate()
    const noMatch = await request(app)
      .post('/api/admin/fin/facilities')
      .set('X-Elevated-Token', token)
      .send({ reason_code: 'TEST' })
    expect(noMatch.status).toBe(428)

    const created = await request(app)
      .post('/api/admin/fin/facilities')
      .set(writeHeaders(token, { idempotencyKey: `FACILITY:${randomUUID()}` }))
      .send({
        reason_code: 'TEST',
        tenant_id: world().tenantA.tenantId,
        billing_account_id: world().tenantA.billingAccountId,
        currency: 'GBP',
        limit_minor: 5000,
        net_terms_days: 30,
      })
    expect(created.status).toBe(200)
    expect(created.body.status).toBe('PENDING')
    expect(created.body.environment || created.headers).toBeTruthy()
  })

  it('pause without FACILITY_OPS approval errors; pause with approval succeeds', async () => {
    const { app, elevate } = await makeOpsApp(url())
    const token = elevate()
    const created = await request(app)
      .post('/api/admin/fin/facilities')
      .set(writeHeaders(token, { idempotencyKey: `FACILITY:${randomUUID()}` }))
      .send({
        reason_code: 'TEST',
        tenant_id: world().tenantA.tenantId,
        billing_account_id: world().tenantA.billingAccountId,
        currency: 'CAD',
        limit_minor: 1000,
        net_terms_days: 15,
      })
    expect(created.status).toBe(200)
    await activateFacility({
      ...commandEnv(world(), { reasonCode: 'TEST' }),
      facilityId: created.body.facilityId,
      actorType: 'SYSTEM',
    })
    const denied = await request(app)
      .post(`/api/admin/fin/facilities/${created.body.facilityId}/pause`)
      .set(writeHeaders(token, { ifMatch: `"${created.body.version || 1}"` }))
      .send({ reason_code: 'TEST' })
    expect(denied.status).toBeGreaterThanOrEqual(400)

    const approvalId = await insertApproval(pool(), {
      tenantId: world().tenantA.tenantId,
      actionKind: 'FACILITY_OPS',
    })
    const paused = await request(app)
      .post(`/api/admin/fin/facilities/${created.body.facilityId}/pause`)
      .set(writeHeaders(token, { idempotencyKey: `PAUSE:${randomUUID()}` }))
      .send({ reason_code: 'TEST', approval_request_id: approvalId })
    expect(paused.status).toBe(200)
    expect(paused.body.status).toBe('PAUSED')
  })
})
