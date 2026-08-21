import request from 'supertest'
import { expect, it } from 'vitest'
import { finPostgresSuite } from '../testing/suite.js'
import { makeOpsApp, writeHeaders } from './http-support.js'

finPostgresSuite('admin/routes-approvals', {}, ({ url }) => {
  it('lists approvals for the session environment', async () => {
    const { app } = await makeOpsApp(url())
    const res = await request(app).get('/api/admin/fin/approvals')
    expect(res.status).toBe(200)
    expect(Array.isArray(res.body.approvals)).toBe(true)
  })

  it('approve and reject return 501 DL-166 (DecideApproval not built)', async () => {
    const { app, elevate } = await makeOpsApp(url())
    const token = elevate()
    const approve = await request(app)
      .post('/api/admin/fin/approvals/00000000-0000-0000-0000-000000000001/approve')
      .set(writeHeaders(token))
      .send({ reason_code: 'TEST' })
    expect(approve.status).toBe(501)
    expect(approve.body.dl).toBe('DL-166')
    const reject = await request(app)
      .post('/api/admin/fin/approvals/00000000-0000-0000-0000-000000000001/reject')
      .set(writeHeaders(token))
      .send({ reason_code: 'TEST' })
    expect(reject.status).toBe(501)
    expect(reject.body.dl).toBe('DL-166')
  })
})
