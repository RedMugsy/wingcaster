/**
 * Unit tests for authMiddleware's session checks.
 *
 * Focused on the Date-vs-string trap: node-postgres hydrates `timestamptz`
 * into a JS Date, while the matching JWT claim is always an ISO string. These
 * assert the middleware compares them on equal terms — a regression here
 * rejects every authenticated request in the product.
 */
import express from 'express'
import request from 'supertest'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const identity = vi.hoisted(() => ({
  findUserById: vi.fn(),
  findAgentForUser: vi.fn(),
}))
vi.mock('./identity.js', () => identity)

const originalSecret = process.env.JWT_SECRET
const VERIFIED_AT = '2026-08-16T10:20:11.123Z'

let signToken
let authMiddleware

beforeEach(async () => {
  process.env.JWT_SECRET = 'auth-middleware-test-secret'
  vi.resetModules()
  const auth = await import('./auth.js')
  signToken = auth.signToken
  authMiddleware = auth.authMiddleware

  identity.findUserById.mockReset()
  identity.findAgentForUser.mockReset()
  identity.findAgentForUser.mockResolvedValue({ id: 'agent-1', user_id: 'user-1' })
})

afterEach(() => {
  if (originalSecret === undefined) delete process.env.JWT_SECRET
  else process.env.JWT_SECRET = originalSecret
  vi.resetModules()
})

function createApp() {
  const app = express()
  app.use(express.json())
  app.get('/protected', authMiddleware, (req, res) => res.json({ ok: true, id: req.user.id }))
  return app
}

function user(overrides = {}) {
  return {
    id: 'user-1',
    email: 'agent@example.test',
    name: 'Agent',
    role: 'agent',
    platform_role: null,
    verified: true,
    verified_at: VERIFIED_AT,
    token_version: 0,
    ...overrides,
  }
}

function token(overrides = {}) {
  return signToken({
    id: 'user-1',
    email: 'agent@example.test',
    name: 'Agent',
    token_version: 0,
    verified_at: VERIFIED_AT,
    ...overrides,
  })
}

describe('authMiddleware — verified_at claim comparison', () => {
  it('accepts a session when the stored timestamp is a Date (as pg returns it)', async () => {
    // THE REGRESSION: `timestamptz` columns hydrate to Date objects, the claim
    // is an ISO string, and `!==` between them is always true. This request
    // must still succeed.
    identity.findUserById.mockResolvedValue(user({ verified_at: new Date(VERIFIED_AT) }))

    const res = await request(createApp()).get('/protected').set('Authorization', `Bearer ${token()}`)

    expect(res.status).toBe(200)
    expect(res.body).toMatchObject({ ok: true, id: 'user-1' })
  })

  it('accepts a session when the stored timestamp is already an ISO string', async () => {
    identity.findUserById.mockResolvedValue(user())

    const res = await request(createApp()).get('/protected').set('Authorization', `Bearer ${token()}`)
    expect(res.status).toBe(200)
  })

  it('still rejects a session whose claim points at a different verification', async () => {
    // Normalising the comparison must not weaken it: re-verifying the account
    // has to invalidate tokens minted before that point.
    identity.findUserById.mockResolvedValue(user({ verified_at: new Date('2026-08-17T00:00:00.000Z') }))

    const res = await request(createApp()).get('/protected').set('Authorization', `Bearer ${token()}`)
    expect(res.status).toBe(401)
  })

  it('rejects an unverified account even with a well-formed token', async () => {
    identity.findUserById.mockResolvedValue(user({ verified: false }))

    const res = await request(createApp()).get('/protected').set('Authorization', `Bearer ${token()}`)
    expect(res.status).toBe(401)
  })

  it('rejects a token carrying no verified_at claim at all', async () => {
    identity.findUserById.mockResolvedValue(user({ verified_at: new Date(VERIFIED_AT) }))
    const bare = signToken({ id: 'user-1', token_version: 0 })

    const res = await request(createApp()).get('/protected').set('Authorization', `Bearer ${bare}`)
    expect(res.status).toBe(401)
  })

  it('rejects a stale token_version', async () => {
    identity.findUserById.mockResolvedValue(user({ verified_at: new Date(VERIFIED_AT), token_version: 3 }))

    const res = await request(createApp()).get('/protected').set('Authorization', `Bearer ${token()}`)
    expect(res.status).toBe(401)
  })

  it('rejects when the account no longer exists', async () => {
    identity.findUserById.mockResolvedValue(null)

    const res = await request(createApp()).get('/protected').set('Authorization', `Bearer ${token()}`)
    expect(res.status).toBe(401)
  })

  it('rejects when the user has no agent profile', async () => {
    identity.findUserById.mockResolvedValue(user({ verified_at: new Date(VERIFIED_AT) }))
    identity.findAgentForUser.mockResolvedValue(null)

    const res = await request(createApp()).get('/protected').set('Authorization', `Bearer ${token()}`)
    expect(res.status).toBe(401)
  })

  it('rejects a missing or malformed Authorization header', async () => {
    identity.findUserById.mockResolvedValue(user())

    expect((await request(createApp()).get('/protected')).status).toBe(401)
    expect((await request(createApp()).get('/protected').set('Authorization', 'Bearer nope')).status).toBe(401)
    expect((await request(createApp()).get('/protected').set('Authorization', 'Basic abc')).status).toBe(401)
  })
})
