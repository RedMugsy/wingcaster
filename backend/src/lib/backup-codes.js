/**
 * Single-use backup codes — the recovery path when the authenticator device
 * is lost.
 *
 * Because Phase 7f deliberately removes email as a sign-in fallback once TOTP
 * is enrolled (an attacker holding the password plus the mailbox would
 * otherwise defeat the second factor entirely), these codes are the ONLY way
 * back into an account whose phone is gone. They are correspondingly
 * security-critical:
 *
 *   * ~50 bits of entropy each, from a crypto RNG.
 *   * Only bcrypt hashes are persisted; plaintext is returned exactly once at
 *     enrolment and is unrecoverable afterwards.
 *   * Redemption is single-use — the row is stamped `used_at` inside the same
 *     transaction that consumes the challenge.
 *
 * There is intentionally no plaintext lookup key stored alongside the hash.
 * Indexing on a prefix of the code would make redemption a single bcrypt
 * compare instead of a scan, but it would also leak that prefix at rest, and
 * a partial code is a meaningful head start for anyone holding a database
 * dump. The scan is bounded at ten compares and sits behind a challenge that
 * already required the correct password, so the cost is not attacker-
 * controllable in any useful way.
 */

import { randomInt } from 'node:crypto'
import bcrypt from 'bcryptjs'

/**
 * Crockford-style alphabet with the ambiguous glyphs removed (no 0/O, 1/I/L,
 * U). These codes get written down on paper and typed back in months later —
 * transcription errors are a realistic lockout cause.
 */
const ALPHABET = '23456789ABCDEFGHJKMNPQRSTVWXYZ'

/** Characters per code. 10 chars over a 30-symbol alphabet ≈ 49 bits. */
const CODE_LENGTH = 10

/** How many codes a user receives at enrolment. */
export const BACKUP_CODE_COUNT = 10

/**
 * bcrypt cost. Lower than the cost 10 used for passwords, and deliberately so:
 * stretching exists to compensate for low-entropy human secrets, and these are
 * high-entropy random strings where it buys nothing. Cost 8 keeps a ten-code
 * redemption scan well under ~150ms.
 */
const BCRYPT_ROUNDS = 8

/** Format a raw code for display: `ABCDE-FGHJK`. */
export function formatBackupCode(raw) {
  const mid = Math.ceil(raw.length / 2)
  return `${raw.slice(0, mid)}-${raw.slice(mid)}`
}

/**
 * Strip formatting and case so `abcde-fghjk`, `ABCDE FGHJK` and `ABCDEFGHJK`
 * all redeem identically.
 */
export function normalizeBackupCode(code) {
  return String(code || '').toUpperCase().replace(/[^A-Z0-9]/g, '')
}

function generateRawCode() {
  let out = ''
  for (let i = 0; i < CODE_LENGTH; i += 1) {
    out += ALPHABET[randomInt(0, ALPHABET.length)]
  }
  return out
}

/**
 * Mint a fresh set of backup codes.
 *
 * @returns {{plaintext: string[], hashes: string[]}} `plaintext` is display
 *   formatted and must be surfaced to the user exactly once; `hashes` is
 *   positionally aligned and is what gets persisted.
 */
export function generateBackupCodes(count = BACKUP_CODE_COUNT) {
  const raw = []
  const seen = new Set()
  while (raw.length < count) {
    const candidate = generateRawCode()
    // Duplicates are astronomically unlikely but would silently hand the user
    // a set with fewer distinct codes than advertised.
    if (seen.has(candidate)) continue
    seen.add(candidate)
    raw.push(candidate)
  }
  return {
    plaintext: raw.map(formatBackupCode),
    hashes: raw.map((code) => bcrypt.hashSync(code, BCRYPT_ROUNDS)),
  }
}

/**
 * Find which of a user's unused codes a submission matches.
 *
 * Every candidate is compared even after a match is found. Early-exiting would
 * make response time correlate with the matched code's position in the set,
 * which leaks how many codes the user has already spent.
 *
 * @param {string} submitted - raw user input, any formatting
 * @param {Array<{id: string, code_hash: string}>} candidates - unused codes only
 * @returns {{id: string}|null} the matching row, or null
 */
export function matchBackupCode(submitted, candidates) {
  const normalized = normalizeBackupCode(submitted)
  if (normalized.length !== CODE_LENGTH) return null

  let matched = null
  for (const candidate of candidates || []) {
    if (!candidate?.code_hash) continue
    const isMatch = bcrypt.compareSync(normalized, candidate.code_hash)
    if (isMatch && !matched) matched = candidate
  }
  return matched
}
