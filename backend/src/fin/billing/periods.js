/**
 * fin.billing_periods machine (B §11).
 * OPEN → USAGE_CLOSING → USAGE_CLOSED → RATING_CLOSED →
 * INVOICE_DRAFTED → INVOICED → FINAL
 * Reopens: USAGE_CLOSING → OPEN; INVOICE_DRAFTED → RATING_CLOSED.
 */
import { randomUUID } from 'node:crypto'
import { CATEGORY, finError } from '../errors.js'
import { insertAudit, insertOutbox } from '../ledger/write.js'
import {
  claim, envelope, finish, lockBillingPeriod, mapBillingPgError, requireReason,
  withRetry,
} from './helpers.js'

async function loadPeriod(client, periodId) {
  const { rows } = await client.query(
    `SELECT * FROM fin.billing_periods WHERE id = $1 FOR UPDATE`,
    [periodId],
  )
  return rows[0] || null
}

async function writeStatus(client, env, period, to, extra = {}) {
  await insertOutbox(client, {
    environment: env.environment,
    topic: 'fin.billing_period.status',
    dedupeKey: `bp:${period.id}:${to}:${period.version || 1}`,
    payload: { periodId: period.id, status: to, ...extra },
    now: env.now,
  })
  await insertAudit(client, {
    environment: env.environment,
    actorType: env.actorType,
    actorId: env.actorId,
    actorEmail: env.actorEmail,
    action: `BILLING_PERIOD_${to}`,
    targetType: 'BILLING_PERIOD',
    targetId: period.id,
    beforeState: { status: period.status },
    afterState: { status: to, ...extra },
    reasonCode: env.reasonCode,
    now: env.now,
  })
}

export async function openBillingPeriod(input) {
  const env = envelope(input)
  requireReason(env.reasonCode)
  if (!input.billingAccountId || !input.periodKey || !input.startsAt || !input.endsAt) {
    throw finError('REASON_CODE_REQUIRED', {
      category: CATEGORY.VALIDATION,
      details: { reason: 'period_fields_required' },
    })
  }
  const key = env.idempotencyKey
    || `BP:OPEN:${input.billingAccountId}:${input.periodKey}`
  return withRetry(async (client) => {
    const claimed = await claim(client, env, key, {
      cmd: 'OpenBillingPeriod',
      billingAccountId: input.billingAccountId,
      periodKey: input.periodKey,
    })
    if (claimed.kind === 'replay') return claimed.row.response_body

    const ba = (await client.query(
      `SELECT id, tenant_id, environment FROM fin.billing_accounts WHERE id = $1`,
      [input.billingAccountId],
    )).rows[0]
    if (!ba) {
      throw finError('REASON_CODE_REQUIRED', {
        category: CATEGORY.VALIDATION,
        details: { field: 'billingAccountId' },
      })
    }
    const tenantId = env.tenantId || ba.tenant_id
    await lockBillingPeriod(client, `${env.environment}:${input.billingAccountId}:${input.periodKey}`)
    const id = randomUUID()
    try {
      await client.query(
        `INSERT INTO fin.billing_periods (
           id, environment, tenant_id, billing_account_id, period_key,
           starts_at, ends_at, status, reason_code,
           created_at, created_by_actor_type, created_by_actor_id,
           updated_at, updated_by_actor_type, updated_by_actor_id
         ) VALUES ($1,$2,$3,$4,$5,$6,$7,'OPEN',$8,$9,$10,$11,$9,$10,$11)`,
        [
          id, env.environment, tenantId, input.billingAccountId, input.periodKey,
          isoOrThrow(input.startsAt), isoOrThrow(input.endsAt), env.reasonCode,
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
      throw mapBillingPgError(error)
    }
    const period = await loadPeriod(client, id)
    await writeStatus(client, env, { ...period, status: null, version: 1 }, 'OPEN')
    return finish(client, claimed, env, { periodId: id, status: 'OPEN' })
  })
}

function isoOrThrow(value) {
  if (!value) {
    throw finError('REASON_CODE_REQUIRED', {
      category: CATEGORY.VALIDATION,
      details: { reason: 'timestamp_required' },
    })
  }
  if (value instanceof Date) return value.toISOString()
  return String(value)
}

export async function reopenBillingPeriod(input) {
  const env = envelope(input)
  requireReason(env.reasonCode)
  const periodId = input.billingPeriodId || input.periodId
  if (!periodId) {
    throw finError('REASON_CODE_REQUIRED', {
      category: CATEGORY.VALIDATION,
      details: { field: 'billingPeriodId' },
    })
  }
  return withRetry(async (client) => {
    await lockBillingPeriod(client, periodId)
    const period = await loadPeriod(client, periodId)
    if (!period) {
      throw finError('BILLING_PERIOD_SKIP', { category: CATEGORY.PRECONDITION })
    }
    let to
    if (period.status === 'USAGE_CLOSING') {
      to = 'OPEN'
    } else if (period.status === 'INVOICE_DRAFTED') {
      to = 'RATING_CLOSED'
    } else if (period.status === 'INVOICED' || period.status === 'FINAL') {
      throw finError('BILLING_PERIOD_REOPEN_AFTER_ISSUE', { category: CATEGORY.PRECONDITION })
    } else {
      throw finError('BILLING_PERIOD_SKIP', {
        category: CATEGORY.PRECONDITION,
        details: { status: period.status },
      })
    }
    const key = env.idempotencyKey || `BP:REOPEN:${periodId}:v${period.version}`
    const claimed = await claim(client, env, key, {
      cmd: 'ReopenBillingPeriod', periodId, from: period.status, to,
    })
    if (claimed.kind === 'replay') return claimed.row.response_body

    if (period.status === 'INVOICE_DRAFTED') {
      const issued = await client.query(
        `SELECT id FROM fin.invoices
          WHERE billing_period_id = $1 AND status NOT IN ('DRAFT', 'VOID')
          LIMIT 1`,
        [periodId],
      )
      if (issued.rowCount) {
        throw finError('BILLING_PERIOD_REOPEN_AFTER_ISSUE', { category: CATEGORY.PRECONDITION })
      }
      await client.query(
        `UPDATE fin.invoices
            SET status = 'VOID', reason_code = $2,
                updated_at = $3, updated_by_actor_type = $4, updated_by_actor_id = $5
          WHERE billing_period_id = $1 AND status IN ('DRAFT', 'APPROVED')`,
        [periodId, env.reasonCode, env.now, env.actorType, env.actorId],
      )
    }
    try {
      await client.query(
        `UPDATE fin.billing_periods
            SET status = $2, reason_code = $3, updated_at = $4,
                updated_by_actor_type = $5, updated_by_actor_id = $6
          WHERE id = $1`,
        [periodId, to, env.reasonCode, env.now, env.actorType, env.actorId],
      )
    } catch (error) {
      throw mapBillingPgError(error)
    }
    await writeStatus(client, env, period, to, { reopened: true })
    return finish(client, claimed, env, { periodId, status: to, reopened: true })
  })
}

export async function flipBillingPeriod(client, env, period, to) {
  try {
    await client.query(
      `UPDATE fin.billing_periods
          SET status = $2, reason_code = $3, updated_at = $4,
              updated_by_actor_type = $5, updated_by_actor_id = $6
        WHERE id = $1`,
      [period.id, to, env.reasonCode, env.now, env.actorType, env.actorId],
    )
  } catch (error) {
    throw mapBillingPgError(error)
  }
  await writeStatus(client, env, period, to)
  return { periodId: period.id, status: to }
}

export { loadPeriod, writeStatus }
