/**
 * Phase 7f/1 — TOTP enrolment, sign-in second factor, and step-up elevation.
 *
 * Lives outside server.js because that file is already ~8k lines and this is a
 * self-contained security surface; it follows the same
 * `registerRoutes(app, deps)` shape the feature modules use.
 *
 * ---------------------------------------------------------------------------
 * Two flows, one challenge table
 * ---------------------------------------------------------------------------
 *
 *   SIGN-IN (purpose='signin') — password is correct but the account has a
 *   second factor. No JWT is issued yet; the client receives a challenge_id and
 *   must redeem it at /api/auth/2fa/challenge to get a session.
 *
 *   STEP-UP (purpose='stepup') — the caller already holds a valid session but
 *   is about to do something sensitive. Redeeming the challenge yields a
 *   separate short-lived elevation token (see auth.js#signElevatedToken); the
 *   session token is untouched.
 *
 * ---------------------------------------------------------------------------
 * Factor policy
 * ---------------------------------------------------------------------------
 *
 * Once TOTP is enrolled, email OTP is NOT accepted as a sign-in factor. An
 * attacker who has the password almost always has the mailbox too (that is how
 * password resets work), so leaving email as a standing fallback would reduce
 * two-factor auth to one factor wearing a hat. Backup codes are the recovery
 * path for a lost device. Users without TOTP fall back to email OTP for
 * step-up only, because they have no second factor to offer.
 */

import { createHash, randomInt, timingSafeEqual } from 'node:crypto'
import { v4 as uuidv4 } from 'uuid'
import bcrypt from 'bcryptjs'

import { insert, query, transaction } from './db.js'
import { findUserById } from './identity.js'
import { signElevatedToken, ELEVATION_TTL_SECONDS } from './auth.js'
import { encryptSecret, tryDecrypt } from './lib/credentials.js'
import { sendOtp } from './lib/otp.js'
import { generateTotpSecret, buildProvisioningUri, verifyTotp, TOTP_ISSUER } from './lib/totp.js'
import { generateBackupCodes, matchBackupCode, BACKUP_CODE_COUNT } from './lib/backup-codes.js'
import {
  validate,
  totpSetupSchema,
  totpVerifySchema,
  totpDisableSchema,
  twoFactorChallengeSchema,
  stepUpVerifySchema,
} from './lib/validation.js'
import logger from './lib/logger.js'

/**
 * Challenge lifetime. The design note said 5 minutes, but the shipped email
 * OTP copy in lib/otp.js promises 10 — and an emailed code genuinely can take
 * a couple of minutes to land. Ten minutes for both methods keeps the user-
 * facing copy honest; the TOTP code inside the window is still only valid for
 * ~90 seconds on its own.
 */
export const CHALLENGE_TTL_SECONDS = 10 * 60

/** Failed redemptions allowed before a challenge is locked permanently. */
export const MAX_CHALLENGE_ATTEMPTS = 5

function hashCode(code) {
  return createHash('sha256').update(String(code)).digest('hex')
}

function codeMatches(code, expectedHash) {
  if (!expectedHash) return false
  const actual = Buffer.from(hashCode(String(code).trim()), 'hex')
  const expected = Buffer.from(expectedHash, 'hex')
  return actual.length === expected.length && timingSafeEqual(actual, expected)
}

function generateEmailOtp() {
  return String(randomInt(100000, 1000000))
}

/**
 * Read the columns intentionally excluded from the users table-mapper. Keeping
 * the ciphertext out of the generic DAL means every read of it is explicit and
 * greppable.
 */
async function loadSecretState(userId, client = null) {
  const sql = 'SELECT totp_enabled, totp_secret_encrypted, totp_last_time_step FROM users WHERE id = $1'
  const rows = client ? (await client.query(sql, [userId])).rows : await query(sql, [userId])
  return rows[0] || null
}

/**
 * Decrypt a stored TOTP secret, tolerating failure.
 *
 * A missing or rotated CREDENTIALS_ENCRYPTION_KEY must not 500 the sign-in
 * path — backup codes are bcrypt-hashed and need no key, so an undecryptable
 * secret should degrade to "TOTP unavailable, use a backup code" rather than
 * locking the account out behind a server error.
 */
function decryptTotpSecret(secretState, userId) {
  if (!secretState?.totp_secret_encrypted) return null
  const plaintext = tryDecrypt(secretState.totp_secret_encrypted)
  if (!plaintext) {
    logger.error(
      { user_id: userId },
      'Stored TOTP secret could not be decrypted — check CREDENTIALS_ENCRYPTION_KEY. Falling back to backup codes.',
    )
  }
  return plaintext
}

