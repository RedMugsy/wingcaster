/**
 * Real-Postgres — POST /cutover/activate and /deactivate HTTP gates.
 */
import { randomUUID } from 'node:crypto'
import request from 'supertest'
import { expect, it } from 'vitest'
import { finPostgresSuite } from '../testing/suite.js'
import { makeOpsApp, writeHeaders } from './http-support.js'
import { signAttestation } from '../cutover/parity/attestation.js'
import { seedConsecutiveGreenDays } from '../cutover/parity/test-support.js'

finPostgresSuite('admin/routes-cutover-activate', {}, ({ url, pool }) => {
  it('POST /api/admin/fin/cutover/activate is platform_admin + elevated + Idempotency-Key', async () => {
    const { app: forbidden } = await makeOpsApp(url(), { role: 'agent' })
    expect((await request(forbidden)
      .post('/api/admin/fin/cutover/activate')
      .send({ attestation_id: randomUUID() })).status).toBe(403)

    const { app, elevate } = await makeOpsApp(url())
    const unelevated = await request(app)
      .post('/api/admin/fin/cutover/activate')
      .send({ attestation_id: randomUUID() })
    expect(unelevated.status).toBe(401)

    const noKey = await request(app)
      .post('/api/admin/fin/cutover/activate')
      .set({
        'X-Elevated-Token': elevate(),
        'If-Match': '"1"',
      })
      .send({ attestation_id: randomUUID() })
    expect(noKey.status).toBe(400)
    expect(noKey.body.code).toBe('IDEMPOTENCY_KEY_REQUIRED')
  })

  it('POST /api/admin/fin/cutover/deactivate is platform_admin + elevated + Idempotency-Key', async () => {
    const { app: forbidden } = await makeOpsApp(url(), { role: 'agent' })
    expect((await request(forbidden)
      .post('/api/admin/fin/cutover/deactivate')
      .send({ reason_code: 'ROLLBACK', note: 'nope' })).status).toBe(403)

    const { app, elevate } = await makeOpsApp(url())
    const unelevated = await request(app)
      .post('/api/admin/fin/cutover/deactivate')
      .send({ reason_code: 'ROLLBACK', note: 'nope' })
    expect(unelevated.status).toBe(401)

    const noKey = await request(app)
      .post('/api/admin/fin/cutover/deactivate')
      .set({
        'X-Elevated-Token': elevate(),
        'If-Match': '"1"',
      })
      .send({ reason_code: 'ROLLBACK', note: 'nope' })
    expect(noKey.status).toBe(400)
    expect(noKey.body.code).toBe('IDEMPOTENCY_KEY_REQUIRED')
  })

  it('POST activate succeeds when a fresh attestation exists', async () => {
    const now = new Date().toISOString()
    await seedConsecutiveGreenDays(pool(), { now })
    const signed = await signAttestation({
      environment: 'LIVE',
      actor: { actorType: 'USER', actorEmail: 'admin@example.test' },
      now,
    })
    const { app, elevate } = await makeOpsApp(url())
    const res = await request(app)
      .post('/api/admin/fin/cutover/activate')
      .set(writeHeaders(elevate()))
      .send({ attestation_id: signed.attestation.id, note: 'flip' })
    expect(res.status).toBe(200)
    expect(res.body.mode).toBe('FIN_ONLY')

    const ready = await request(app).get('/api/admin/fin/cutover/readiness')
    expect(ready.body.mode).toBe('FIN_ONLY')
  })
})
