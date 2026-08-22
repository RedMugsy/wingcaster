/**
 * Real-Postgres — R096 DRIFT then GREEN.
 */
import { expect, it } from 'vitest'
import { NOW } from '../testing/seed.js'
import { finPostgresSuite } from '../testing/suite.js'
import { runReconciliation } from './runner.js'

function resultOf(run, code) {
  return run.results.find((r) => r.check_code === code)
}

finPostgresSuite('reconciliation/r096', {}, ({ pool }) => {
  it('R096 DRIFT when FIN_ONLY lacks a fresh attestation then GREEN when OFF', async () => {
    const clean = await runReconciliation(pool(), { now: NOW })
    expect(resultOf(clean, 'R096').result).toBe('GREEN')

    await pool().query(
      'ALTER TABLE fin.cutover_active_environment DISABLE TRIGGER trg_cutover_active_environment_fin_only',
    )
    await pool().query(
      `DELETE FROM fin.cutover_active_environment WHERE environment = 'LIVE'`,
    )
    await pool().query(
      `INSERT INTO fin.cutover_active_environment (
         environment, mode, attestation_id, activated_at,
         activated_by_email, activated_by_actor_type, updated_at
       ) VALUES (
         'LIVE', 'FIN_ONLY', NULL, $1::timestamptz,
         'test@example.test', 'SYSTEM', $1::timestamptz
       )`,
      [NOW],
    )
    await pool().query(
      'ALTER TABLE fin.cutover_active_environment ENABLE TRIGGER trg_cutover_active_environment_fin_only',
    )

    const drifted = await runReconciliation(pool(), { now: NOW })
    expect(resultOf(drifted, 'R096').result).toBe('DRIFT')
    const stored = await pool().query(
      `SELECT drift_action FROM fin.reconciliation_checks WHERE id = $1`,
      [resultOf(drifted, 'R096').checkId],
    )
    expect(stored.rows[0].drift_action).toBe('BLOCK_NEW_ISSUANCE')

    await pool().query(
      'ALTER TABLE fin.cutover_active_environment DISABLE TRIGGER trg_cutover_active_environment_fin_only',
    )
    await pool().query(
      `DELETE FROM fin.cutover_active_environment WHERE environment = 'LIVE'`,
    )
    await pool().query(
      `INSERT INTO fin.cutover_active_environment (
         environment, mode, attestation_id, activated_at,
         activated_by_email, activated_by_actor_type, updated_at
       ) VALUES (
         'LIVE', 'OFF', NULL, $1::timestamptz,
         'test@example.test', 'SYSTEM', $1::timestamptz
       )`,
      [NOW],
    )
    await pool().query(
      'ALTER TABLE fin.cutover_active_environment ENABLE TRIGGER trg_cutover_active_environment_fin_only',
    )
    const restored = await runReconciliation(pool(), { now: NOW })
    expect(resultOf(restored, 'R096').result).toBe('GREEN')
  })
})
