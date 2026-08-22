/**
 * Real-Postgres — activate FIN_ONLY with a fresh signed attestation.
 */
import { expect, it } from 'vitest'
import { finPostgresSuite } from '../testing/suite.js'
import { activateFinOnly } from './activation.js'
import { signAttestation } from './parity/attestation.js'
import { seedConsecutiveGreenDays } from './parity/test-support.js'

const ACTOR = {
  actorType: 'USER',
  actorId: '00000000-0000-0000-0000-0000000000a1',
  actorEmail: 'admin@example.test',
  idempotencyKey: 'cutover-activate-happy',
}

finPostgresSuite('cutover/activation-happy', {}, ({ pool }) => {
  it('activates FIN_ONLY, writes the singleton, audit, and outbox', async () => {
    const now = new Date().toISOString()
    await seedConsecutiveGreenDays(pool(), { now })
    const signed = await signAttestation({
      environment: 'LIVE',
      actor: ACTOR,
      now,
    })
    expect(signed.inserted).toBe(true)

    const result = await activateFinOnly({
      environment: 'LIVE',
      attestationId: signed.attestation.id,
      actor: ACTOR,
      note: 'Stage 13d flip',
      now,
    })
    expect(result).toMatchObject({
      ok: true,
      mode: 'FIN_ONLY',
      environment: 'LIVE',
      attestation_id: signed.attestation.id,
    })

    const singleton = await pool().query(
      `SELECT mode, attestation_id, activated_by_email
         FROM fin.cutover_active_environment WHERE environment = 'LIVE'`,
    )
    expect(singleton.rows[0]).toMatchObject({
      mode: 'FIN_ONLY',
      attestation_id: signed.attestation.id,
      activated_by_email: 'admin@example.test',
    })

    const audit = await pool().query(
      `SELECT action, actor_email_snapshot, after_state
         FROM fin.financial_audit_events
        WHERE action = 'FIN_CUTOVER_ACTIVATED'
        ORDER BY created_at DESC LIMIT 1`,
    )
    expect(audit.rowCount).toBe(1)
    expect(audit.rows[0].actor_email_snapshot).toBe('admin@example.test')
    expect(audit.rows[0].after_state.attestation_hash).toBe(signed.hash)

    const outbox = await pool().query(
      `SELECT topic, payload FROM fin.outbox_events
        WHERE topic = 'fin.cutover.activated'
        ORDER BY created_at DESC LIMIT 1`,
    )
    expect(outbox.rowCount).toBe(1)
    expect(outbox.rows[0].payload.mode).toBe('FIN_ONLY')
    expect(outbox.rows[0].payload.attestation_id).toBe(signed.attestation.id)
  })
})
