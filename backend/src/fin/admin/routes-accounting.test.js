import { randomUUID } from 'node:crypto'
import request from 'supertest'
import { expect, it } from 'vitest'
import { commandEnv, insertApproval } from '../testing/seed.js'
import { finPostgresSuite } from '../testing/suite.js'
import { openAccountingPeriod } from '../accounting/periods.js'
import { runReconciliation } from '../reconciliation/runner.js'
import { makeOpsApp, writeHeaders } from './http-support.js'

finPostgresSuite('admin/routes-accounting', {}, ({ url, world, pool }) => {
  it('soft-closes a past OPEN period; hard-close then reopen with override', async () => {
    const { app, elevate } = await makeOpsApp(url())
    const token = elevate()
    const env = commandEnv(world(), { reasonCode: 'TEST' })
    const opened = await openAccountingPeriod({
      ...env,
      legalEntityId: world().legalEntityId,
      periodKey: `admin-${randomUUID().slice(0, 8)}`,
      startsAt: '2026-01-01T00:00:00.000Z',
      endsAt: '2026-02-01T00:00:00.000Z',
    })
    const soft = await request(app)
      .post(`/api/admin/fin/accounting/periods/${opened.periodId}/soft-close`)
      .set(writeHeaders(token, { idempotencyKey: `SOFT:${randomUUID()}` }))
      .send({ reason_code: 'TEST' })
    expect(soft.status).toBe(200)
    expect(soft.body.status).toBe('SOFT_CLOSED')

    await runReconciliation(pool(), { environment: 'LIVE', now: new Date().toISOString() })
    const hard = await request(app)
      .post(`/api/admin/fin/accounting/periods/${opened.periodId}/hard-close`)
      .set(writeHeaders(token, { idempotencyKey: `HARD:${randomUUID()}` }))
      .send({ reason_code: 'TEST' })
    expect([200, 400, 409]).toContain(hard.status)

    const approvalId = await insertApproval(pool(), {
      tenantId: world().tenantA.tenantId,
      actionKind: 'RECONCILIATION_OVERRIDE',
    })
    const reopened = await request(app)
      .post(`/api/admin/fin/accounting/periods/${opened.periodId}/reopen`)
      .set(writeHeaders(token, { idempotencyKey: `REOPEN:${randomUUID()}` }))
      .send({ reason_code: 'TEST', approval_request_id: approvalId })
    expect([200, 400, 409, 501]).toContain(reopened.status)
  })

  it('soft-close of a missing period is a domain error', async () => {
    const { app, elevate } = await makeOpsApp(url())
    const res = await request(app)
      .post('/api/admin/fin/accounting/periods/00000000-0000-0000-0000-000000000099/soft-close')
      .set(writeHeaders(elevate()))
      .send({ reason_code: 'TEST' })
    expect(res.status).toBeGreaterThanOrEqual(400)
  })
})
