/**
 * TOTP (RFC 6238) service for authenticator-app second factors.
 *
 * Thin, deterministic wrapper over `otplib` v13. Everything here is pure with
 * respect to the database — persistence and challenge bookkeeping live in
 * auth-2fa.js. That split is what makes this module unit-testable without a
 * Postgres connection.
 *
 * Compatibility: defaults are SHA-1 / 6 digits / 30-second period, which is
 * what Google Authenticator, Authy, 1Password and Microsoft Authenticator all
 * assume. Do not "modernise" these to SHA-256 — several popular authenticator
 * apps silently ignore the algorithm parameter in the provisioning URI and
 * would produce codes that never verify.
 */

import { generateSecret, generateURI, verify } from 'otplib'

/** Seconds of clock drift tolerated in each direction (±1 30s window). */
export const DRIFT_TOLERANCE_SECONDS = 30

/** Issuer shown in the authenticator app's account list. */
export const TOTP_ISSUER = process.env.TOTP_ISSUER || 'Wingcaster'

/**
 * Generate a fresh base32 secret. 20 random bytes → 32 base32 characters,
 * which is the RFC 4226 recommended key length.
 */
export function generateTotpSecret() {
  return generateSecret({ length: 20 })
}

/**
 * Build the `otpauth://` provisioning URI the authenticator app consumes.
 *
 * The QR code is rendered client-side from this string (see 7f/2) rather than
 * server-side as a PNG — it keeps image encoding out of the auth path and the
 * secret out of any intermediate image buffer.
 *
 * @param {object} args
 * @param {string} args.secret - base32 secret
 * @param {string} args.email  - used as the account label in the app
 * @param {string} [args.issuer]
 */
export function buildProvisioningUri({ secret, email, issuer = TOTP_ISSUER }) {
  if (!secret) throw new Error('TOTP secret is required')
  if (!email) throw new Error('TOTP account label (email) is required')
  return generateURI({ strategy: 'totp', issuer, label: email, secret })
}

/**
 * Verify a submitted 6-digit token against a secret.
 *
 * Replay protection: pass the time step recorded by the previous successful
 * verification as `afterTimeStep`. otplib then rejects any token whose step is
 * <= that value, so a code observed over someone's shoulder cannot be reused
 * for the remainder of its window. Callers MUST persist the returned
 * `timeStep` on success for this to do anything.
 *
 * @param {object} args
 * @param {string} args.secret - base32 secret (already decrypted)
 * @param {string} args.token  - user-submitted code
 * @param {number|null} [args.afterTimeStep] - last accepted step for this user
 * @param {number} [args.epoch] - unix seconds; injectable for deterministic tests
 * @returns {Promise<{valid: boolean, timeStep?: number, delta?: number}>}
 */
export async function verifyTotp({ secret, token, afterTimeStep = null, epoch }) {
  if (!secret || !token) return { valid: false }

  // otplib expects digits only; anything else is a malformed submission rather
  // than a wrong code, but both surface to the caller identically so the
  // response cannot be used to probe which secrets exist.
  const normalized = String(token).replace(/[\s-]/g, '')
  if (!/^\d{6}$/.test(normalized)) return { valid: false }

  const options = {
    strategy: 'totp',
    secret,
    token: normalized,
    epochTolerance: DRIFT_TOLERANCE_SECONDS,
  }
  // `totp_last_time_step` is a BIGINT, and node-postgres hands int8 back as a
  // STRING to avoid precision loss. Number.isFinite does not coerce, so
  // testing the raw value silently skipped the replay guard entirely and every
  // used code stayed replayable for the rest of its window. Coerce first.
  const lastStep = Number(afterTimeStep)
  if (afterTimeStep !== null && afterTimeStep !== undefined && afterTimeStep !== '' && Number.isFinite(lastStep)) {
    options.afterTimeStep = lastStep
  }
  const at = Number(epoch)
  if (epoch !== null && epoch !== undefined && epoch !== '' && Number.isFinite(at)) {
    options.epoch = at
  }

  let result
  try {
    result = await verify(options)
  } catch {
    // A malformed/undecodable secret must not 500 the sign-in path.
    return { valid: false }
  }

  if (!result?.valid) return { valid: false }
  return { valid: true, timeStep: result.timeStep, delta: result.delta }
}
