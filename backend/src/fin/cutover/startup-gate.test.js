/**
 * Real-Postgres — startup gate refuses FIN_ONLY without a fresh attestation.
 */
import { afterEach, expect, it } from 'vitest'
import { NOW } from '../testing/seed.js'
import { finPostgresSuite } from '../testing/suite.js'
import { assertCutoverAttestationGate } from './startup-gate.js'
import { signAttestation } from './parity/attestation.js'
import { seedConsecutiveGreenDays } from './parity/test-support.js'

const prevGlobal = process.env.FIN_CUTOVER_MODE_GLOBAL
const prevSkip = process.env.FIN_CUTOVER_SKIP_ATTESTATION_GATE

finPostgresSuite('cutover/startup-gate', {}, ({ pool }) => {
  afterEach(() => {
    if (prevGlobal === undefined) delete process.env.FIN_CUTOVER_MODE_GLOBAL
    else process.env.FIN_CUTOVER_MODE_GLOBAL = prevGlobal
    if (prevSkip === undefined) delete process.env.FIN_CUTOVER_SKIP_ATTESTATION_GATE
    else process.env.FIN_CUTOVER_SKIP_ATTESTATION_GATE = prevSkip
  })

  it('throws before HTTP would start when FIN_ONLY has no fresh attestation', async () => {
    delete process.env.FIN_CUTOVER_SKIP_ATTESTATION_GATE
    process.env.FIN_CUTOVER_MODE_GLOBAL = 'FIN_ONLY'
    await expect(assertCutoverAttestationGate({
      pool: pool(),
      now: NOW,
    })).rejects.toThrow(/Refusing to boot FIN_ONLY/)
  })

  it('logs OK when a fresh attestation exists', async () => {
    delete process.env.FIN_CUTOVER_SKIP_ATTESTATION_GATE
    const now = new Date().toISOString()
    await seedConsecutiveGreenDays(pool(), { now })
    await signAttestation({
      environment: 'LIVE',
      actor: { actorType: 'USER', actorEmail: 'finance@example.test' },
      now,
    })
    process.env.FIN_CUTOVER_MODE_GLOBAL = 'FIN_ONLY'
    const result = await assertCutoverAttestationGate({ pool: pool(), now })
    expect(result.skipped).toBe(false)
    expect(result.checked.some((row) => row.environment === 'LIVE')).toBe(true)
  })

  it('dev bypass skips the gate', async () => {
    process.env.FIN_CUTOVER_MODE_GLOBAL = 'FIN_ONLY'
    process.env.FIN_CUTOVER_SKIP_ATTESTATION_GATE = 'true'
    const result = await assertCutoverAttestationGate({ pool: pool(), now: NOW })
    expect(result).toEqual({ skipped: true })
  })
})
