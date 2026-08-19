import express from 'express'
import request from 'supertest'
import { expect, it, vi } from 'vitest'
import { NOW } from '../../testing/seed.js'
import { finPostgresSuite } from '../../testing/suite.js'

const SECRET = 'stage-4-pricing-secret'

async function makeApp(databaseUrl) {
  process.env.JWT_SECRET = SECRET
  vi.resetModules()
  const { configure } = await import('../../../db.js')
  configure({ databaseUrl, force: true })
  const { registerFinPricingAdminRoutes } = await import('./routes.js')
  const { signElevatedToken } = await import('../../../auth.js')
  const app = express()
  app.use(express.json())
  const fakeAuth = (req, _res, next) => {
    req.user = {
      id: 'admin-1',
      token_version: 0,
      platform_role: 'platform_admin',
      email: 'admin@example.test',
    }
    next()
  }
  registerFinPricingAdminRoutes(app, {
    authMiddleware: fakeAuth,
    requirePlatformAdmin: (_req, _res, next) => next(),
  })
  return {
    app,
    elevate: () => signElevatedToken({ userId: 'admin-1', tokenVersion: 0 }),
  }
}

finPostgresSuite('fin.admin.pricing HTTP', {}, ({ world, url }) => {
  it('unelevated POST → 401 step_up_required', async () => {
    const { app } = await makeApp(url())
    const res = await request(app).post('/api/admin/fin/prices').send({
      code: 'http.unelev',
      currency: 'USD',
      reason_code: 'TEST',
    })
    expect(res.status).toBe(401)
    expect(res.body.code).toBe('step_up_required')
  })

  it('elevated POST without If-Match → 428', async () => {
    const { app, elevate } = await makeApp(url())
    const res = await request(app)
      .post('/api/admin/fin/prices')
      .set('X-Elevated-Token', elevate())
      .send({ code: 'http.noif', currency: 'USD', reason_code: 'TEST' })
    expect(res.status).toBe(428)
  })

  it('elevated POST with stale If-Match → 412 + current ETag; matching If-Match → 200 + bumped ETag', async () => {
    const { app, elevate } = await makeApp(url())
    const token = elevate()
    const created = await request(app)
      .post('/api/admin/fin/prices')
      .set('X-Elevated-Token', token)
      .set('If-Match', '"1"')
      .send({
        code: 'http.occ',
        currency: 'USD',
        reason_code: 'TEST',
        environment: 'LIVE',
      })
    expect(created.status).toBe(200)
    expect(created.headers.etag).toBe('"1"')

    const drafted = await request(app)
      .post(`/api/admin/fin/prices/${created.body.id}/versions`)
      .set('X-Elevated-Token', token)
      .set('If-Match', '"1"')
      .send({
        model: 'PER_UNIT',
        unit_rate_minor: 99,
        effective_from: NOW,
        reason_code: 'TEST',
        environment: 'LIVE',
      })
    expect(drafted.status).toBe(200)
    expect(drafted.headers.etag).toBe('"2"')

    const stale = await request(app)
      .post(`/api/admin/fin/prices/${created.body.id}/versions`)
      .set('X-Elevated-Token', token)
      .set('If-Match', '"1"')
      .send({
        model: 'PER_UNIT',
        unit_rate_minor: 100,
        effective_from: NOW,
        reason_code: 'TEST',
        environment: 'LIVE',
      })
    expect(stale.status).toBe(412)
    expect(stale.body.code).toBe('PRECONDITION_FAILED')
    expect(stale.body.current).toBeTruthy()
    expect(stale.headers.etag).toBe('"2"')
    expect(stale.status).not.toBe(409)

    const activated = await request(app)
      .post(`/api/admin/fin/prices/${created.body.id}/versions/${drafted.body.id}/activate`)
      .set('X-Elevated-Token', token)
      .set('If-Match', '"2"')
      .send({ reason_code: 'TEST', environment: 'LIVE', now: world().now })
    expect(activated.status).toBe(200)
    expect(activated.headers.etag).toBe('"3"')
    expect(activated.body.status).toBe('ACTIVE')
  })

  it('createPrice / draftPriceVersion / activatePriceVersion succeed end-to-end', async () => {
    const { app, elevate } = await makeApp(url())
    const token = elevate()
    const created = await request(app)
      .post('/api/admin/fin/prices')
      .set('X-Elevated-Token', token)
      .set('If-Match', '"1"')
      .send({ code: 'http.e2e', currency: 'USD', reason_code: 'TEST' })
    expect(created.status).toBe(200)
    const drafted = await request(app)
      .post(`/api/admin/fin/prices/${created.body.id}/versions`)
      .set('X-Elevated-Token', token)
      .set('If-Match', `"${created.body.version}"`)
      .send({
        model: 'PER_UNIT',
        unit_rate_minor: 5,
        effective_from: NOW,
        reason_code: 'TEST',
      })
    expect(drafted.status).toBe(200)
    const activated = await request(app)
      .post(`/api/admin/fin/prices/${created.body.id}/versions/${drafted.body.id}/activate`)
      .set('X-Elevated-Token', token)
      .set('If-Match', `"${drafted.body.version}"`)
      .send({ reason_code: 'TEST', now: NOW })
    expect(activated.status).toBe(200)
    expect(activated.body.command).toBe('ActivatePriceVersion')
  })
})
