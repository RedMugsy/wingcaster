/**
 * Fast suite — cutover activation validation (no Postgres).
 */
import { describe, expect, it } from 'vitest'
import {
  validateActivateInput,
  validateAttestationForActivate,
} from './activation.js'
import { isAutoMigration } from '../../persistence/migrations/runner.js'
import { isAttestationFresh } from './mode.js'

describe('validateActivateInput', () => {
  it('refuses without attestation_id', () => {
    expect(() => validateActivateInput({ environment: 'LIVE' }))
      .toThrow('ATTESTATION_ID_REQUIRED')
  })

  it('refuses in the wrong environment', () => {
    expect(() => validateActivateInput({
      environment: 'STAGE',
      attestationId: '00000000-0000-4000-8000-000000000001',
    })).toThrow('CUTOVER_ENVIRONMENT_INVALID')
  })

  it('accepts LIVE with an attestation id', () => {
    expect(validateActivateInput({
      environment: 'LIVE',
      attestationId: '00000000-0000-4000-8000-000000000001',
    })).toEqual({
      environment: 'LIVE',
      attestationId: '00000000-0000-4000-8000-000000000001',
    })
  })
})

describe('validateAttestationForActivate', () => {
  const now = '2026-08-18T12:00:00.000Z'

  it('refuses a missing attestation row', () => {
    expect(() => validateAttestationForActivate({
      attestation: null,
      environment: 'LIVE',
      now,
    })).toThrow('ATTESTATION_NOT_FOUND')
  })

  it('refuses an attestation from the wrong environment', () => {
    expect(() => validateAttestationForActivate({
      attestation: { environment: 'TEST', signed_at: now },
      environment: 'LIVE',
      now,
    })).toThrow('ATTESTATION_ENVIRONMENT_MISMATCH')
  })

  it('refuses a stale attestation', () => {
    expect(() => validateAttestationForActivate({
      attestation: { environment: 'LIVE', signed_at: '2026-08-01T00:00:00.000Z' },
      environment: 'LIVE',
      now,
    })).toThrow('ATTESTATION_STALE')
  })
})

describe('isAttestationFresh', () => {
  it('is true within 7 days and false after', () => {
    const now = '2026-08-18T12:00:00.000Z'
    expect(isAttestationFresh('2026-08-18T12:00:00.000Z', now)).toBe(true)
    expect(isAttestationFresh('2026-08-11T12:00:00.000Z', now)).toBe(true)
    expect(isAttestationFresh('2026-08-10T11:59:59.000Z', now)).toBe(false)
  })
})

describe('isAutoMigration', () => {
  it('applies 260/261/262 and skips the 260b down-migration', () => {
    expect(isAutoMigration('260_fin_cutover_freeze_commercial.sql')).toBe(true)
    expect(isAutoMigration('261_fin_cutover_read_views.sql')).toBe(true)
    expect(isAutoMigration('262_fin_cutover_readiness_gate.sql')).toBe(true)
    expect(isAutoMigration('260b_fin_cutover_thaw_commercial.sql')).toBe(false)
  })
})
