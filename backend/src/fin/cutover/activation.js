/**
 * Stage 13d cutover activation / deactivation (DL-206..DL-211).
 * Infrastructure only — does not mutate commercial.* rows or fin.* domain tables.
 */
import { transaction } from '../../db.js'
import { getPool } from '../../persistence/postgres-adapter.js'
import { BusinessClock } from '../clock.js'
import { CATEGORY, finError } from '../errors.js'
import { FIN_CUTOVER_ACTIVATION } from '../foundation/advisory-locks.js'
import { requestFingerprint } from '../idempotency/fingerprint.js'
import { claimIdempotency, completeIdempotency } from '../idempotency/claim.js'
import { insertAudit, insertOutbox } from '../ledger/write.js'
import { runReconciliation } from '../reconciliation/runner.js'
import { ATTESTATION_FRESH_DAYS } from './parity/attestation.js'
import { isAttestationFresh, readActiveEnvironment } from './mode.js'

const REQUIRED_RECON = ['R084', 'R090', 'R091', 'R092', 'R093', 'R094', 'R096']

function envOf(environment) {
  if (environment === 'TEST' || environment === 'LIVE') return environment
  return null
}

function iso(value) {
  if (!value) return BusinessClock.now()
  if (value instanceof Date) return value.toISOString()
  return String(value)
}

export function validateActivateInput({ environment, attestationId } = {}) {
  const env = envOf(environment)
  if (!env) {
    throw finError('CUTOVER_ENVIRONMENT_INVALID', {
      category: CATEGORY.VALIDATION,
      details: { environment },
    })
  }
  if (!attestationId) {
    throw finError('ATTESTATION_ID_REQUIRED', {
      category: CATEGORY.VALIDATION,
    })
  }
  return { environment: env, attestationId: String(attestationId) }
}

export function validateAttestationForActivate({
  attestation,
  environment,
  now,
} = {}) {
  if (!attestation) {
    throw finError('ATTESTATION_NOT_FOUND', {
      category: CATEGORY.PRECONDITION,
      httpStatus: 409,
    })
  }
  if (attestation.environment !== environment) {
    throw finError('ATTESTATION_ENVIRONMENT_MISMATCH', {
      category: CATEGORY.VALIDATION,
      details: {
        expected: environment,
        actual: attestation.environment,
      },
    })
  }
  if (!isAttestationFresh(attestation.signed_at, now)) {
    throw finError('ATTESTATION_STALE', {
      category: CATEGORY.CONTROL,
      httpStatus: 409,
      details: {
        signed_at: attestation.signed_at,
        fresh_days: ATTESTATION_FRESH_DAYS,
      },
    })
  }
}

export async function applyCutoverSession(client, environment = 'LIVE') {
  const env = environment === 'TEST' ? 'TEST' : 'LIVE'
  await client.query(`SELECT set_config('fin.environment', $1, true)`, [env])
  await client.query(`SELECT set_config('fin.platform_admin', 'on', true)`)
  await client.query(`SELECT set_config('fin.elevated', 'on', true)`)
}

async function withActivationLock(environment, fn) {
  const client = await getPool().connect()
  try {
    const locked = await client.query(
      'SELECT pg_try_advisory_lock($1, hashtext($2::text)) AS ok',
      [FIN_CUTOVER_ACTIVATION, environment],
    )
    if (!locked.rows[0].ok) {
      throw finError('CUTOVER_ACTIVATION_IN_PROGRESS', {
        category: CATEGORY.CONFLICT,
        httpStatus: 409,
        retryable: true,
        retryAfter: 2,
      })
    }
    try {
      return await fn()
    } finally {
      await client.query(
        'SELECT pg_advisory_unlock($1, hashtext($2::text))',
        [FIN_CUTOVER_ACTIVATION, environment],
      ).catch(() => {})
    }
  } finally {
    client.release()
  }
}