async function countUnusedBackupCodes(userId) {
  const rows = await query(
    'SELECT COUNT(*)::int AS remaining FROM user_backup_codes WHERE user_id = $1 AND used_at IS NULL',
    [userId],
  )
  return rows[0]?.remaining ?? 0
}

/**
 * Create a challenge, clearing any earlier unconsumed one for the same
 * user+purpose so a user cannot accumulate parallel attempt budgets by simply
 * re-requesting.
 */
async function createChallenge({ userId, purpose, method, codeHash = null, ip = null }) {
  const record = {
    id: uuidv4(),
    user_id: userId,
    purpose,
    method,
    code_hash: codeHash,
    expires_at: new Date(Date.now() + CHALLENGE_TTL_SECONDS * 1000).toISOString(),
    consumed_at: null,
    attempts: 0,
    last_attempt_at: null,
    locked_at: null,
    created_ip: ip || null,
    created_at: new Date().toISOString(),
  }
  await query(
    'DELETE FROM auth_challenges WHERE user_id = $1 AND purpose = $2 AND consumed_at IS NULL',
    [userId, purpose],
  )
  await insert('auth_challenges', record)
  return record
}

/**
 * Decide whether a successful password check should stop short of a session.
 *
 * Called by the login handler in server.js. Returns a challenge when the user
 * has a second factor, or null when they do not (in which case login proceeds
 * exactly as it did before Phase 7f).
 */
export async function startSigninChallengeIfRequired(user, req = null) {
  if (!user?.totp_enabled) return null
  return createChallenge({
    userId: user.id,
    purpose: 'signin',
    method: 'totp',
    ip: req?.ip || null,
  })
}

/**
 * Atomically redeem a challenge.
 *
 * The whole check-and-consume runs under SELECT ... FOR UPDATE, mirroring the
 * /api/auth/verify-otp pattern: without the row lock two concurrent requests
 * could both observe `consumed_at IS NULL` and both mint a credential from a
 * single proof.
 *
 * Failed attempts are still committed — the transaction returns a result
 * object rather than throwing, so the attempt counter survives a rejection.
 *
 * @returns {Promise<{status?: number, error?: string, code?: string, userId?: string, method?: string}>}
 */
async function redeemChallenge({ challengeId, code, purpose, expectedUserId = null }) {
  return transaction(async (client) => {
    const { rows } = await client.query('SELECT * FROM auth_challenges WHERE id = $1 FOR UPDATE', [challengeId])
    const challenge = rows[0]

    if (!challenge || challenge.purpose !== purpose) {
      return { status: 401, error: 'Invalid or expired challenge' }
    }
    // A step-up challenge belongs to the session that created it. Without this
    // an attacker holding their own valid session could redeem a challenge_id
    // captured from someone else and elevate against their own account only —
    // still worth refusing loudly.
    if (expectedUserId && challenge.user_id !== expectedUserId) {
      return { status: 401, error: 'Invalid or expired challenge' }
    }
    if (challenge.consumed_at) return { status: 401, error: 'Challenge already used' }
    if (new Date(challenge.expires_at).getTime() <= Date.now()) {
      return { status: 410, error: 'Challenge has expired' }
    }
    if (challenge.locked_at || challenge.attempts >= MAX_CHALLENGE_ATTEMPTS) {
      return { status: 429, error: 'Too many failed attempts' }
    }

    const secretState = await loadSecretState(challenge.user_id, client)

    let accepted = false
    let acceptedMethod = challenge.method
    let matchedTimeStep = null
    let matchedBackupCodeId = null

    if (challenge.method === 'email') {
      accepted = codeMatches(code, challenge.code_hash)
    } else {
      // TOTP challenge: try the authenticator token first, then fall back to a
      // backup code. Both are legitimate proofs of the same factor.
      const plaintextSecret = decryptTotpSecret(secretState, challenge.user_id)

      if (plaintextSecret) {
        const result = await verifyTotp({
          secret: plaintextSecret,
          token: code,
          afterTimeStep: secretState.totp_last_time_step,
        })
        if (result.valid) {
          accepted = true
          acceptedMethod = 'totp'
          matchedTimeStep = result.timeStep
        }
      }

      if (!accepted) {
        const { rows: backupRows } = await client.query(
          'SELECT id, code_hash FROM user_backup_codes WHERE user_id = $1 AND used_at IS NULL FOR UPDATE',
          [challenge.user_id],
        )
        const matched = matchBackupCode(code, backupRows)
        if (matched) {
          accepted = true
          acceptedMethod = 'backup_code'
          matchedBackupCodeId = matched.id
        }
      }
    }

    if (!accepted) {
      const attempts = challenge.attempts + 1
      const lockedAt = attempts >= MAX_CHALLENGE_ATTEMPTS ? new Date().toISOString() : null
      await client.query(
        'UPDATE auth_challenges SET attempts = $2, last_attempt_at = CURRENT_TIMESTAMP, locked_at = $3::timestamptz, updated_at = CURRENT_TIMESTAMP WHERE id = $1',
        [challengeId, attempts, lockedAt],
      )
      return attempts >= MAX_CHALLENGE_ATTEMPTS
        ? { status: 429, error: 'Too many failed attempts' }
        : { status: 401, error: 'Invalid code', remaining_attempts: MAX_CHALLENGE_ATTEMPTS - attempts }
    }

    await client.query(
      'UPDATE auth_challenges SET consumed_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP WHERE id = $1',
      [challengeId],
    )

    // Advance the replay watermark so this exact TOTP code cannot be used
    // again inside its remaining validity window.
    if (matchedTimeStep != null) {
      await client.query(
        'UPDATE users SET totp_last_time_step = $2, updated_at = CURRENT_TIMESTAMP WHERE id = $1',
        [challenge.user_id, matchedTimeStep],
      )
    }
    if (matchedBackupCodeId) {
      await client.query(
        'UPDATE user_backup_codes SET used_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP WHERE id = $1',
        [matchedBackupCodeId],
      )
    }

    return { userId: challenge.user_id, method: acceptedMethod }
  })
}

