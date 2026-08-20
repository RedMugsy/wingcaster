/**
 * fin.accounting_periods machine (B §550).
 * OPEN → SOFT_CLOSED → HARD_CLOSED.
 * HARD_CLOSED → SOFT_CLOSED via RECONCILIATION_OVERRIDE (not HARD → OPEN).
 * Per-period pg_advisory_xact_lock(FIN_ACCOUNTING_PERIOD_CLOSE=1019).
 */
import { randomUUID } from 'node:crypto'
import { transaction } from '../../db.js'
import { BusinessClock } from '../clock.js'
import { CATEGORY, finError } from '../errors.js'
import { FIN_ACCOUNTING_PERIOD_CLOSE } from '../foundation/advisory-locks.js'
import { requestFingerprint } from '../idempotency/fingerprint.js'
import { claimIdempotency, completeIdempotency } from '../idempotency/claim.js'
import { insertAudit, insertOutbox } from '../ledger/write.js'
import { mapAccountingPgError } from './helpers.js'

function iso(value) {
  if (!value) return BusinessClock.now()
  if (value instanceof Date) return value.toISOString()
  return String(value)
}

function envelope(input) {
  return {
    now: iso(input.now || BusinessClock.now()),
    environment: input.environment || 'LIVE',
    actorType: input.actorType || 'SYSTEM',
    actorId: input.actorId || null,
    actorEmail: input.actorEmail || 'system@fin.local',
    reasonCode: input.reasonCode,
    tenantId: input.tenantId || null,
    idempotencyKey: input.idempotencyKey,
  }
}

function requireReason(reasonCode) {
  if (!reasonCode) {
    throw finError('REASON_CODE_REQUIRED', { category: CATEGORY.VALIDATION })
  }
}

async function claim(client, env, key, fingerprintPayload) {
  if (!key) {
    throw finError('IDEMPOTENCY_KEY_REQUIRED', { category: CATEGORY.VALIDATION })
  }
  return claimIdempotency(client, {
    environment: env.environment,
    tenantId: env.tenantId,
    key,
    fingerprint: requestFingerprint(fingerprintPayload),
    now: env.now,
    actorType: env.actorType,
    actorId: env.actorId,
  })
}

async function finish(client, claimed, env, body) {
  await completeIdempotency(client, { id: claimed.row.id, now: env.now, body })
  return body
}

async function lockPeriod(client, periodKey) {
  await client.query(
    'SELECT pg_advisory_xact_lock($1, hashtext($2::text))',
    [FIN_ACCOUNTING_PERIOD_CLOSE, periodKey],
  )
}

async function loadPeriod(client, periodId) {
  const { rows } = await client.query(
    `SELECT * FROM fin.accounting_periods WHERE id = $1 FOR UPDATE`,
    [periodId],
  )
  return rows[0] || null
}

async function writeStatus(client, env, period, to, extra = {}) {
  await insertOutbox(client, {
    environment: env.environment,
    topic: 'fin.accounting_period.status',
    dedupeKey: `acctperiod:${period.id}:${to}:${period.version || 1}`,
    payload: { periodId: period.id, status: to, ...extra },
    now: env.now,
  })
  await insertAudit(client, {
    environment: env.environment,
    actorType: env.actorType,
    actorId: env.actorId,
    actorEmail: env.actorEmail,
    action: `ACCOUNTING_PERIOD_${to}`,
    targetType: 'ACCOUNTING_PERIOD',
    targetId: period.id,
    beforeState: { status: period.status },
    afterState: { status: to, ...extra },
    reasonCode: env.reasonCode,
    approvalRequestId: extra.approvalRequestId || null,
    now: env.now,
  })
}

