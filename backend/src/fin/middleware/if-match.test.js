import request from 'supertest'
import { expect, it } from 'vitest'
import { finPostgresSuite } from '../testing/suite.js'
import { createIfMatchDemoApp } from './if-match.js'

finPostgresSuite('if-match D-T12', {}, ({ pool, world }) => {
  it('D-T12 — missing / * / weak / malformed / stale / matching If-Match', async () => {
    const app = createIfMatchDemoApp(pool())
    const tenantId = world().tenantA.tenantId
    const path = `/demo/fin/tenants/${tenantId}`

    const missing = await request(app).patch(path).send({ status: 'SUSPENDED' })
    expect(missing.status).toBe(428)

    const star = await request(app)
      .patch(path)
      .set('If-Match', '*')
      .send({ status: 'SUSPENDED' })
    expect(star.status).toBe(412)
    expect(star.body.code).toBe('IF_MATCH_STAR_FORBIDDEN')

    const weak = await request(app)
      .patch(path)
      .set('If-Match', 'W/"1"')
      .send({ status: 'SUSPENDED' })
    expect(weak.status).toBe(412)
    expect(weak.body.code).toBe('IF_MATCH_WEAK_FORBIDDEN')

    const malformed = await request(app)
      .patch(path)
      .set('If-Match', '1')
      .send({ status: 'SUSPENDED' })
    expect(malformed.status).toBe(400)
    expect(malformed.body.code).toBe('IF_MATCH_MALFORMED')

    const ok = await request(app)
      .patch(path)
      .set('If-Match', '"1"')
      .send({ status: 'SUSPENDED' })
    expect(ok.status).toBe(200)
    expect(ok.headers.etag).toBe('"2"')
    expect(ok.body.status).toBe('SUSPENDED')

    const stale = await request(app)
      .patch(path)
      .set('If-Match', '"1"')
      .send({ status: 'READ_ONLY' })
    expect(stale.status).toBe(412)
    expect(stale.body.code).toBe('PRECONDITION_FAILED')
    expect(stale.body.current).toBeTruthy()
    expect(stale.headers.etag).toBe('"2"')
    expect(stale.status).not.toBe(409)
  })
})
