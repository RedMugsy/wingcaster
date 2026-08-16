/**
 * Unit tests for the step-up elevation token + requireElevated middleware.
 *
 * Pure JWT claim checking — no database. Modules are imported dynamically
 * after JWT_SECRET is stubbed because auth.js resolves the secret once at
 * import time.
 */
import express from 'express'
import request from 'supertest'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const originalSecret = process.env.JWT_SECRET

let signElevatedToken
let requireElevated
let ELEVATION_TTL_SECONDS
let jwt

beforeEach(async () => {
  process.env.JWT_SECRET = 'elevation-test-secret'
  vi.resetModules()
  const auth = await import('./auth.js')
  signElevatedToken = auth.signElevatedToken
  requireElevated = auth.requireElevated
  ELEVATION_TTL_SECONDS = auth.ELEVATION_TTL_SECONDS
  jwt = (await import('jsonwebtoken')).default
})

afterEach(() => {
  if (originalSecret === undefined) delete process.env.JWT_SECRET
  else process.env.JWT_SECRET = originalSecret
  vi.resetModules()
})

/**
 * Minimal app with a fake authMiddleware, so these tests exercise the
 * elevation check alone rather than the full session pipeline.
 */
function createApp({ user = { id: 'user-1', token_version: 0 }, options } = {}) {
  const app = express()
  app.use(express.json())
  app.use((req, _res, next) => {
    if (user) req.user = user
    next()
  })
  app.post('/sensitive', requireElevated(options), (req, res) => {
    res.json({ ok: true, elevation: req.elevation })
  })
  return app
}

describe('signElevatedToken', () => {
  it('mints a token carrying the elevated flag, user id and token version', () => {
    const token = signElevatedToken({ userId: 'user-1', tokenVersion: 3 })
    const decoded = jwt.verify(token, 'elevation-test-secret')
    expect(decoded).toMatchObject({ id: 'user-1', token_version: 3, elevated: true })
  })

  it('expires by default at the elevation TTL', () => {
    const token = signElevatedToken({ userId: 'user-1', tokenVersion: 0 })
    const decoded = jwt.verify(token, 'elevation-test-secret')
    expect(decoded.exp - decoded.iat).toBe(ELEVATION_TTL_SECONDS)
  })

  it('is not accepted as a session token by ordinary verification', async () => {
    // The elevation token deliberately lacks verified_at, so it cannot stand in
    // for a session even though both are signed with the same secret.
    const token = signElevatedToken({ userId: 'user-1', tokenVersion: 0 })
    const decoded = jwt.verify(token, 'elevation-test-secret')
    expect(decoded.verified_at).toBeUndefined()
  })
})

