import { randomUUID } from 'node:crypto'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import request from 'supertest'
import { closeDb, configure, findOne } from './db.js'
import { skipIfNoPostgres, withTestDb } from './testing/postgres.js'

const otpTransport = vi.hoisted(() => ({ sendOtp: vi.fn() }))
vi.mock('./lib/otp.js', () => otpTransport)

describe('auth bootstrap', () => {
  const originalSecret = process.env.JWT_SECRET

  beforeEach(() => {
    delete process.env.JWT_SECRET
    vi.resetModules()
  })

  afterEach(() => {
    if (originalSecret === undefined) {
      delete process.env.JWT_SECRET
    } else {
      process.env.JWT_SECRET = originalSecret
    }
    vi.resetModules()
  })

  it('uses a development fallback secret when JWT_SECRET is missing', async () => {
    const { signToken, verifyToken } = await import('./auth.js')
    const token = signToken({ id: 'agent-1' })
    const payload = verifyToken(token)

    expect(payload).toMatchObject({ id: 'agent-1' })
  })
})

skipIfNoPostgres()('registration verification boundary', () => {
  it('prevents registration takeover and enforces the OTP lifecycle', async () => {
    await withTestDb(async (databaseUrl) => {
      configure({ databaseUrl, force: true })
      otpTransport.sendOtp.mockReset()
      otpTransport.sendOtp.mockResolvedValue({ delivered: true, simulated: false })
      process.env.ADMIN_EMAIL = 'target-admin@example.test'
      process.env.SMOKE_ADMIN_EMAIL = 'seeded-admin@example.test'

      try {
        // Importing the server runs seedData() → ensureMigrations() →
        // ensureSeedAdmins(), so ADMIN_EMAIL already exists as a platform
        // admin by the time the first request is made.
        const { app } = await import('./server.js')

      // Registration must not be able to claim an existing platform admin's
      // address — that would be the takeover this test is named for.
      const takeover = await request(app).post('/api/auth/register').send({
        name: 'Takeover Attempt',
        email: process.env.ADMIN_EMAIL,
        password: 'secret123',
        otp_verified: true,
      })
      expect(takeover.status).toBe(409)

      // An ordinary registration must not be able to grant itself
      // platform_role or mark itself verified.
      const attackerEmail = `takeover-${randomUUID()}@example.test`
      const registration = await request(app).post('/api/auth/register').send({
        name: 'Takeover Attempt',
        email: attackerEmail,
        password: 'secret123',
        otp_verified: true,
      })

      expect(registration.status).toBe(202)
      expect(registration.body).toMatchObject({ status: 'otp_sent' })
      expect(registration.body.token).toBeUndefined()
      const registeredUser = await findOne('users', (user) => user.email === attackerEmail)
      expect(registeredUser).toMatchObject({ verified: false, platform_role: null })

      const unverifiedLogin = await request(app).post('/api/auth/login').send({
        email: attackerEmail,
        password: 'secret123',
      })
      expect(unverifiedLogin.status).toBe(401)
      expect(unverifiedLogin.body).toEqual({ error: 'email_not_verified', otp_id: registration.body.otp_id })

      // The most recent send is the one belonging to registration.body.otp_id.
      const firstCode = otpTransport.sendOtp.mock.calls.at(-1)[0].code
      const wrongOtp = await request(app).post('/api/auth/verify-otp').send({
        otp_id: registration.body.otp_id,
        code: '000000',
      })
      expect(wrongOtp.status).toBe(401)

      const verified = await request(app).post('/api/auth/verify-otp').send({
        otp_id: registration.body.otp_id,
        code: firstCode,
      })
      expect(verified.status).toBe(200)
      const { verifyToken } = await import('./auth.js')
      expect(verifyToken(verified.body.token).verified_at).toBeTruthy()
      expect(await findOne('users', (user) => user.id === registeredUser.id)).toMatchObject({ verified: true })

      const lockedRegistration = await request(app).post('/api/auth/register').send({
        name: 'Locked User',
        email: 'locked@example.test',
        password: 'secret123',
      })
      for (let attempt = 1; attempt <= 5; attempt += 1) {
        const response = await request(app).post('/api/auth/verify-otp').send({
          otp_id: lockedRegistration.body.otp_id,
          code: '000000',
        })
        expect(response.status).toBe(attempt === 5 ? 429 : 401)
      }

      const { ensureSeedAdmins } = await import('./seed.js')
      await ensureSeedAdmins()
      const seededUser = await findOne('users', (user) => user.email === process.env.SMOKE_ADMIN_EMAIL)
        const seededAgent = await findOne('agents', (agent) => agent.user_id === seededUser.id)
        expect(seededUser).toMatchObject({ platform_role: 'platform_admin', verified: true })
        expect(seededAgent).toMatchObject({ platform_role: 'platform_admin', verified: true })
      } finally {
        await closeDb()
        delete process.env.ADMIN_EMAIL
        delete process.env.SMOKE_ADMIN_EMAIL
      }
    })
  }, 180_000)
})
