/**
 * Dunning case commands (B §6). invoice_id is a UUID argument (no fin.invoices
 * table yet — DL-109). controls_snapshot taken at OPEN (DL-107 / DL-036).
 */
import { CATEGORY, finError } from '../errors.js'
import { insertAudit, insertOutbox } from '../ledger/write.js'
import { randomUUID } from 'node:crypto'
import {
  claim, envelope, finish, requireReason, withRetry,
} from '../postpaid/helpers.js'

export const OPEN_STATUSES = new Set([
  'OPEN', 'REMINDING', 'REMIND_ESCALATED', 'CREDIT_PAUSED',
  'USAGE_SUSPENDED', 'LEGAL', 'WRITE_OFF_REVIEW',
])

export async function loadCase(client, caseId) {
  const { rows } = await client.query(
    `SELECT * FROM fin.dunning_cases WHERE id = $1`,
    [caseId],
  )
  return rows[0] || null
}

export async function snapshotControls(client, { environment, billingAccountId }) {
  const { rows } = await client.query(
    `SELECT allow_prepaid_usage, allow_postpaid_usage, allow_purchases,
            allow_transfers, allow_refunds, allow_grants
       FROM fin.account_controls
      WHERE environment = $1
        AND subject_type = 'BILLING_ACCOUNT'
        AND subject_id = $2
      LIMIT 1`,
    [environment, billingAccountId],
  )
  return rows[0] || {
    allow_prepaid_usage: true,
    allow_postpaid_usage: true,
    allow_purchases: true,
    allow_transfers: true,
    allow_refunds: true,
    allow_grants: true,
  }
}

export async function restoreControlsSnapshot(client, env, dunningCase) {
  const snap = dunningCase.controls_snapshot
  if (!snap || typeof snap !== 'object') return
  await client.query(
    `UPDATE fin.account_controls
        SET allow_prepaid_usage = $3,
            allow_postpaid_usage = $4,
            allow_purchases = $5,
            allow_transfers = COALESCE($6, allow_transfers),
            allow_refunds = COALESCE($7, allow_refunds),
            allow_grants = COALESCE($8, allow_grants),
            reason_code = $9,
            updated_at = $10,
            updated_by_actor_type = $11,
            updated_by_actor_id = $12
      WHERE environment = $1
        AND subject_type = 'BILLING_ACCOUNT'
        AND subject_id = $2`,
    [
      env.environment, dunningCase.billing_account_id,
      snap.allow_prepaid_usage, snap.allow_postpaid_usage, snap.allow_purchases,
      snap.allow_transfers ?? true, snap.allow_refunds ?? true, snap.allow_grants ?? true,
      env.reasonCode, env.now, env.actorType, env.actorId,
    ],
  )
}