function respondChallengeFailure(res, result) {
  const body = { error: result.error }
  if (result.remaining_attempts !== undefined) body.remaining_attempts = result.remaining_attempts
  return res.status(result.status).json(body)
}

/**
 * @param {import('express').Express} app
 * @param {object} deps
 * @param {Function} deps.authMiddleware
 * @param {Function} deps.buildAuthSession - (user, agent) => { token, agent }
 * @param {Function} deps.findAgentForUser
 * @param {Function} [deps.logActivity]
 */
export function registerTwoFactorRoutes(app, deps) {
  const { authMiddleware, buildAuthSession, findAgentForUser, logActivity = async () => {} } = deps

  // -------------------------------------------------------------------------
  // Status — backs the settings screen in 7f/2.
  // -------------------------------------------------------------------------
  app.get('/api/auth/2fa/status', authMiddleware, async (req, res) => {
    const user = await findUserById(req.user.id)
    if (!user) return res.status(401).json({ error: 'Account no longer exists' })
    res.json({
      totp_enabled: Boolean(user.totp_enabled),
      preferred_2fa: user.preferred_2fa || 'email',
      totp_enrolled_at: user.totp_enrolled_at || null,
      backup_codes_remaining: user.totp_enabled ? await countUnusedBackupCodes(user.id) : 0,
    })
  })

  // -------------------------------------------------------------------------
  // Enrolment step 1 — mint a secret. Nothing is persisted yet: an unverified
  // secret is not a credential, and storing it would let a half-finished
  // enrolment leave a live secret attached to the account.
  // -------------------------------------------------------------------------
  app.post('/api/auth/2fa/totp/setup', authMiddleware, validate(totpSetupSchema), async (req, res) => {
    const user = await findUserById(req.user.id)
    if (!user) return res.status(401).json({ error: 'Account no longer exists' })
    if (!user.password_hash || !bcrypt.compareSync(req.validated.current_password, user.password_hash)) {
      return res.status(401).json({ error: 'Current password is incorrect' })
    }
    if (user.totp_enabled) {
      return res.status(409).json({ error: 'totp_already_enabled', message: 'Disable the existing authenticator before enrolling a new one.' })
    }

    const secret = generateTotpSecret()
    res.json({
      secret,
      provisioning_uri: buildProvisioningUri({ secret, email: user.email }),
      issuer: TOTP_ISSUER,
      account: user.email,
    })
  })

  // -------------------------------------------------------------------------
  // Enrolment step 2 — prove the secret was actually scanned, then persist it
  // and issue backup codes.
  // -------------------------------------------------------------------------
  app.post('/api/auth/2fa/totp/verify', authMiddleware, validate(totpVerifySchema), async (req, res) => {
    const { secret, code } = req.validated
    const user = await findUserById(req.user.id)
    if (!user) return res.status(401).json({ error: 'Account no longer exists' })
    if (user.totp_enabled) {
      return res.status(409).json({ error: 'totp_already_enabled', message: 'Disable the existing authenticator before enrolling a new one.' })
    }

    const result = await verifyTotp({ secret, token: code })
    if (!result.valid) {
      return res.status(401).json({ error: 'Invalid code', message: 'That code did not match. Check your device clock and try the next one.' })
    }

    // Encrypt before opening the transaction: a missing
    // CREDENTIALS_ENCRYPTION_KEY must fail the request outright rather than
    // half-enrol the user.
    let ciphertext
    try {
      ciphertext = encryptSecret(secret)
    } catch (err) {
      logger.error({ err }, 'TOTP enrolment failed — credential encryption key unavailable')
      return res.status(503).json({
        error: 'credential_encryption_unavailable',
        message: 'Two-factor authentication cannot be enabled until CREDENTIALS_ENCRYPTION_KEY is configured on the server.',
      })
    }

    const { plaintext, hashes } = generateBackupCodes()
    const enrolledAt = new Date().toISOString()

    await transaction(async (client) => {
      await client.query(
        `UPDATE users
         SET totp_secret_encrypted = $2,
             totp_enabled = true,
             totp_enrolled_at = $3::timestamptz,
             totp_last_time_step = $4,
             preferred_2fa = 'totp',
             updated_at = $3::timestamptz,
             data = jsonb_set(
                      jsonb_set(COALESCE(data, '{}'::jsonb), '{totp_enabled}', 'true'::jsonb, true),
                      '{preferred_2fa}', '"totp"'::jsonb, true
                    )
         WHERE id = $1`,
        [user.id, ciphertext, enrolledAt, result.timeStep ?? null],
      )
      // Re-enrolment should never leave a previous set redeemable.
      await client.query('DELETE FROM user_backup_codes WHERE user_id = $1', [user.id])
      for (const hash of hashes) {
        await client.query(
          'INSERT INTO user_backup_codes (id, user_id, code_hash, created_at, updated_at, data) VALUES ($1, $2, $3, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, \'{}\'::jsonb)',
          [uuidv4(), user.id, hash],
        )
      }
    })

    await logActivity({ type: '2fa_totp_enabled', agent_id: user.id, meta: {} })

    res.json({
      totp_enabled: true,
      totp_enrolled_at: enrolledAt,
      // Shown to the user exactly once — there is no endpoint that can return
      // these again.
      backup_codes: plaintext,
      backup_codes_remaining: BACKUP_CODE_COUNT,
    })
  })

  // -------------------------------------------------------------------------
  // Disable. Requires a live second factor, so a hijacked-but-unelevated
  // session cannot strip the protection it is up against. 7f/3 adds
  // requireElevated on top of this.
  // -------------------------------------------------------------------------
  app.post('/api/auth/2fa/totp/disable', authMiddleware, validate(totpDisableSchema), async (req, res) => {
    const user = await findUserById(req.user.id)
    if (!user) return res.status(401).json({ error: 'Account no longer exists' })
    if (!user.totp_enabled) return res.status(409).json({ error: 'totp_not_enabled' })

    const outcome = await transaction(async (client) => {
      const secretState = await loadSecretState(user.id, client)
      const plaintextSecret = decryptTotpSecret(secretState, user.id)

      let accepted = false
      if (plaintextSecret) {
        const result = await verifyTotp({
          secret: plaintextSecret,
          token: req.validated.code,
          afterTimeStep: secretState.totp_last_time_step,
        })
        accepted = result.valid
      }
      if (!accepted) {
        const { rows: backupRows } = await client.query(
          'SELECT id, code_hash FROM user_backup_codes WHERE user_id = $1 AND used_at IS NULL FOR UPDATE',
          [user.id],
        )
        accepted = Boolean(matchBackupCode(req.validated.code, backupRows))
      }
      if (!accepted) return { status: 401, error: 'Invalid code' }

      // Bump token_version: disabling a second factor is exactly the moment to
      // evict every other outstanding session, since an attacker may hold one.
      // The caller gets a freshly signed token below so they stay signed in.
      const nextTokenVersion = Number(user.token_version ?? 0) + 1
      await client.query(
        `UPDATE users
         SET totp_secret_encrypted = NULL,
             totp_enabled = false,
             totp_enrolled_at = NULL,
             totp_last_time_step = NULL,
             preferred_2fa = 'email',
             updated_at = CURRENT_TIMESTAMP,
             data = jsonb_set(
                      jsonb_set(
                        jsonb_set(COALESCE(data, '{}'::jsonb), '{totp_enabled}', 'false'::jsonb, true),
                        '{preferred_2fa}', '"email"'::jsonb, true
                      ),
                      '{token_version}', to_jsonb($2::int), true
                    )
         WHERE id = $1`,
        [user.id, nextTokenVersion],
      )
      await client.query('DELETE FROM user_backup_codes WHERE user_id = $1', [user.id])
      await client.query(
        'DELETE FROM auth_challenges WHERE user_id = $1 AND consumed_at IS NULL',
        [user.id],
      )
      return { tokenVersion: nextTokenVersion }
    })

    if (outcome.status) return res.status(outcome.status).json({ error: outcome.error })

    await logActivity({ type: '2fa_totp_disabled', agent_id: user.id, meta: {} })

    const refreshed = await findUserById(user.id)
    const agent = await findAgentForUser(user.id)
    const session = agent ? await buildAuthSession(refreshed, agent) : null

    res.json({
      totp_enabled: false,
      // Every other session for this account was just invalidated; this keeps
      // the caller's own session alive.
      token: session?.token || null,
    })
  })

  // -------------------------------------------------------------------------
  // Sign-in second factor. Unauthenticated by design — the caller has proved
  // the password but holds no session yet.
  // -------------------------------------------------------------------------
  app.post('/api/auth/2fa/challenge', validate(twoFactorChallengeSchema), async (req, res) => {
    const result = await redeemChallenge({
      challengeId: req.validated.challenge_id,
      code: req.validated.code,
      purpose: 'signin',
    })
    if (result.status) return respondChallengeFailure(res, result)

    const user = await findUserById(result.userId)
    const agent = user ? await findAgentForUser(user.id) : null
    if (!user || !agent) return res.status(401).json({ error: 'Invalid credentials' })

    await logActivity({ type: '2fa_signin_completed', agent_id: user.id, meta: { method: result.method } })

    const session = await buildAuthSession(user, agent)
    res.json({ ...session, factor_used: result.method })
  })

  // -------------------------------------------------------------------------
  // Step-up. Issues a challenge against the CURRENT session.
  // -------------------------------------------------------------------------
  app.post('/api/auth/step-up', authMiddleware, async (req, res) => {
    const user = await findUserById(req.user.id)
    if (!user) return res.status(401).json({ error: 'Account no longer exists' })

    if (user.totp_enabled) {
      const challenge = await createChallenge({
        userId: user.id,
        purpose: 'stepup',
        method: 'totp',
        ip: req.ip,
      })
      return res.json({
        challenge_id: challenge.id,
        method: 'totp',
        expires_at: challenge.expires_at,
      })
    }

    // No authenticator enrolled — email OTP is the only factor available.
    const code = generateEmailOtp()
    const challenge = await createChallenge({
      userId: user.id,
      purpose: 'stepup',
      method: 'email',
      codeHash: hashCode(code),
      ip: req.ip,
    })
    try {
      await sendOtp({ channel: 'email', contact: user.email, code, purpose: 'stepup' })
    } catch (err) {
      logger.error({ err, code: err?.code }, 'Step-up OTP delivery failed')
      await query('DELETE FROM auth_challenges WHERE id = $1', [challenge.id])
      return res.status(503).json({
        error: err?.code || 'OTP_TRANSPORT_UNCONFIGURED',
        message: 'Could not send the verification code. Contact your administrator.',
      })
    }
    res.json({
      challenge_id: challenge.id,
      method: 'email',
      expires_at: challenge.expires_at,
    })
  })

  app.post('/api/auth/step-up/verify', authMiddleware, validate(stepUpVerifySchema), async (req, res) => {
    const result = await redeemChallenge({
      challengeId: req.validated.challenge_id,
      code: req.validated.code,
      purpose: 'stepup',
      expectedUserId: req.user.id,
    })
    if (result.status) return respondChallengeFailure(res, result)

    // Read token_version from the database rather than the caller's JWT so an
    // elevation cannot outlive a concurrent session-invalidating change.
    const user = await findUserById(result.userId)
    if (!user) return res.status(401).json({ error: 'Account no longer exists' })

    const elevatedToken = signElevatedToken({
      userId: user.id,
      tokenVersion: Number(user.token_version ?? 0),
    })

    await logActivity({ type: 'step_up_completed', agent_id: user.id, meta: { method: result.method } })

    res.json({
      elevated_token: elevatedToken,
      expires_in: ELEVATION_TTL_SECONDS,
      expires_at: new Date(Date.now() + ELEVATION_TTL_SECONDS * 1000).toISOString(),
      factor_used: result.method,
    })
  })
}

// Exported for tests.
export const __testables = { hashCode, createChallenge, redeemChallenge, countUnusedBackupCodes }
