/**
 * Real-Postgres — attestation signing gated on 30-day GREEN; same hash is dedupe.
 */
import { expect, it } from 'vitest'
import { NOW } from '../../testing/seed.js'
import { finPostgresSuite } from '../../testing/suite.js'
import { signAttestation } from './attestation.js'
import { seedConsecutiveGreenDays } from './test-support.js'

finPostgresSuite('parity/attestation-signing', {}, ({ pool }) => {
  it('cannot sign when burn-in is not met', async () => {
    await expect(signAttestation({
      environment: 'LIVE',
      actor: { actorType: 'USER', actorEmail: 'finance@example.test' },
      now: NOW,
    })).rejects.toMatchObject({ code: 'ATTESTATION_NOT_ELIGIBLE' })
  })

  it('can sign when 30 GREEN days exist; second sign against same evidence is dedupe', async () => {
    await seedConsecutiveGreenDays(pool(), { now: NOW })
    const first = await signAttestation({
      environment: 'LIVE',
      actor: {
        actorType: 'USER',
        actorId: '00000000-0000-0000-0000-0000000000a1',
        actorEmail: 'finance@example.test',
      },
      now: NOW,
    })
    expect(first.inserted).toBe(true)
    expect(first.attestation.signed_by_email).toBe('finance@example.test')
    expect(first.hash).toMatch(/^[a-f0-9]{64}$/)

    const second = await signAttestation({
      environment: 'LIVE',
      actor: { actorType: 'USER', actorEmail: 'other@example.test' },
      now: NOW,
    })
    expect(second.inserted).toBe(false)
    expect(second.hash).toBe(first.hash)
    expect(second.attestation.id).toBe(first.attestation.id)
    const count = await pool().query(
      `SELECT COUNT(*)::int AS n FROM fin.cutover_parity_attestations WHERE environment = 'LIVE'`,
    )
    expect(count.rows[0].n).toBe(1)
  })
})
