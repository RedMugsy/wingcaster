import request from 'supertest'
import { expect, it } from 'vitest'
import { finPostgresSuite } from '../testing/suite.js'
import { makeOpsApp, writeHeaders } from './http-support.js'
import { seedConsecutiveGreenDays } from '../cutover/parity/test-support.js'

finPostgresSuite('admin/routes-cutover-parity', {}, ({ url, pool }) => {
  it('GET /api/admin/fin/cutover/readiness returns the Stage 13c shape', async () => {
    const { app: forbidden } = await makeOpsApp(url(), { role: 'agent' })
    expect((await request(forbidden).get('/api/admin/fin/cutover/readiness')).status).toBe(403)

    const { app } = await makeOpsApp(url())
    const res = await request(app).get('/api/admin/fin/cutover/readiness')
    expect(res.status).toBe(200)
    expect(res.body).toEqual(expect.objectContaining({
      dual_write_error_count_24h: expect.any(Number),
      R090: 'GREEN',
      R091: 'GREEN',
      R092: 'GREEN',
      R093: expect.stringMatching(/^(GREEN|AMBER|DRIFT)$/),
      R094: expect.stringMatching(/^(GREEN|DRIFT)$/),
      R095: expect.stringMatching(/^(GREEN|DRIFT|WARN)$/),
      R096: 'GREEN',
      mode: 'OFF',
      parity: expect.objectContaining({
        last_report_at: null,
        last_drift_rate_bps: expect.any(Number),
        consecutive_green_days: 0,
        burn_in_days_required: 30,
        burn_in_met: false,
      }),
      attestation: expect.objectContaining({
        last_signed_at: null,
        signed_by_email: null,
        eligible_to_sign: false,
      }),
      ready_for_cutover: false,
    }))
  })

  it('POST /api/admin/fin/cutover/attest requires elevated auth and signs when eligible', async () => {
    const { app } = await makeOpsApp(url())
    const denied = await request(app)
      .post('/api/admin/fin/cutover/attest')
      .send({ note: 'nope' })
    expect(denied.status).toBe(401)

    await seedConsecutiveGreenDays(pool(), { now: new Date().toISOString() })
    const { app: admin, elevate } = await makeOpsApp(url())
    const signed = await request(admin)
      .post('/api/admin/fin/cutover/attest')
      .set(writeHeaders(elevate()))
      .send({ note: 'Finance sign-off' })
    expect(signed.status).toBe(200)
    expect(signed.body.inserted).toBe(true)
    expect(signed.body.attestation.signed_by_email).toBe('admin@example.test')

    const ready = await request(admin).get('/api/admin/fin/cutover/readiness')
    expect(ready.body.attestation.eligible_to_sign).toBe(true)
    expect(ready.body.attestation.last_signed_at).toBeTruthy()
    expect(ready.body.ready_for_cutover).toBe(true)
  })
})
