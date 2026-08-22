/**
 * Stage 13d startup attestation gate (DL-209).
 * Runs after DB setup and before the HTTP listener.
 * PROD must never set FIN_CUTOVER_SKIP_ATTESTATION_GATE.
 */
import { BusinessClock } from '../clock.js'
import { ATTESTATION_FRESH_DAYS } from './parity/attestation.js'
import {
  isAttestationFresh,
  readActiveEnvironment,
} from './mode.js'

function skipGate() {
  return String(process.env.FIN_CUTOVER_SKIP_ATTESTATION_GATE || '').toLowerCase() === 'true'
}

function envOf(environment) {
  return environment === 'TEST' ? 'TEST' : 'LIVE'
}

async function latestAttestation(pool, environment) {
  const { rows } = await pool.query(
    `SELECT id, signed_at, attestation_hash, signed_by_email
       FROM fin.cutover_parity_attestations
      WHERE environment = $1
      ORDER BY signed_at DESC
      LIMIT 1`,
    [envOf(environment)],
  )
  return rows[0] || null
}

async function loadAttestation(pool, id) {
  if (!id) return null
  const { rows } = await pool.query(
    `SELECT id, signed_at, attestation_hash, signed_by_email, environment
       FROM fin.cutover_parity_attestations
      WHERE id = $1`,
    [id],
  )
  return rows[0] || null
}

function refuse(environment, reason) {
  throw new Error(
    `Refusing to boot FIN_ONLY without a fresh cutover attestation `
    + `(signed within ${ATTESTATION_FRESH_DAYS} days) for ${environment}: ${reason}. `
    + `FIN_CUTOVER_SKIP_ATTESTATION_GATE is a local-dev bypass; PROD must never set it.`,
  )
}

async function assertEnv(pool, environment, now) {
  const env = envOf(environment)
  const row = await readActiveEnvironment(pool, env)
  const globalFinOnly = String(process.env.FIN_CUTOVER_MODE_GLOBAL || '').toUpperCase() === 'FIN_ONLY'
  const dbFinOnly = row?.mode === 'FIN_ONLY'
  if (!globalFinOnly && !dbFinOnly) {
    return { environment: env, required: false }
  }

  let attestation = null
  if (dbFinOnly && row.attestation_id) {
    attestation = await loadAttestation(pool, row.attestation_id)
  }
  if (!attestation) {
    attestation = await latestAttestation(pool, env)
  }
  if (!attestation) {
    refuse(env, 'no signed attestation row')
  }
  if (!isAttestationFresh(attestation.signed_at, now)) {
    refuse(env, `attestation ${attestation.id} signed_at=${attestation.signed_at} is stale`)
  }
  return {
    environment: env,
    required: true,
    attestation_id: attestation.id,
    signed_at: attestation.signed_at,
  }
}

/**
 * @param {{ pool: { query: Function }, now?: string, log?: (msg: string, extra?: object) => void }} args
 */
export async function assertCutoverAttestationGate({
  pool,
  now = null,
  log = null,
} = {}) {
  if (skipGate()) {
    log?.('cutover attestation gate skipped (FIN_CUTOVER_SKIP_ATTESTATION_GATE)', {
      skip: true,
    })
    return { skipped: true }
  }
  if (!pool || typeof pool.query !== 'function') {
    throw new Error('assertCutoverAttestationGate requires a connected pool')
  }
  const stamped = now || BusinessClock.now()
  const live = await assertEnv(pool, 'LIVE', stamped)
  const test = await assertEnv(pool, 'TEST', stamped)
  const checked = [live, test].filter((r) => r.required)
  if (checked.length) {
    log?.('cutover attestation OK', {
      environments: checked.map((r) => r.environment),
      signed_at: checked.map((r) => r.signed_at),
    })
  }
  return { skipped: false, checked }
}