function requireReconGreen(recon) {
  if (recon?.skipped) {
    throw finError('RECON_LOCK_HELD', {
      category: CATEGORY.CONFLICT,
      httpStatus: 409,
      retryable: true,
      details: { reason: recon.reason },
    })
  }
  const byCode = Object.fromEntries((recon.results || []).map((r) => [r.check_code, r]))
  const failed = REQUIRED_RECON.filter((code) => byCode[code]?.result !== 'GREEN')
  if (failed.length) {
    throw finError('CUTOVER_RECON_NOT_GREEN', {
      category: CATEGORY.PRECONDITION,
      httpStatus: 409,
      details: {
        failed,
        results: Object.fromEntries(failed.map((code) => [code, byCode[code]?.result || 'MISSING'])),
      },
    })
  }
}

async function claimActivate(client, {
  environment, key, fingerprintPayload, actor, now,
}) {
  if (!actor?.idempotencyKey && !key) {
    throw finError('IDEMPOTENCY_KEY_REQUIRED', { category: CATEGORY.IDEMPOTENCY, httpStatus: 400 })
  }
  try {
    return await claimIdempotency(client, {
      environment,
      tenantId: null,
      key,
      fingerprint: requestFingerprint(fingerprintPayload),
      now,
      actorType: actor.actorType || 'USER',
      actorId: actor.actorId || null,
    })
  } catch (error) {
    if (error.code === '23505') {
      throw finError('IDEMPOTENCY_KEY_IN_FLIGHT', {
        category: CATEGORY.IDEMPOTENCY,
        httpStatus: 409,
        retryable: true,
        retryAfter: 2,
      })
    }
    throw error
  }
}

/**
 * Flip fin.cutover_active_environment to FIN_ONLY (DL-207).
 * DELETE-and-INSERT of the singleton row (DL-207).
 */
export async function activateFinOnly({
  environment,
  attestationId,
  actor = {},
  note = null,
  now = null,
} = {}) {
  const parsed = validateActivateInput({ environment, attestationId })
  const stamped = iso(now || actor.now)
  const actorEmail = actor.actorEmail || actor.email
  if (!actorEmail) {
    throw finError('ACTOR_EMAIL_REQUIRED', { category: CATEGORY.VALIDATION })
  }

  return withActivationLock(parsed.environment, async () => {
    return transaction(async (client) => {
      await applyCutoverSession(client, parsed.environment)
      const key = `CUTOVER_ACTIVATE:${parsed.environment}:${parsed.attestationId}`
      const claimed = await claimActivate(client, {
        environment: parsed.environment,
        key,
        fingerprintPayload: {
          environment: parsed.environment,
          attestationId: parsed.attestationId,
          note: note || null,
          idempotencyKey: actor.idempotencyKey || null,
        },
        actor,
        now: stamped,
      })
      if (claimed.kind === 'replay') return claimed.row.response_body

      const loaded = await client.query(
        `SELECT id, environment, attestation_hash, signed_at, signed_by_email
           FROM fin.cutover_parity_attestations
          WHERE id = $1
          FOR UPDATE`,
        [parsed.attestationId],
      )
      validateAttestationForActivate({
        attestation: loaded.rows[0] || null,
        environment: parsed.environment,
        now: stamped,
      })
      const attestation = loaded.rows[0]

      const recon = await runReconciliation(getPool(), {
        environment: parsed.environment,
        scheduleKind: 'ON_DEMAND',
        now: stamped,
      })
      requireReconGreen(recon)

      // DL-207: DELETE-and-INSERT rather than in-place UPDATE so the
      // singleton change is a new row (small append-only hack).
      await client.query(
        `DELETE FROM fin.cutover_active_environment WHERE environment = $1`,
        [parsed.environment],
      )
      await client.query(
        `INSERT INTO fin.cutover_active_environment (
           environment, mode, attestation_id, activated_at,
           activated_by_email, activated_by_actor_type, updated_at
         ) VALUES ($1, 'FIN_ONLY', $2, $3::timestamptz, $4, $5, $3::timestamptz)`,
        [
          parsed.environment,
          attestation.id,
          stamped,
          actorEmail,
          actor.actorType || 'USER',
        ],
      )

      await insertAudit(client, {
        environment: parsed.environment,
        actorType: actor.actorType || 'USER',
        actorId: actor.actorId || null,
        actorEmail,
        action: 'FIN_CUTOVER_ACTIVATED',
        targetType: 'CUTOVER_ACTIVE_ENVIRONMENT',
        targetId: null,
        afterState: {
          mode: 'FIN_ONLY',
          attestation_id: attestation.id,
          attestation_hash: attestation.attestation_hash,
          note: note || null,
        },
        reasonCode: 'FIN_CUTOVER_ACTIVATED',
        now: stamped,
      })
      await insertOutbox(client, {
        environment: parsed.environment,
        topic: 'fin.cutover.activated',
        dedupeKey: `cutover:activated:${parsed.environment}:${attestation.id}:${stamped}`,
        payload: {
          environment: parsed.environment,
          mode: 'FIN_ONLY',
          attestation_id: attestation.id,
          attestation_hash: attestation.attestation_hash,
          activated_by_email: actorEmail,
          note: note || null,
        },
        now: stamped,
      })

      const body = {
        ok: true,
        mode: 'FIN_ONLY',
        environment: parsed.environment,
        attestation_id: attestation.id,
        attestation_hash: attestation.attestation_hash,
        activated_at: stamped,
      }
      await completeIdempotency(client, {
        id: claimed.row.id,
        now: stamped,
        body,
      })
      return body
    })
  })
}

