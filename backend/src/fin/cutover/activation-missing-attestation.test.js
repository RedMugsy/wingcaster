/**
 * Real-Postgres — missing attestation refuses activate.
 */
import { randomUUID } from 'node:crypto'
import { expect, it } from 'vitest'
import { NOW } from '../testing/seed.js'
import { finPostgresSuite } from '../testing/suite.js'
import { activateFinOnly } from './activation.js'

finPostgresSuite('cutover/activation-missing-attestation', {}, ({ pool }) => {
  it('refuses to activate when no signed attestation exists', async () => {
    await expect(activateFinOnly({
      environment: 'LIVE',
      attestationId: randomUUID(),
      actor: {
        actorType: 'USER',
        actorId: '00000000-0000-0000-0000-0000000000a1',
        actorEmail: 'admin@example.test',
        idempotencyKey: 'cutover-missing',
      },
      now: NOW,
    })).rejects.toMatchObject({ code: 'ATTESTATION_NOT_FOUND' })

    const singleton = await pool().query(
      `SELECT mode FROM fin.cutover_active_environment WHERE environment = 'LIVE'`,
    )
    expect(singleton.rows[0].mode).toBe('OFF')
  })
})
