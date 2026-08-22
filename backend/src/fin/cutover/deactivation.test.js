/**
 * Real-Postgres — deactivate FIN_ONLY back to DUAL.
 */
import { expect, it } from 'vitest'
import { finPostgresSuite } from '../testing/suite.js'
import { activateFinOnly, deactivateFinOnly } from './activation.js'
import { signAttestation } from './parity/attestation.js'
import { seedConsecutiveGreenDays } from './parity/test-support.js'

const ACTOR = {
  actorType: 'USER',
  actorId: '00000000-0000-0000-0000-0000000000a1',
  actorEmail: 'admin@example.test',
}

finPostgresSuite('cutover/deactivation', {}, ({ pool }) => {
  it('flips FIN_ONLY back to DUAL and emits audit + outbox', async () => {
    const now = new Date().toISOString()
    await seedConsecutiveGreenDays(pool(), { now })
    const signed = await signAttestation({
      environment: 'LIVE',
      actor: ACTOR,
      now,
    })
    await activateFinOnly({
      environment: 'LIVE',
      attestationId: signed.attestation.id,
      actor: { ...ACTOR, idempotencyKey: 'cutover-activate-then-deact' },
      note: 'flip',
      now,
    })

    const result = await deactivateFinOnly({
      environment: 'LIVE',
      reasonCode: 'ROLLBACK',
      note: 'parity regression in canary',
      actor: { ...ACTOR, idempotencyKey: 'cutover-deactivate' },
      now,
    })
    expect(result).toMatchObject({
      ok: true,
      mode: 'DUAL',
      environment: 'LIVE',
      reason_code: 'ROLLBACK',
    })

    const singleton = await pool().query(
      `SELECT mode FROM fin.cutover_active_environment WHERE environment = 'LIVE'`,
    )
    expect(singleton.rows[0].mode).toBe('DUAL')

    const audit = await pool().query(
      `SELECT action, after_state FROM fin.financial_audit_events
        WHERE action = 'FIN_CUTOVER_DEACTIVATED'
        ORDER BY created_at DESC LIMIT 1`,
    )
    expect(audit.rowCount).toBe(1)
    expect(audit.rows[0].after_state.reason_code).toBe('ROLLBACK')

    const outbox = await pool().query(
      `SELECT topic, payload FROM fin.outbox_events
        WHERE topic = 'fin.cutover.deactivated'
        ORDER BY created_at DESC LIMIT 1`,
    )
    expect(outbox.rowCount).toBe(1)
    expect(outbox.rows[0].payload.reason_code).toBe('ROLLBACK')
  })
})