export async function openAccountingPeriod(input) {
  const env = envelope(input)
  requireReason(env.reasonCode)
  if (!input.legalEntityId || !input.periodKey || !input.startsAt || !input.endsAt) {
    throw finError('REASON_CODE_REQUIRED', {
      category: CATEGORY.VALIDATION,
      details: { reason: 'period_fields_required' },
    })
  }
  const key = env.idempotencyKey
    || `ACCTPERIOD:OPEN:${input.legalEntityId}:${input.periodKey}`
  return transaction(async (client) => {
    const claimed = await claim(client, env, key, {
      cmd: 'OpenAccountingPeriod',
      legalEntityId: input.legalEntityId,
      periodKey: input.periodKey,
    })
    if (claimed.kind === 'replay') return claimed.row.response_body
    await lockPeriod(client, `${env.environment}:${input.legalEntityId}:${input.periodKey}`)
    const id = randomUUID()
    try {
      await client.query(
        `INSERT INTO fin.accounting_periods (
           id, environment, legal_entity_id, period_key, starts_at, ends_at, status,
           created_at, created_by_actor_type, created_by_actor_id,
           updated_at, updated_by_actor_type, updated_by_actor_id
         ) VALUES ($1,$2,$3,$4,$5,$6,'OPEN',$7,$8,$9,$7,$8,$9)`,
        [
          id, env.environment, input.legalEntityId, input.periodKey,
          iso(input.startsAt), iso(input.endsAt),
          env.now, env.actorType, env.actorId,
        ],
      )
    } catch (error) {
      if (error.code === '23505') {
        throw finError('OCC_VERSION_MISMATCH', {
          category: CATEGORY.CONFLICT,
          details: { reason: 'period_already_open' },
        })
      }
      throw mapAccountingPgError(error)
    }
    const period = await loadPeriod(client, id)
    await writeStatus(client, env, { ...period, status: null, version: 1 }, 'OPEN')
    return finish(client, claimed, env, { periodId: id, status: 'OPEN' })
  })
}

export async function softClosePeriod(input) {
  const env = envelope(input)
  requireReason(env.reasonCode)
  const periodId = input.periodId
  if (!periodId) {
    throw finError('REASON_CODE_REQUIRED', {
      category: CATEGORY.VALIDATION,
      details: { field: 'periodId' },
    })
  }
  const key = env.idempotencyKey || `ACCTPERIOD:SOFT:${periodId}`
  return transaction(async (client) => {
    const claimed = await claim(client, env, key, { cmd: 'SoftCloseAccountingPeriod', periodId })
    if (claimed.kind === 'replay') return claimed.row.response_body
    await lockPeriod(client, periodId)
    const period = await loadPeriod(client, periodId)
    if (!period) {
      throw finError('ACCOUNTING_PERIOD_NOT_FOUND', { category: CATEGORY.PRECONDITION })
    }
    if (Date.parse(period.ends_at) > Date.parse(env.now)) {
      throw finError('ACCOUNTING_PERIOD_NOT_ENDED', { category: CATEGORY.PRECONDITION })
    }
    try {
      await client.query(
        `UPDATE fin.accounting_periods
            SET status = 'SOFT_CLOSED', updated_at = $2,
                updated_by_actor_type = $3, updated_by_actor_id = $4
          WHERE id = $1`,
        [periodId, env.now, env.actorType, env.actorId],
      )
    } catch (error) {
      throw mapAccountingPgError(error)
    }
    await writeStatus(client, env, period, 'SOFT_CLOSED')
    return finish(client, claimed, env, { periodId, status: 'SOFT_CLOSED' })
  })
}

async function assertReconClear(client, env) {
  const { rows } = await client.query(
    `SELECT id FROM fin.reconciliation_runs
      WHERE environment = $1 AND status = 'COMPLETED'
      ORDER BY finished_at DESC NULLS LAST
      LIMIT 1`,
    [env.environment],
  )
  if (!rows[0]) {
    throw finError('ACCOUNTING_PERIOD_RECON_INCOMPLETE', { category: CATEGORY.PRECONDITION })
  }
  const blocked = await client.query(
    `SELECT res.id
       FROM fin.reconciliation_resolution res
       JOIN fin.reconciliation_drift d ON d.id = res.drift_id
       JOIN fin.reconciliation_checks c ON c.id = d.check_id
      WHERE c.run_id = $1
        AND res.action LIKE 'BLOCK_%'
        AND res.resolved_at IS NULL
      LIMIT 1`,
    [rows[0].id],
  )
  if (blocked.rowCount) {
    throw finError('ACCOUNTING_PERIOD_RECON_INCOMPLETE', {
      category: CATEGORY.PRECONDITION,
      details: { unresolved_block: blocked.rows[0].id },
    })
  }
  return rows[0].id
}

