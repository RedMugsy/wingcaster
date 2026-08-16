/**
 * Unit tests for record hydration, focused on columns that must never escape
 * the persistence layer.
 */
import { describe, expect, it } from 'vitest'
import { columnNames, fromRow, toRow } from './table-mapper.js'

describe('fromRow — private columns', () => {
  // THE REGRESSION: omitting a column from a mapping's `columns` list does not
  // keep it off a hydrated record, because reads are `SELECT *`. The encrypted
  // TOTP secret rode along in every generic user object until fromRow started
  // stripping it explicitly.
  it('strips the encrypted TOTP secret from a hydrated user', () => {
    const user = fromRow('users', {
      id: 'user-1',
      email: 'agent@example.test',
      verified: true,
      totp_enabled: true,
      totp_secret_encrypted: 'v1:aaa:bbb:ccc',
      totp_last_time_step: '59562345',
      data: { name: 'Agent' },
    })

    expect(user.totp_secret_encrypted).toBeUndefined()
    expect(user.totp_last_time_step).toBeUndefined()
    expect(JSON.stringify(user)).not.toContain('v1:aaa')
  })

  it('keeps the non-secret 2FA fields that the app legitimately reads', () => {
    const user = fromRow('users', {
      id: 'user-1',
      totp_enabled: true,
      totp_enrolled_at: '2026-08-16T00:00:00.000Z',
      preferred_2fa: 'totp',
      data: {},
    })

    expect(user.totp_enabled).toBe(true)
    expect(user.preferred_2fa).toBe('totp')
    expect(user.totp_enrolled_at).toBe('2026-08-16T00:00:00.000Z')
  })

  it('also strips a secret that leaked into the data blob', () => {
    // Belt and braces: if an older row already carries the ciphertext inside
    // `data`, hydration must not hand it back either.
    const user = fromRow('users', {
      id: 'user-1',
      data: { totp_secret_encrypted: 'v1:leaked' },
    })
    expect(user.totp_secret_encrypted).toBeUndefined()
  })

  it('leaves collections without a private list untouched', () => {
    const agent = fromRow('agents', { id: 'a1', user_id: 'user-1', data: { slug: 'x' } })
    expect(agent).toMatchObject({ id: 'a1', user_id: 'user-1', slug: 'x' })
  })
})

describe('write path never carries the secret', () => {
  it('excludes the secret column from generated INSERT/UPDATE column lists', () => {
    // The column is written only by explicit SQL in auth-2fa.js, so the DAL
    // must never name it — otherwise a generic update would null it out.
    const cols = columnNames('users')
    expect(cols).not.toContain('totp_secret_encrypted')
    expect(cols).not.toContain('totp_last_time_step')
    expect(cols).toContain('totp_enabled')
  })

  it('does not copy a stray secret into the data blob on write', () => {
    const row = toRow('users', { id: 'user-1', email: 'a@b.test', totp_enabled: true })
    expect(row.totp_secret_encrypted).toBeUndefined()
  })
})