export async function deactivateFinOnly({
  environment,
  reasonCode,
  note = null,
  actor = {},
  now = null,
} = {}) {
  const env = envOf(environment)
  if (!env) {
    throw finError('CUTOVER_ENVIRONMENT_INVALID', {
      category: CATEGORY.VALIDATION,
      details: { environment },
    })
  }
  if (!reasonCode) {
    throw finError('REASON_CODE_REQUIRED', { category: CATEGORY.VALIDATION })
  }
  if (!note) {
    throw finError('NOTE_REQUIRED', { category: CATEGORY.VALIDATION })
  }
  const actorEmail = actor.actorEmail || actor.email
  if (!actorEmail) {
    throw finError('ACTOR_EMAIL_REQUIRED', { category: CATEGORY.VALIDATION })
  }
  const stamped = iso(now || actor.now)

  return withActivationLock(env, async () => {
    return transaction(async (client) => {
      await applyCutoverSession(client, env)
      const key = `CUTOVER_DEACTIVATE:${env}:${reasonCode}`
      const claimed = await claimActivate(client, {
        environment: env,
        key,
        fingerprintPayload: {
          environment: env,
          reasonCode,
          note,
          idempotencyKey: actor.idempotencyKey || null,
        },
        actor,
        now: stamped,
      })
      if (claimed.kind === 'replay') return claimed.row.response_body

      const previous = await readActiveEnvironment(client, env)
      await client.query(
        `DELETE FROM fin.cutover_active_environment WHERE environment = $1`,
        [env],
      )
      await client.query(
        `INSERT INTO fin.cutover_active_environment (
           environment, mode, attestation_id, activated_at,
           activated_by_email, activated_by_actor_type, updated_at
         ) VALUES ($1, 'DUAL', $2, $3::timestamptz, $4, $5, $3::timestamptz)`,
        [
          env,
          previous?.attestation_id || null,
          stamped,
          actorEmail,
          actor.actorType || 'USER',
        ],
      )

      await insertAudit(client, {
        environment: env,
        actorType: actor.actorType || 'USER',
        actorId: actor.actorId || null,
        actorEmail,
        action: 'FIN_CUTOVER_DEACTIVATED',
        targetType: 'CUTOVER_ACTIVE_ENVIRONMENT',
        targetId: null,
        beforeState: previous ? { mode: previous.mode, attestation_id: previous.attestation_id } : null,
        afterState: { mode: 'DUAL', reason_code: reasonCode, note },
        reasonCode,
        now: stamped,
      })
      await insertOutbox(client, {
        environment: env,
        topic: 'fin.cutover.deactivated',
        dedupeKey: `cutover:deactivated:${env}:${reasonCode}:${stamped}`,
        payload: {
          environment: env,
          mode: 'DUAL',
          reason_code: reasonCode,
          note,
          deactivated_by_email: actorEmail,
        },
        now: stamped,
      })

      const body = {
        ok: true,
        mode: 'DUAL',
        environment: env,
        reason_code: reasonCode,
        deactivated_at: stamped,
      }
      await completeIdempotency(client, {
        id: claimed.row.id,
        now: stamped,
        body,
      })
      return body
    })
  })
}
