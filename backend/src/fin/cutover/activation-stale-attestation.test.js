/**
 * Real-Postgres — stale attestation refuses activate.
 */
import { expect, it } from 'vitest'
import { NOW } from '../testing/seed.js'
import { finPostgresSuite } from '../testing/suite.js'
import { activateFinOnly } from './activation.js'
import { insertAttestationRow } from './parity/test-support.js'

finPostgresSuite('cutover/activation-stale-attestation', {}, ({ pool }) => {
  it('refuses to activate when the attestation is older than 7 days', async () => {
    const id = await insertAttestationRow(pool(), {
      signedAt: '2026-08-01T00:00:00.000Z',
    })
    await expect(activateFinOnly({
      environment: 'LIVE',
      attestationId: id,
      actor: {
        actorType: 'USER',
        actorId: '00000000-0000-0000-0000-0000000000a1',
        actorEmail: 'admin@example.test',
        idempotencyKey: 'cutover-stale',
      },
      now: NOW,
    })).rejects.toMatchObject({ code: 'ATTESTATION_STALE' })

    const singleton = await pool().query(
      `SELECT mode FROM fin.cutover_active_environment WHERE environment = 'LIVE'`,
    )
    expect(singleton.rows[0].mode).toBe('OFF')
  })
})
