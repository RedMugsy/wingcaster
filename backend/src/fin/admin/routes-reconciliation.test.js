import request from 'supertest'
import { expect, it } from 'vitest'
import { finPostgresSuite } from '../testing/suite.js'
import { makeOpsApp, writeHeaders } from './http-support.js'

finPostgresSuite('admin/routes-reconciliation', {}, ({ url }) => {
  it('runs an on-demand reconciliation and lists the run', async () => {
    const { app, elevate } = await makeOpsApp(url())
    const token = elevate()
    const ran = await request(app)
      .post('/api/admin/fin/reconciliation/run')
      .set(writeHeaders(token))
      .send({ reason_code: 'TEST', environment: 'TEST', now: '1999-01-01T00:00:00.000Z' })
    expect(ran.status).toBe(200)
    expect(ran.body.skipped === true || ran.body.runId || ran.body.id || Array.isArray(ran.body.results)).toBe(true)

    const list = await request(app).get('/api/admin/fin/reconciliation/runs')
    expect(list.status).toBe(200)
    expect(Array.isArray(list.body.runs)).toBe(true)
  })

  it('resolveDrift returns 501 with DL-165', async () => {
    const { app, elevate } = await makeOpsApp(url())
    const res = await request(app)
      .post('/api/admin/fin/reconciliation/drift/00000000-0000-0000-0000-000000000001/resolve')
      .set(writeHeaders(elevate()))
      .send({ reason_code: 'TEST' })
    expect(res.status).toBe(501)
    expect(res.body.dl).toBe('DL-165')
  })
})
