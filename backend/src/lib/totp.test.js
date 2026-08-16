/**
 * Unit tests for the TOTP service. No database — every case is deterministic
 * given a fixed secret and epoch.
 */
import { describe, expect, it } from 'vitest'
import { generate } from 'otplib'
import {
  DRIFT_TOLERANCE_SECONDS,
  buildProvisioningUri,
  generateTotpSecret,
  verifyTotp,
} from './totp.js'

// A fixed base32 secret so token generation is reproducible across runs.
const SECRET = 'JBSWY3DPEHPK3PXPJBSWY3DPEHPK3PXP'
// Arbitrary but fixed instant, aligned to a 30-second window boundary.
const EPOCH = 1_700_000_040

async function tokenAt(epoch, secret = SECRET) {
  return generate({ strategy: 'totp', secret, epoch })
}

describe('generateTotpSecret', () => {
  it('returns a 32-character base32 secret', () => {
    const secret = generateTotpSecret()
    expect(secret).toMatch(/^[A-Z2-7]{32}$/)
  })

  it('returns a different secret on each call', () => {
    const secrets = new Set(Array.from({ length: 20 }, () => generateTotpSecret()))
    expect(secrets.size).toBe(20)
  })
})

describe('buildProvisioningUri', () => {
  it('produces an otpauth URI carrying issuer, account label and secret', () => {
    const uri = buildProvisioningUri({ secret: SECRET, email: 'agent@example.com', issuer: 'Wingcaster' })
    expect(uri.startsWith('otpauth://totp/')).toBe(true)
    expect(uri).toContain('issuer=Wingcaster')
    expect(uri).toContain(`secret=${SECRET}`)
    // The label is URI-encoded, so the raw '@' must not appear.
    expect(uri).toContain('agent%40example.com')
  })

  it('rejects a missing secret or account label', () => {
    expect(() => buildProvisioningUri({ secret: '', email: 'a@b.com' })).toThrow(/secret is required/i)
    expect(() => buildProvisioningUri({ secret: SECRET, email: '' })).toThrow(/label/i)
  })
})

describe('verifyTotp', () => {
  it('accepts the token for the current window', async () => {
    const token = await tokenAt(EPOCH)
    const result = await verifyTotp({ secret: SECRET, token, epoch: EPOCH })
    expect(result.valid).toBe(true)
    expect(result.timeStep).toBeTypeOf('number')
  })

  it('rejects a token generated from a different secret', async () => {
    const token = await tokenAt(EPOCH, 'GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ')
    const result = await verifyTotp({ secret: SECRET, token, epoch: EPOCH })
    expect(result.valid).toBe(false)
  })

  it('tolerates one window of clock drift in each direction', async () => {
    const past = await tokenAt(EPOCH - DRIFT_TOLERANCE_SECONDS)
    const future = await tokenAt(EPOCH + DRIFT_TOLERANCE_SECONDS)

    expect((await verifyTotp({ secret: SECRET, token: past, epoch: EPOCH })).valid).toBe(true)
    expect((await verifyTotp({ secret: SECRET, token: future, epoch: EPOCH })).valid).toBe(true)
  })

  it('rejects drift beyond the tolerated window', async () => {
    const tooOld = await tokenAt(EPOCH - DRIFT_TOLERANCE_SECONDS * 4)
    const tooNew = await tokenAt(EPOCH + DRIFT_TOLERANCE_SECONDS * 4)

    expect((await verifyTotp({ secret: SECRET, token: tooOld, epoch: EPOCH })).valid).toBe(false)
    expect((await verifyTotp({ secret: SECRET, token: tooNew, epoch: EPOCH })).valid).toBe(false)
  })

  it('refuses to replay a token once its time step has been recorded', async () => {
    const token = await tokenAt(EPOCH)
    const first = await verifyTotp({ secret: SECRET, token, epoch: EPOCH })
    expect(first.valid).toBe(true)

    // Same code, same window — but the watermark from the first success now
    // makes it unusable. This is what stops a shoulder-surfed code being
    // reused for the rest of its ~90-second life.
    const replay = await verifyTotp({
      secret: SECRET,
      token,
      epoch: EPOCH,
      afterTimeStep: first.timeStep,
    })
    expect(replay.valid).toBe(false)
  })

  it('refuses a replay when the watermark arrives as a string', async () => {
    // THE REGRESSION: totp_last_time_step is a BIGINT, and node-postgres hands
    // int8 back as a string to avoid precision loss. Number.isFinite does not
    // coerce, so testing the raw value skipped the guard entirely and every
    // used code stayed replayable for the rest of its window.
    const token = await tokenAt(EPOCH)
    const first = await verifyTotp({ secret: SECRET, token, epoch: EPOCH })

    const replay = await verifyTotp({
      secret: SECRET,
      token,
      epoch: EPOCH,
      afterTimeStep: String(first.timeStep),
    })
    expect(replay.valid).toBe(false)
  })

  it('ignores a null or empty watermark rather than treating it as step 0', async () => {
    const token = await tokenAt(EPOCH)
    for (const watermark of [null, undefined, '']) {
      const result = await verifyTotp({ secret: SECRET, token, epoch: EPOCH, afterTimeStep: watermark })
      expect(result.valid).toBe(true)
    }
  })

  it('still accepts the next window after a replay watermark is set', async () => {
    const token = await tokenAt(EPOCH)
    const first = await verifyTotp({ secret: SECRET, token, epoch: EPOCH })

    const nextEpoch = EPOCH + 30
    const nextToken = await tokenAt(nextEpoch)
    const result = await verifyTotp({
      secret: SECRET,
      token: nextToken,
      epoch: nextEpoch,
      afterTimeStep: first.timeStep,
    })
    expect(result.valid).toBe(true)
    expect(result.timeStep).toBeGreaterThan(first.timeStep)
  })

  it('strips spaces and dashes from user input', async () => {
    const token = await tokenAt(EPOCH)
    const spaced = `${token.slice(0, 3)} ${token.slice(3)}`
    const dashed = `${token.slice(0, 3)}-${token.slice(3)}`

    expect((await verifyTotp({ secret: SECRET, token: spaced, epoch: EPOCH })).valid).toBe(true)
    expect((await verifyTotp({ secret: SECRET, token: dashed, epoch: EPOCH })).valid).toBe(true)
  })

  it('rejects malformed submissions without throwing', async () => {
    for (const token of ['', '12345', '1234567', 'abcdef', null, undefined]) {
      const result = await verifyTotp({ secret: SECRET, token, epoch: EPOCH })
      expect(result.valid).toBe(false)
    }
  })

  it('rejects rather than throws when the stored secret is unusable', async () => {
    const token = await tokenAt(EPOCH)
    // A corrupted secret must fail the sign-in, not 500 it.
    const result = await verifyTotp({ secret: 'not-valid-base32!!!', token, epoch: EPOCH })
    expect(result.valid).toBe(false)
  })

  it('rejects when no secret is supplied', async () => {
    const token = await tokenAt(EPOCH)
    expect((await verifyTotp({ secret: null, token, epoch: EPOCH })).valid).toBe(false)
  })
})
