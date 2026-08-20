/**
 * One dunning machine step per invocation (B §6). APPEND_ONLY steps.
 * Control flips: REMIND / REMIND_ESCALATED none; PAUSE_NEW_CREDIT → allow_purchases=false;
 * SUSPEND_USAGE → both usage flags false; LEGAL_ESCALATION / WRITE_OFF_REVIEW none.
 */
import { CATEGORY, finError } from '../errors.js'
import { insertOutbox } from '../ledger/write.js'
import { randomUUID } from 'node:crypto'
import {
  claim, envelope, finish, requireReason, withRetry,
} from '../postpaid/helpers.js'
import { loadCase, OPEN_STATUSES } from './cases.js'

const CHAIN = [
  { from: 'OPEN', to: 'REMINDING', kind: 'REMIND', flip: null },
  { from: 'REMINDING', to: 'REMIND_ESCALATED', kind: 'REMIND_ESCALATED', flip: null },
  { from: 'REMIND_ESCALATED', to: 'CREDIT_PAUSED', kind: 'PAUSE_NEW_CREDIT', flip: 'PAUSE_NEW_CREDIT' },
  { from: 'CREDIT_PAUSED', to: 'USAGE_SUSPENDED', kind: 'SUSPEND_USAGE', flip: 'SUSPEND_USAGE' },
  { from: 'USAGE_SUSPENDED', to: 'LEGAL', kind: 'LEGAL_ESCALATION', flip: null },
  { from: 'LEGAL', to: 'WRITE_OFF_REVIEW', kind: 'WRITE_OFF_REVIEW', flip: null },
]

async function lastStep(client, caseId) {
  const { rows } = await client.query(
    `SELECT * FROM fin.dunning_steps
      WHERE case_id = $1 AND step_kind <> 'ERROR'
      ORDER BY entered_at DESC, id DESC
      LIMIT 1`,
    [caseId],
  )
  return rows[0] || null
}

async function applyFlip(client, env, dunningCase, flip) {
  if (flip === 'PAUSE_NEW_CREDIT') {
    await client.query(
      `UPDATE fin.account_controls
          SET allow_purchases = false, reason_code = $3, updated_at = $4,
              updated_by_actor_type = $5, updated_by_actor_id = $6
        WHERE environment = $1 AND subject_type = 'BILLING_ACCOUNT' AND subject_id = $2`,
      [env.environment, dunningCase.billing_account_id, env.reasonCode, env.now, env.actorType, env.actorId],
    )
  }
  if (flip === 'SUSPEND_USAGE') {
    await client.query(
      `UPDATE fin.account_controls
          SET allow_prepaid_usage = false, allow_postpaid_usage = false,
              reason_code = $3, updated_at = $4,
              updated_by_actor_type = $5, updated_by_actor_id = $6
        WHERE environment = $1 AND subject_type = 'BILLING_ACCOUNT' AND subject_id = $2`,
      [env.environment, dunningCase.billing_account_id, env.reasonCode, env.now, env.actorType, env.actorId],
    )
  }
}

export async function advanceDunning(input) {
  const env = envelope(input)
  requireReason(env.reasonCode)
  const caseId = input.caseId
  const key = env.idempotencyKey || `DUNNING:ADVANCE:${caseId}:${env.now}`
  return withRetry(async (client) => {
    const claimed = await claim(client, env, key, { cmd: 'AdvanceDunning', caseId, at: env.now })
    if (claimed.kind === 'replay') return claimed.row.response_body

    const row = await client.query(
      `SELECT * FROM fin.dunning_cases WHERE id = $1 FOR UPDATE`,
      [caseId],
    )
    const dunningCase = row.rows[0]
    if (!dunningCase || !OPEN_STATUSES.has(dunningCase.status)) {
      throw finError('DUNNING_STEP_SKIP', {
        category: CATEGORY.PRECONDITION,
        details: { status: dunningCase?.status },
      })
    }
    if (dunningCase.status === 'WRITE_OFF_REVIEW') {
      throw finError('DUNNING_STEP_SKIP', {
        category: CATEGORY.PRECONDITION,
        details: { reason: 'write_off_is_stage_10' },
      })
    }
    const step = CHAIN.find((s) => s.from === dunningCase.status)
    if (!step) {
      throw finError('DUNNING_STEP_SKIP', { category: CATEGORY.PRECONDITION })
    }

    const prior = await lastStep(client, caseId)
    const anchor = prior?.completed_at || dunningCase.created_at
    const delayMs = Number(dunningCase.policy_delay_ms || 0)
    if (delayMs > 0 && Date.parse(anchor) + delayMs > Date.parse(env.now)) {
      throw finError('DUNNING_STEP_SKIP', {
        category: CATEGORY.PRECONDITION,
        details: { reason: 'policy_delay_not_elapsed' },
      })
    }

    await applyFlip(client, env, dunningCase, step.flip)
    await client.query(
      `INSERT INTO fin.dunning_steps (
         id, environment, tenant_id, case_id, step_kind, entered_at, completed_at,
         outcome, reason_code
       ) VALUES ($1,$2,$3,$4,$5,$6,$6,'OK',$7)`,
      [randomUUID(), env.environment, dunningCase.tenant_id, caseId, step.kind, env.now, env.reasonCode],
    )
    await client.query(
      `UPDATE fin.dunning_cases
          SET status = $2, reason_code = $3, updated_at = $4,
              updated_by_actor_type = $5, updated_by_actor_id = $6
        WHERE id = $1`,
      [caseId, step.to, env.reasonCode, env.now, env.actorType, env.actorId],
    )
    await insertOutbox(client, {
      environment: env.environment,
      topic: 'fin.dunning.step',
      dedupeKey: `dunning:${caseId}:${step.to}:${dunningCase.version}`,
      payload: { case_id: caseId, from: dunningCase.status, to: step.to, kind: step.kind },
      now: env.now,
    })
    return finish(client, claimed, env, {
      caseId,
      status: step.to,
      stepKind: step.kind,
    })
  })
}

export async function logDunningError(client, env, caseId, error) {
  const row = await loadCase(client, caseId)
  if (!row) return
  await client.query(
    `INSERT INTO fin.dunning_steps (
       id, environment, tenant_id, case_id, step_kind, entered_at, completed_at,
       outcome, reason_code
     ) VALUES ($1,$2,$3,$4,'ERROR',$5,$5,'ERROR',$6)`,
    [randomUUID(), env.environment, row.tenant_id, caseId, env.now,
      String(error.code || error.message).slice(0, 200)],
  )
}

export { CHAIN }