describe('requireElevated', () => {
  it('allows the request when a fresh elevation token is presented', async () => {
    const token = signElevatedToken({ userId: 'user-1', tokenVersion: 0 })
    const res = await request(createApp()).post('/sensitive').set('X-Elevated-Token', token)

    expect(res.status).toBe(200)
    expect(res.body.ok).toBe(true)
    expect(res.body.elevation.age_seconds).toBeLessThan(5)
  })

  it('accepts the token with a Bearer prefix', async () => {
    const token = signElevatedToken({ userId: 'user-1', tokenVersion: 0 })
    const res = await request(createApp()).post('/sensitive').set('X-Elevated-Token', `Bearer ${token}`)
    expect(res.status).toBe(200)
  })

  it('refuses with step_up_required when the header is absent', async () => {
    const res = await request(createApp()).post('/sensitive')

    expect(res.status).toBe(401)
    // The frontend keys its step-up modal off this exact code.
    expect(res.body.code).toBe('step_up_required')
    expect(res.body.max_age_seconds).toBe(ELEVATION_TTL_SECONDS)
  })

  it('refuses a garbage or unsigned token', async () => {
    const res = await request(createApp()).post('/sensitive').set('X-Elevated-Token', 'not-a-jwt')
    expect(res.status).toBe(401)
    expect(res.body.code).toBe('step_up_required')
  })

  it('refuses a token signed with a different secret', async () => {
    const forged = jwt.sign({ id: 'user-1', token_version: 0, elevated: true }, 'attacker-secret', { expiresIn: '15m' })
    const res = await request(createApp()).post('/sensitive').set('X-Elevated-Token', forged)
    expect(res.status).toBe(401)
    expect(res.body.code).toBe('step_up_required')
  })

  it('refuses an ordinary session token that lacks the elevated flag', async () => {
    // A stolen or replayed session token must not double as an elevation.
    const sessionToken = jwt.sign(
      { id: 'user-1', token_version: 0, verified_at: new Date().toISOString() },
      'elevation-test-secret',
      { expiresIn: '7d' },
    )
    const res = await request(createApp()).post('/sensitive').set('X-Elevated-Token', sessionToken)
    expect(res.status).toBe(401)
    expect(res.body.code).toBe('step_up_required')
  })

  it("refuses an elevation minted for a different account", async () => {
    const otherUsersToken = signElevatedToken({ userId: 'user-2', tokenVersion: 0 })
    const res = await request(createApp()).post('/sensitive').set('X-Elevated-Token', otherUsersToken)
    expect(res.status).toBe(401)
    expect(res.body.code).toBe('step_up_required')
  })

  it('refuses an elevation whose token_version is stale', async () => {
    // Password change / 2FA disable bump token_version; outstanding elevations
    // must die with the sessions they were minted alongside.
    const token = signElevatedToken({ userId: 'user-1', tokenVersion: 0 })
    const app = createApp({ user: { id: 'user-1', token_version: 1 } })
    const res = await request(app).post('/sensitive').set('X-Elevated-Token', token)

    expect(res.status).toBe(401)
    expect(res.body.code).toBe('step_up_required')
  })

  it('refuses once the token has aged past the route maxAgeSeconds', async () => {
    // Backdate `iat` rather than moving the system clock — fake timers would
    // also stall supertest's socket handling. The token is still within its
    // own 15-minute expiry, so this proves the middleware's age check rather
    // than jwt's exp check.
    const issuedAt = Math.floor(Date.now() / 1000) - 120
    const token = jwt.sign(
      { id: 'user-1', token_version: 0, elevated: true, iat: issuedAt },
      'elevation-test-secret',
      { expiresIn: ELEVATION_TTL_SECONDS },
    )
    const app = createApp({ options: { maxAgeSeconds: 60 } })

    const res = await request(app).post('/sensitive').set('X-Elevated-Token', token)
    expect(res.status).toBe(401)
    expect(res.body.code).toBe('step_up_required')
    expect(res.body.max_age_seconds).toBe(60)
  })

  it('still allows a token that is old but within the route maxAgeSeconds', async () => {
    const issuedAt = Math.floor(Date.now() / 1000) - 30
    const token = jwt.sign(
      { id: 'user-1', token_version: 0, elevated: true, iat: issuedAt },
      'elevation-test-secret',
      { expiresIn: ELEVATION_TTL_SECONDS },
    )
    const res = await request(createApp({ options: { maxAgeSeconds: 60 } }))
      .post('/sensitive')
      .set('X-Elevated-Token', token)

    expect(res.status).toBe(200)
    expect(res.body.elevation.age_seconds).toBeGreaterThanOrEqual(29)
  })

  it('refuses an expired token', async () => {
    const issuedAt = Math.floor(Date.now() / 1000) - 60
    const token = jwt.sign(
      { id: 'user-1', token_version: 0, elevated: true, iat: issuedAt },
      'elevation-test-secret',
      { expiresIn: 1 },
    )

    const res = await request(createApp()).post('/sensitive').set('X-Elevated-Token', token)
    expect(res.status).toBe(401)
    expect(res.body.code).toBe('step_up_required')
  })

  it('refuses when no session is attached at all', async () => {
    const token = signElevatedToken({ userId: 'user-1', tokenVersion: 0 })
    const app = createApp({ user: null })
    const res = await request(app).post('/sensitive').set('X-Elevated-Token', token)

    expect(res.status).toBe(401)
    expect(res.body.code).toBe('step_up_required')
  })
})
