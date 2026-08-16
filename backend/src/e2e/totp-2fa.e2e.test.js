/**
 * E2E: Phase 7f/1 — TOTP enrolment, sign-in second factor, step-up elevation.
 *
 * Runs against real Postgres so the atomic challenge redemption, the replay
 * watermark and the backup-code single-use guarantee are exercised through
 * actual row locks rather than mocks.
 *
 * Rate limiting and the credential key are configured before server.js is
 * imported: both are read at module-evaluation time.
 */
import { randomUUID } from 'node:crypto'
import { randomBytes } from 'node:crypto'
import express from 'express'
import request from 'supertest'
import { generate } from 'otplib'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { closeDb, configure, query } from '../db.js'
import { skipIfNoPostgres, withTestDb } from '../testing/postgres.js'

const otpTransport = vi.hoisted(() => ({
  sendOtp: vi.fn(),
  otpChannelsConfigured: vi.fn(() => ({ email: true, gmail: true, whatsapp: false, facebook: false })),
}))
vi.mock('../lib/otp.js', () => otpTransport)

const PASSWORD = 'correct horse battery staple'

/**
 * A code from the NEXT time window. Enrolment stamps the replay watermark with
 * the step it consumed, so the very next verification must come from a later
 * window — which is exactly what a real authenticator shows once its 30-second
 * tick rolls over.
 */
async function totpToken(secret, offsetSeconds = 30) {
  return generate({
    strategy: 'totp',
    secret,
    epoch: Math.floor(Date.now() / 1000) + offsetSeconds,
  })
}

async function createVerifiedUser(app, email) {
  const registration = await request(app).post('/api/auth/register').send({
    name: 'TOTP Tester',
    email,
    password: PASSWORD,
  })
  expect(registration.status).toBe(202)

  const code = otpTransport.sendOtp.mock.calls.at(-1)[0].code
  const verified = await request(app).post('/api/auth/verify-otp').send({
    otp_id: registration.body.otp_id,
    code,
  })
  expect(verified.status).toBe(200)
  return { token: verified.body.token, agentId: verified.body.agent?.id }
}

async function enrolTotp(app, token) {
  const setup = await request(app)
    .post('/api/auth/2fa/totp/setup')
    .set('Authorization', `Bearer ${token}`)
    .send({ current_password: PASSWORD })
  expect(setup.status).toBe(200)

  const verify = await request(app)
    .post('/api/auth/2fa/totp/verify')
    .set('Authorization', `Bearer ${token}`)
    .send({ secret: setup.body.secret, code: await totpToken(setup.body.secret, 0) })
  expect(verify.status).toBe(200)

  return { secret: setup.body.secret, backupCodes: verify.body.backup_codes, setup: setup.body }
}

async function withApp(fn) {
  await withTestDb(async (databaseUrl) => {
    configure({ databaseUrl, force: true })
    try {
      const { app } = await import('../server.js')
      await fn(app)
    } finally {
      await closeDb()
    }
  })
}