export async function openDunningCase(input) {
  const env = envelope(input)
  requireReason(env.reasonCode)
  const invoiceStatus = input.invoiceStatus
  if (!['ISSUED', 'PART_PAID'].includes(invoiceStatus)) {
    throw finError('DUNNING_STEP_SKIP', {
      category: CATEGORY.PRECONDITION,
      details: { reason: 'invoice_not_overdue_status', invoiceStatus },
    })
  }
  if (!input.dueAt || new Date(input.dueAt) >= new Date(env.now)) {
    throw finError('DUNNING_STEP_SKIP', {
      category: CATEGORY.PRECONDITION,
      details: { reason: 'invoice_not_past_due' },
    })
  }
  const key = env.idempotencyKey || `DUNNING:OPEN:${input.invoiceId}`
  return withRetry(async (client) => {
    const claimed = await claim(client, env, key, {
      cmd: 'OpenDunningCase', invoiceId: input.invoiceId,
    })
    if (claimed.kind === 'replay') return claimed.row.response_body

    const existing = await client.query(
      `SELECT id FROM fin.dunning_cases
        WHERE environment = $1 AND invoice_id = $2
          AND status NOT IN ('CURED', 'WRITTEN_OFF', 'CANCELED')
        LIMIT 1`,
      [env.environment, input.invoiceId],
    )
    if (existing.rowCount) {
      throw finError('DUNNING_STEP_SKIP', {
        category: CATEGORY.PRECONDITION,
        details: { reason: 'open_case_exists', caseId: existing.rows[0].id },
      })
    }

    const snapshot = await snapshotControls(client, {
      environment: env.environment,
      billingAccountId: input.billingAccountId,
    })
    const id = randomUUID()
    await client.query(
      `INSERT INTO fin.dunning_cases (
         id, environment, tenant_id, billing_account_id, invoice_id, status,
         controls_snapshot, policy_delay_ms, reason_code,
         created_at, created_by_actor_type, created_by_actor_id,
         updated_at, updated_by_actor_type, updated_by_actor_id
       ) VALUES ($1,$2,$3,$4,$5,'OPEN',$6::jsonb,$7,$8,$9,$10,$11,$9,$10,$11)`,
      [
        id, env.environment, env.tenantId, input.billingAccountId, input.invoiceId,
        JSON.stringify(snapshot), input.policyDelayMs ?? 0, env.reasonCode,
        env.now, env.actorType, env.actorId,
      ],
    )
    await insertOutbox(client, {
      environment: env.environment,
      topic: 'fin.dunning.step',
      dedupeKey: `dunning:${id}:OPEN`,
      payload: { case_id: id, status: 'OPEN' },
      now: env.now,
    })
    await insertAudit(client, {
      environment: env.environment,
      actorType: env.actorType,
      actorId: env.actorId,
      actorEmail: env.actorEmail,
      action: 'DUNNING_OPENED',
      targetType: 'DUNNING_CASE',
      targetId: id,
      afterState: { status: 'OPEN', invoice_id: input.invoiceId },
      reasonCode: env.reasonCode,
      now: env.now,
    })
    return finish(client, claimed, env, { caseId: id, status: 'OPEN' })
  })
}

async function closeCase(input, to, stepKind) {
  const env = envelope(input)
  requireReason(env.reasonCode)
  const caseId = input.caseId
  const key = env.idempotencyKey || `DUNNING:${to}:${caseId}`
  return withRetry(async (client) => {
    const claimed = await claim(client, env, key, { cmd: to, caseId })
    if (claimed.kind === 'replay') return claimed.row.response_body
    const row = await loadCase(client, caseId)
    if (!row || !OPEN_STATUSES.has(row.status)) {
      throw finError('DUNNING_STEP_SKIP', {
        category: CATEGORY.PRECONDITION,
        details: { status: row?.status },
      })
    }
    await restoreControlsSnapshot(client, env, row)
    await client.query(
      `UPDATE fin.dunning_cases
          SET status = $2, reason_code = $3, updated_at = $4,
              updated_by_actor_type = $5, updated_by_actor_id = $6
        WHERE id = $1`,
      [caseId, to, env.reasonCode, env.now, env.actorType, env.actorId],
    )
    await client.query(
      `INSERT INTO fin.dunning_steps (
         id, environment, tenant_id, case_id, step_kind, entered_at, completed_at,
         outcome, reason_code
       ) VALUES ($1,$2,$3,$4,$5,$6,$6,'OK',$7)`,
      [randomUUID(), env.environment, row.tenant_id, caseId, stepKind, env.now, env.reasonCode],
    )
    await insertOutbox(client, {
      environment: env.environment,
      topic: 'fin.dunning.step',
      dedupeKey: `dunning:${caseId}:${to}`,
      payload: { case_id: caseId, status: to },
      now: env.now,
    })
    return finish(client, claimed, env, { caseId, status: to })
  })
}

export function cancelDunningCase(input) {
  return closeCase(input, 'CANCELED', 'CANCEL')
}

export function cureDunning(input) {
  return closeCase(input, 'CURED', 'CURE')
}