export async function hardClosePeriod(input) {
  const env = envelope(input)
  requireReason(env.reasonCode)
  const periodId = input.periodId
  if (!periodId) {
    throw finError('REASON_CODE_REQUIRED', {
      category: CATEGORY.VALIDATION,
      details: { field: 'periodId' },
    })
  }
  const key = env.idempotencyKey || `ACCTPERIOD:HARD:${periodId}`
  return transaction(async (client) => {
    const claimed = await claim(client, env, key, { cmd: 'HardCloseAccountingPeriod', periodId })
    if (claimed.kind === 'replay') return claimed.row.response_body
    await lockPeriod(client, periodId)
    const period = await loadPeriod(client, periodId)
    if (!period) {
      throw finError('ACCOUNTING_PERIOD_NOT_FOUND', { category: CATEGORY.PRECONDITION })
    }
    const runId = await assertReconClear(client, env)
    try {
      await client.query(
        `UPDATE fin.accounting_periods
            SET status = 'HARD_CLOSED', closed_at = $2, closed_by_actor_id = $3,
                updated_at = $2, updated_by_actor_type = $4, updated_by_actor_id = $3
          WHERE id = $1`,
        [periodId, env.now, env.actorId, env.actorType],
      )
    } catch (error) {
      throw mapAccountingPgError(error)
    }
    await writeStatus(client, env, period, 'HARD_CLOSED', { reconRunId: runId })
    return finish(client, claimed, env, { periodId, status: 'HARD_CLOSED' })
  })
}

async function loadOverrideApproval(client, approvalId) {
  if (!approvalId) {
    throw finError('ACCOUNTING_PERIOD_REOPEN_WITHOUT_APPROVAL', {
      category: CATEGORY.APPROVAL,
    })
  }
  const { rows } = await client.query(
    `SELECT * FROM fin.approval_requests WHERE id = $1`,
    [approvalId],
  )
  const approval = rows[0]
  if (
    !approval
    || approval.action_kind !== 'RECONCILIATION_OVERRIDE'
    || !['APPROVED', 'EXECUTED'].includes(approval.status)
  ) {
    throw finError('ACCOUNTING_PERIOD_REOPEN_WITHOUT_APPROVAL', {
      category: CATEGORY.APPROVAL,
    })
  }
  return approval
}

export async function reopenPeriod(input) {
  const env = envelope(input)
  requireReason(env.reasonCode)
  const periodId = input.periodId
  if (!periodId) {
    throw finError('REASON_CODE_REQUIRED', {
      category: CATEGORY.VALIDATION,
      details: { field: 'periodId' },
    })
  }
  if (!input.approvalRequestId && !input.reconciliationOverrideApprovalId) {
    throw finError('ACCOUNTING_PERIOD_REOPEN_WITHOUT_APPROVAL', {
      category: CATEGORY.APPROVAL,
    })
  }
  const key = env.idempotencyKey || `ACCTPERIOD:REOPEN:${periodId}`
  return transaction(async (client) => {
    const claimed = await claim(client, env, key, { cmd: 'ReopenAccountingPeriod', periodId })
    if (claimed.kind === 'replay') return claimed.row.response_body
    await lockPeriod(client, periodId)
    const period = await loadPeriod(client, periodId)
    if (!period) {
      throw finError('ACCOUNTING_PERIOD_NOT_FOUND', { category: CATEGORY.PRECONDITION })
    }
    const approval = await loadOverrideApproval(
      client,
      input.approvalRequestId || input.reconciliationOverrideApprovalId,
    )
    try {
      await client.query(
        `UPDATE fin.accounting_periods
            SET status = 'SOFT_CLOSED',
                reconciliation_override_approval_id = $2,
                updated_at = $3,
                updated_by_actor_type = $4,
                updated_by_actor_id = $5
          WHERE id = $1`,
        [periodId, approval.id, env.now, env.actorType, env.actorId],
      )
    } catch (error) {
      throw mapAccountingPgError(error)
    }
    await writeStatus(client, env, period, 'SOFT_CLOSED', {
      approvalRequestId: approval.id,
      reopened: true,
    })
    return finish(client, claimed, env, {
      periodId,
      status: 'SOFT_CLOSED',
      reopened: true,
    })
  })
}