skipIfNoPostgres()('E2E: TOTP + step-up authentication', () => {
  beforeEach(() => {
    // The suite makes far more than the 100-request dev default against
    // /api/auth; without this the limiter, not the code under test, decides
    // the results.
    process.env.RATE_LIMIT_AUTH_MAX = '100000'
    process.env.CREDENTIALS_ENCRYPTION_KEY = randomBytes(32).toString('base64')
    process.env.JWT_SECRET = 'totp-e2e-secret'
    otpTransport.sendOtp.mockReset()
    otpTransport.sendOtp.mockResolvedValue({ delivered: true, channel: 'email', provider: 'test' })
    vi.resetModules()
  })

  it('enrols TOTP, stores the secret encrypted, and issues single-use backup codes', async () => {
    await withApp(async (app) => {
      const email = `totp-enrol-${randomUUID()}@example.test`
      const { token } = await createVerifiedUser(app, email)

      const setup = await request(app)
        .post('/api/auth/2fa/totp/setup')
        .set('Authorization', `Bearer ${token}`)
        .send({ current_password: PASSWORD })

      expect(setup.status).toBe(200)
      expect(setup.body.secret).toMatch(/^[A-Z2-7]{32}$/)
      expect(setup.body.provisioning_uri).toContain('otpauth://totp/')
      expect(setup.body.provisioning_uri).toContain(setup.body.secret)

      // Nothing is persisted until the user proves they scanned it.
      const beforeVerify = await query('SELECT totp_enabled, totp_secret_encrypted FROM users WHERE email = $1', [email])
      expect(beforeVerify[0].totp_enabled).toBe(false)
      expect(beforeVerify[0].totp_secret_encrypted).toBeNull()

      const verify = await request(app)
        .post('/api/auth/2fa/totp/verify')
        .set('Authorization', `Bearer ${token}`)
        .send({ secret: setup.body.secret, code: await totpToken(setup.body.secret, 0) })

      expect(verify.status).toBe(200)
      expect(verify.body.totp_enabled).toBe(true)
      expect(verify.body.backup_codes).toHaveLength(10)
      expect(verify.body.backup_codes_remaining).toBe(10)

      const after = await query('SELECT totp_enabled, totp_secret_encrypted, preferred_2fa FROM users WHERE email = $1', [email])
      expect(after[0].totp_enabled).toBe(true)
      expect(after[0].preferred_2fa).toBe('totp')
      // Stored as AES-GCM ciphertext, never the raw base32 secret.
      expect(after[0].totp_secret_encrypted).toMatch(/^v1:/)
      expect(after[0].totp_secret_encrypted).not.toContain(setup.body.secret)

      // Only hashes are persisted for the backup codes.
      const codes = await query('SELECT code_hash FROM user_backup_codes WHERE user_id = (SELECT id FROM users WHERE email = $1)', [email])
      expect(codes).toHaveLength(10)
      for (const row of codes) {
        expect(row.code_hash.startsWith('$2')).toBe(true)
        expect(verify.body.backup_codes.join('')).not.toContain(row.code_hash)
      }
    })
  }, 180_000)

  it('rejects enrolment without the current password and refuses a wrong code', async () => {
    await withApp(async (app) => {
      const email = `totp-guard-${randomUUID()}@example.test`
      const { token } = await createVerifiedUser(app, email)

      const wrongPassword = await request(app)
        .post('/api/auth/2fa/totp/setup')
        .set('Authorization', `Bearer ${token}`)
        .send({ current_password: 'not the password' })
      expect(wrongPassword.status).toBe(401)

      const unauthenticated = await request(app)
        .post('/api/auth/2fa/totp/setup')
        .send({ current_password: PASSWORD })
      expect(unauthenticated.status).toBe(401)

      const setup = await request(app)
        .post('/api/auth/2fa/totp/setup')
        .set('Authorization', `Bearer ${token}`)
        .send({ current_password: PASSWORD })

      const badCode = await request(app)
        .post('/api/auth/2fa/totp/verify')
        .set('Authorization', `Bearer ${token}`)
        .send({ secret: setup.body.secret, code: '000000' })
      expect(badCode.status).toBe(401)

      const stillDisabled = await query('SELECT totp_enabled FROM users WHERE email = $1', [email])
      expect(stillDisabled[0].totp_enabled).toBe(false)
    })
  }, 180_000)

  it('turns login into a 2FA challenge and issues a session only after the code', async () => {
    await withApp(async (app) => {
      const email = `totp-login-${randomUUID()}@example.test`
      const { token } = await createVerifiedUser(app, email)
      const { secret } = await enrolTotp(app, token)

      const login = await request(app).post('/api/auth/login').send({ email, password: PASSWORD })
      expect(login.status).toBe(200)
      expect(login.body).toMatchObject({ status: '2fa_required', method: 'totp' })
      // Critically: no session yet.
      expect(login.body.token).toBeUndefined()
      expect(login.body.agent).toBeUndefined()

      const challenge = await request(app).post('/api/auth/2fa/challenge').send({
        challenge_id: login.body.challenge_id,
        code: await totpToken(secret),
      })

      expect(challenge.status).toBe(200)
      expect(challenge.body.token).toBeTruthy()
      expect(challenge.body.factor_used).toBe('totp')
      // Same response shape as a non-2FA login.
      expect(challenge.body.agent).toMatchObject({ personal_tenant_id: expect.any(String) })

      const me = await request(app).get('/api/auth/me').set('Authorization', `Bearer ${challenge.body.token}`)
      expect(me.status).toBe(200)
    })
  }, 180_000)

  it('still signs in normally for accounts without TOTP', async () => {
    await withApp(async (app) => {
      const email = `totp-absent-${randomUUID()}@example.test`
      await createVerifiedUser(app, email)

      const login = await request(app).post('/api/auth/login').send({ email, password: PASSWORD })
      expect(login.status).toBe(200)
      expect(login.body.status).toBeUndefined()
      expect(login.body.token).toBeTruthy()
    })
  }, 180_000)

  it('refuses to reuse a consumed challenge or replay the same TOTP code', async () => {
    await withApp(async (app) => {
      const email = `totp-replay-${randomUUID()}@example.test`
      const { token } = await createVerifiedUser(app, email)
      const { secret } = await enrolTotp(app, token)

      const login = await request(app).post('/api/auth/login').send({ email, password: PASSWORD })
      const code = await totpToken(secret)

      const first = await request(app).post('/api/auth/2fa/challenge').send({
        challenge_id: login.body.challenge_id,
        code,
      })
      expect(first.status).toBe(200)

      // The challenge itself is single-use.
      const reuse = await request(app).post('/api/auth/2fa/challenge').send({
        challenge_id: login.body.challenge_id,
        code,
      })
      expect(reuse.status).toBe(401)
      expect(reuse.body.error).toMatch(/already used/i)

      // And the code cannot be replayed against a brand-new challenge either,
      // which is what stops a shoulder-surfed code being usable for the rest
      // of its window.
      const secondLogin = await request(app).post('/api/auth/login').send({ email, password: PASSWORD })
      const replay = await request(app).post('/api/auth/2fa/challenge').send({
        challenge_id: secondLogin.body.challenge_id,
        code,
      })
      expect(replay.status).toBe(401)
    })
  }, 180_000)

  it('locks a challenge after five failed attempts', async () => {
    await withApp(async (app) => {
      const email = `totp-lockout-${randomUUID()}@example.test`
      const { token } = await createVerifiedUser(app, email)
      const { secret } = await enrolTotp(app, token)

      const login = await request(app).post('/api/auth/login').send({ email, password: PASSWORD })

      for (let attempt = 1; attempt <= 5; attempt += 1) {
        const res = await request(app).post('/api/auth/2fa/challenge').send({
          challenge_id: login.body.challenge_id,
          code: '000000',
        })
        expect(res.status).toBe(attempt === 5 ? 429 : 401)
        if (attempt < 5) expect(res.body.remaining_attempts).toBe(5 - attempt)
      }

      // A correct code no longer helps once the challenge is locked.
      const correct = await request(app).post('/api/auth/2fa/challenge').send({
        challenge_id: login.body.challenge_id,
        code: await totpToken(secret),
      })
      expect(correct.status).toBe(429)
    })
  }, 180_000)

  it('accepts a backup code once and only once', async () => {
    await withApp(async (app) => {
      const email = `totp-backup-${randomUUID()}@example.test`
      const { token } = await createVerifiedUser(app, email)
      const { backupCodes } = await enrolTotp(app, token)

      const login = await request(app).post('/api/auth/login').send({ email, password: PASSWORD })
      const redeemed = await request(app).post('/api/auth/2fa/challenge').send({
        challenge_id: login.body.challenge_id,
        code: backupCodes[0],
      })

      expect(redeemed.status).toBe(200)
      expect(redeemed.body.factor_used).toBe('backup_code')
      expect(redeemed.body.token).toBeTruthy()

      const remaining = await query(
        'SELECT COUNT(*)::int AS n FROM user_backup_codes WHERE user_id = (SELECT id FROM users WHERE email = $1) AND used_at IS NULL',
        [email],
      )
      expect(remaining[0].n).toBe(9)

      // The same code must not work a second time.
      const secondLogin = await request(app).post('/api/auth/login').send({ email, password: PASSWORD })
      const reuse = await request(app).post('/api/auth/2fa/challenge').send({
        challenge_id: secondLogin.body.challenge_id,
        code: backupCodes[0],
      })
      expect(reuse.status).toBe(401)

      // A different, unused code still works.
      const thirdLogin = await request(app).post('/api/auth/login').send({ email, password: PASSWORD })
      const other = await request(app).post('/api/auth/2fa/challenge').send({
        challenge_id: thirdLogin.body.challenge_id,
        code: backupCodes[1],
      })
      expect(other.status).toBe(200)
    })
  }, 180_000)

  it('does not offer email as a sign-in factor once TOTP is enrolled', async () => {
    await withApp(async (app) => {
      const email = `totp-noemail-${randomUUID()}@example.test`
      const { token } = await createVerifiedUser(app, email)
      await enrolTotp(app, token)

      otpTransport.sendOtp.mockClear()
      const login = await request(app).post('/api/auth/login').send({ email, password: PASSWORD })

      expect(login.body.method).toBe('totp')
      // No fallback code is sent — an attacker with the password and the
      // mailbox must not be able to complete sign-in.
      expect(otpTransport.sendOtp).not.toHaveBeenCalled()

      const challenges = await query(
        "SELECT method, code_hash FROM auth_challenges WHERE id = $1",
        [login.body.challenge_id],
      )
      expect(challenges[0].method).toBe('totp')
      expect(challenges[0].code_hash).toBeNull()
    })
  }, 180_000)

  it('issues an elevation token via step-up that satisfies requireElevated', async () => {
    await withApp(async (app) => {
      const email = `totp-stepup-${randomUUID()}@example.test`
      const { token } = await createVerifiedUser(app, email)
      const { secret } = await enrolTotp(app, token)

      const stepUp = await request(app)
        .post('/api/auth/step-up')
        .set('Authorization', `Bearer ${token}`)
        .send({})

      expect(stepUp.status).toBe(200)
      expect(stepUp.body.method).toBe('totp')
      expect(stepUp.body.challenge_id).toBeTruthy()

      const verified = await request(app)
        .post('/api/auth/step-up/verify')
        .set('Authorization', `Bearer ${token}`)
        .send({ challenge_id: stepUp.body.challenge_id, code: await totpToken(secret) })

      expect(verified.status).toBe(200)
      expect(verified.body.elevated_token).toBeTruthy()
      expect(verified.body.expires_in).toBe(15 * 60)

      // The session token is deliberately untouched by step-up.
      const me = await request(app).get('/api/auth/me').set('Authorization', `Bearer ${token}`)
      expect(me.status).toBe(200)

      // Run the real session + real elevation through the real middleware.
      const { authMiddleware, requireElevated } = await import('../auth.js')
      const gated = express()
      gated.use(express.json())
      gated.post('/gated', authMiddleware, requireElevated(), (req, res) => res.json({ ok: true }))

      const withoutElevation = await request(gated).post('/gated').set('Authorization', `Bearer ${token}`)
      expect(withoutElevation.status).toBe(401)
      expect(withoutElevation.body.code).toBe('step_up_required')

      const withElevation = await request(gated)
        .post('/gated')
        .set('Authorization', `Bearer ${token}`)
        .set('X-Elevated-Token', verified.body.elevated_token)
      expect(withElevation.status).toBe(200)
      expect(withElevation.body.ok).toBe(true)
    })
  }, 180_000)

  it('falls back to an emailed code for step-up when no authenticator is enrolled', async () => {
    await withApp(async (app) => {
      const email = `totp-stepup-email-${randomUUID()}@example.test`
      const { token } = await createVerifiedUser(app, email)

      otpTransport.sendOtp.mockClear()
      const stepUp = await request(app)
        .post('/api/auth/step-up')
        .set('Authorization', `Bearer ${token}`)
        .send({})

      expect(stepUp.status).toBe(200)
      expect(stepUp.body.method).toBe('email')
      expect(otpTransport.sendOtp).toHaveBeenCalledTimes(1)
      expect(otpTransport.sendOtp.mock.calls[0][0].purpose).toBe('stepup')

      const emailedCode = otpTransport.sendOtp.mock.calls[0][0].code
      const verified = await request(app)
        .post('/api/auth/step-up/verify')
        .set('Authorization', `Bearer ${token}`)
        .send({ challenge_id: stepUp.body.challenge_id, code: emailedCode })

      expect(verified.status).toBe(200)
      expect(verified.body.factor_used).toBe('email')
      expect(verified.body.elevated_token).toBeTruthy()
    })
  }, 180_000)

  it("refuses a step-up challenge redeemed by a different account's session", async () => {
    await withApp(async (app) => {
      const victimEmail = `totp-victim-${randomUUID()}@example.test`
      const attackerEmail = `totp-attacker-${randomUUID()}@example.test`
      const victim = await createVerifiedUser(app, victimEmail)
      const attacker = await createVerifiedUser(app, attackerEmail)

      const stepUp = await request(app)
        .post('/api/auth/step-up')
        .set('Authorization', `Bearer ${victim.token}`)
        .send({})
      const victimCode = otpTransport.sendOtp.mock.calls.at(-1)[0].code

      // Attacker holds a valid session of their own plus the victim's
      // challenge id and code. The user binding on the challenge must refuse.
      const stolen = await request(app)
        .post('/api/auth/step-up/verify')
        .set('Authorization', `Bearer ${attacker.token}`)
        .send({ challenge_id: stepUp.body.challenge_id, code: victimCode })

      expect(stolen.status).toBe(401)
      expect(stolen.body.elevated_token).toBeUndefined()
    })
  }, 180_000)

  it('disables TOTP with a valid factor, evicting other sessions and clearing backup codes', async () => {
    await withApp(async (app) => {
      const email = `totp-disable-${randomUUID()}@example.test`
      const { token } = await createVerifiedUser(app, email)
      const { secret } = await enrolTotp(app, token)

      const wrongCode = await request(app)
        .post('/api/auth/2fa/totp/disable')
        .set('Authorization', `Bearer ${token}`)
        .send({ code: '000000' })
      expect(wrongCode.status).toBe(401)

      const stillEnabled = await query('SELECT totp_enabled FROM users WHERE email = $1', [email])
      expect(stillEnabled[0].totp_enabled).toBe(true)

      const disabled = await request(app)
        .post('/api/auth/2fa/totp/disable')
        .set('Authorization', `Bearer ${token}`)
        .send({ code: await totpToken(secret) })

      expect(disabled.status).toBe(200)
      expect(disabled.body.totp_enabled).toBe(false)
      expect(disabled.body.token).toBeTruthy()

      const cleared = await query(
        'SELECT totp_enabled, totp_secret_encrypted, preferred_2fa FROM users WHERE email = $1',
        [email],
      )
      expect(cleared[0].totp_enabled).toBe(false)
      expect(cleared[0].totp_secret_encrypted).toBeNull()
      expect(cleared[0].preferred_2fa).toBe('email')

      const codes = await query(
        'SELECT COUNT(*)::int AS n FROM user_backup_codes WHERE user_id = (SELECT id FROM users WHERE email = $1)',
        [email],
      )
      expect(codes[0].n).toBe(0)

      // token_version was bumped, so the session that requested the disable is
      // dead and every other outstanding session with it.
      const oldSession = await request(app).get('/api/auth/me').set('Authorization', `Bearer ${token}`)
      expect(oldSession.status).toBe(401)

      // The freshly issued token keeps the caller signed in.
      const newSession = await request(app).get('/api/auth/me').set('Authorization', `Bearer ${disabled.body.token}`)
      expect(newSession.status).toBe(200)

      // And login is back to single-factor.
      const login = await request(app).post('/api/auth/login').send({ email, password: PASSWORD })
      expect(login.body.status).toBeUndefined()
      expect(login.body.token).toBeTruthy()
    })
  }, 180_000)

  it('reports enrolment state and remaining backup codes', async () => {
    await withApp(async (app) => {
      const email = `totp-status-${randomUUID()}@example.test`
      const { token } = await createVerifiedUser(app, email)

      const before = await request(app).get('/api/auth/2fa/status').set('Authorization', `Bearer ${token}`)
      expect(before.status).toBe(200)
      expect(before.body).toMatchObject({ totp_enabled: false, preferred_2fa: 'email', backup_codes_remaining: 0 })

      const { backupCodes } = await enrolTotp(app, token)

      const after = await request(app).get('/api/auth/2fa/status').set('Authorization', `Bearer ${token}`)
      expect(after.body).toMatchObject({ totp_enabled: true, preferred_2fa: 'totp', backup_codes_remaining: 10 })
      expect(after.body.totp_enrolled_at).toBeTruthy()

      const login = await request(app).post('/api/auth/login').send({ email, password: PASSWORD })
      await request(app).post('/api/auth/2fa/challenge').send({
        challenge_id: login.body.challenge_id,
        code: backupCodes[0],
      })

      const spent = await request(app).get('/api/auth/2fa/status').set('Authorization', `Bearer ${token}`)
      expect(spent.body.backup_codes_remaining).toBe(9)
    })
  }, 180_000)

  it('never exposes the encrypted secret through the DAL or an API response', async () => {
    await withApp(async (app) => {
      const email = `totp-leak-${randomUUID()}@example.test`
      const { token } = await createVerifiedUser(app, email)
      await enrolTotp(app, token)

      // The users table-mapper deliberately omits the ciphertext column, so a
      // generic read must not carry it.
      const { findOne } = await import('../db.js')
      const user = await findOne('users', (u) => u.email === email)
      expect(user).toBeTruthy()
      expect(user.totp_secret_encrypted).toBeUndefined()
      expect(user.totp_enabled).toBe(true)

      const me = await request(app).get('/api/auth/me').set('Authorization', `Bearer ${token}`)
      expect(JSON.stringify(me.body)).not.toContain('totp_secret')

      const status = await request(app).get('/api/auth/2fa/status').set('Authorization', `Bearer ${token}`)
      expect(JSON.stringify(status.body)).not.toContain('secret')
    })
  }, 180_000)
})
