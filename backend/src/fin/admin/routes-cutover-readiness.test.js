import request from 'supertest'
import { expect, it } from 'vitest'
import { finPostgresSuite } from '../testing/suite.js'
import { makeOpsApp } from './http-support.js'

finPostgresSuite('admin/routes-cutover-readiness', {}, ({ url }) => {
  it('GET /api/admin/fin/cutover/readiness is platform_admin gated', async () => {
    const { app: forbidden } = await makeOpsApp(url(), { role: 'agent' })
    const denied = await request(forbidden).get('/api/admin/fin/cutover/readiness')
    expect(denied.status).toBe(403)

    const { app } = await makeOpsApp(url())
    const res = await request(app).get('/api/admin/fin/cutover/readiness')
    expect(res.status).toBe(200)
    expect(res.body).toEqual(expect.objectContaining({
      dual_write_error_count_24h: expect.any(Number),
      R090: expect.stringMatching(/^(GREEN|DRIFT)$/),
      R091: expect.stringMatching(/^(GREEN|DRIFT)$/),
      R092: expect.stringMatching(/^(GREEN|DRIFT)$/),
      backfill_status: expect.any(Array),
      corrections_total: expect.any(Number),
      ready_for_cutover: expect.any(Boolean),
    }))
    expect(res.body.R090).toBe('GREEN')
    expect(res.body.R091).toBe('GREEN')
    expect(res.body.R092).toBe('GREEN')
    expect(res.body.parity).toEqual(expect.objectContaining({
      burn_in_days_required: 30,
      burn_in_met: false,
    }))
    expect(res.body.attestation.eligible_to_sign).toBe(false)
    expect(res.body.ready_for_cutover).toBe(false)
  })
})
