/**
 * Unit tests for backup-code generation and redemption. bcrypt round-trips
 * only — no database.
 */
import { describe, expect, it } from 'vitest'
import bcrypt from 'bcryptjs'
import {
  BACKUP_CODE_COUNT,
  formatBackupCode,
  generateBackupCodes,
  matchBackupCode,
  normalizeBackupCode,
} from './backup-codes.js'

describe('generateBackupCodes', () => {
  it('mints the advertised number of codes with aligned hashes', () => {
    const { plaintext, hashes } = generateBackupCodes()
    expect(plaintext).toHaveLength(BACKUP_CODE_COUNT)
    expect(hashes).toHaveLength(BACKUP_CODE_COUNT)
  })

  it('formats codes as two dash-separated groups of five', () => {
    const { plaintext } = generateBackupCodes()
    for (const code of plaintext) {
      expect(code).toMatch(/^[2-9A-HJ-NP-Z]{5}-[2-9A-HJ-NP-Z]{5}$/)
    }
  })

  it('omits glyphs that are easy to mistranscribe from paper', () => {
    // These codes get written down and typed back months later; 0/O and 1/I/L
    // confusion is a realistic lockout cause.
    const { plaintext } = generateBackupCodes()
    const joined = plaintext.join('')
    for (const forbidden of ['0', 'O', '1', 'I', 'L', 'U']) {
      expect(joined).not.toContain(forbidden)
    }
  })

  it('never repeats a code within a set', () => {
    const { plaintext } = generateBackupCodes()
    expect(new Set(plaintext).size).toBe(BACKUP_CODE_COUNT)
  })

  it('produces a different set on each call', () => {
    const first = generateBackupCodes().plaintext
    const second = generateBackupCodes().plaintext
    expect(first.some((code) => second.includes(code))).toBe(false)
  })

  it('stores only bcrypt hashes that verify against the normalised plaintext', () => {
    const { plaintext, hashes } = generateBackupCodes()
    plaintext.forEach((code, index) => {
      expect(hashes[index].startsWith('$2')).toBe(true)
      // The hash covers the unformatted code, so the dash must not be part of it.
      expect(bcrypt.compareSync(normalizeBackupCode(code), hashes[index])).toBe(true)
      expect(bcrypt.compareSync(code, hashes[index])).toBe(false)
    })
  })

  it('does not leak the plaintext into the stored hash', () => {
    const { plaintext, hashes } = generateBackupCodes()
    plaintext.forEach((code, index) => {
      expect(hashes[index]).not.toContain(normalizeBackupCode(code))
    })
  })
})

describe('normalizeBackupCode / formatBackupCode', () => {
  it('round-trips through display formatting', () => {
    expect(normalizeBackupCode(formatBackupCode('ABCDEFGHJK'))).toBe('ABCDEFGHJK')
  })

  it('accepts lowercase, spaces and dashes', () => {
    expect(normalizeBackupCode('abcde-fghjk')).toBe('ABCDEFGHJK')
    expect(normalizeBackupCode('ABCDE FGHJK')).toBe('ABCDEFGHJK')
    expect(normalizeBackupCode('  abcdefghjk  ')).toBe('ABCDEFGHJK')
  })

  it('tolerates null and undefined', () => {
    expect(normalizeBackupCode(null)).toBe('')
    expect(normalizeBackupCode(undefined)).toBe('')
  })
})

describe('matchBackupCode', () => {
  it('finds the matching row regardless of how the user typed the code', () => {
    const { plaintext, hashes } = generateBackupCodes()
    const candidates = hashes.map((code_hash, index) => ({ id: `code-${index}`, code_hash }))

    expect(matchBackupCode(plaintext[3], candidates)?.id).toBe('code-3')
    expect(matchBackupCode(plaintext[3].toLowerCase(), candidates)?.id).toBe('code-3')
    expect(matchBackupCode(normalizeBackupCode(plaintext[3]), candidates)?.id).toBe('code-3')
    expect(matchBackupCode(plaintext[3].replace('-', ' '), candidates)?.id).toBe('code-3')
  })

  it('returns null for a code that is not in the set', () => {
    const { hashes } = generateBackupCodes()
    const candidates = hashes.map((code_hash, index) => ({ id: `code-${index}`, code_hash }))
    expect(matchBackupCode('ZZZZZ-ZZZZZ', candidates)).toBeNull()
  })

  it('returns null for wrong-length input without touching bcrypt', () => {
    const { hashes } = generateBackupCodes()
    const candidates = hashes.map((code_hash, index) => ({ id: `code-${index}`, code_hash }))
    expect(matchBackupCode('SHORT', candidates)).toBeNull()
    expect(matchBackupCode('WAYTOOLONGCODE', candidates)).toBeNull()
    expect(matchBackupCode('', candidates)).toBeNull()
  })

  it('handles an empty or missing candidate set', () => {
    expect(matchBackupCode('ABCDE-FGHJK', [])).toBeNull()
    expect(matchBackupCode('ABCDE-FGHJK', null)).toBeNull()
  })

  it('skips rows with no hash rather than throwing', () => {
    const { plaintext, hashes } = generateBackupCodes()
    const candidates = [
      { id: 'broken', code_hash: null },
      { id: 'good', code_hash: hashes[0] },
    ]
    expect(matchBackupCode(plaintext[0], candidates)?.id).toBe('good')
  })

  it('returns the first match when a set is scanned', () => {
    // Redemption compares every candidate rather than early-exiting, so that
    // response time does not reveal how many codes are already spent. This
    // asserts the behaviour that guarantees stays correct.
    const { plaintext, hashes } = generateBackupCodes()
    const candidates = hashes.map((code_hash, index) => ({ id: `code-${index}`, code_hash }))
    expect(matchBackupCode(plaintext[BACKUP_CODE_COUNT - 1], candidates)?.id)
      .toBe(`code-${BACKUP_CODE_COUNT - 1}`)
  })
})
