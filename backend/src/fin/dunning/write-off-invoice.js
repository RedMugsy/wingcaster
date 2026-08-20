/**
 * WriteOffInvoice (B §6 WRITE_OFF_REVIEW → WRITTEN_OFF / C §5.14).
 * INSERTs BAD_DEBT_WRITE_OFF only. Does NOT reverse REVENUE_RECOGNIZED.
 * Does NOT insert REFUND_REVENUE_REVERSED. Does NOT touch CONSUMED postings.
 *
 * DL-121: invoices don't exist yet. invoice_id is a UUID argument; amount
 * comes from the caller fixture. Fully functional after Stage 10 fin.invoices.
 */
import { randomUUID } from 'node:crypto'
import { CATEGORY, finError } from '../errors.js'
import { recordCreditLoss } from '../accounting/credit-loss.js'
import { insertAudit, insertOutbox } from '../ledger/write.js'
import { claim, envelope, finish, requireReason, withRetry } from '../postpaid/helpers.js'
import { loadCase } from './cases.js'

export async function writeOffInvoice(input) {
  const env = envelope(input)
  requireReason(env.reasonCode)
  const invoiceId = input.invoiceId
  const amountMinor = input.amountMinor ?? input.amount_minor
  if (!invoiceId) {
    throw finError('REASON_CODE_REQUIRED', {
      category: CATEGORY.VALIDATION,
      details: { field: 'invoiceId' },
    })
  }
  if (amountMinor == null) {
    throw finError('REASON_CODE_REQUIRED', {
      category: CATEGORY.VALIDATION,
      details: { field: 'amountMinor' },
    })
  }
  const key = env.idempotencyKey || `WOFF:${invoiceId}`
  return withRetry(async (client) => {
    const claimed = await claim(client, env, key, {
      cmd: 'WriteOffInvoice', invoiceId, amountMinor: String(amountMinor),
    })
    if (claimed.kind === 'replay') return claimed.row.response_body

    const approvalId = input.approvalRequestId
    if (approvalId) {
      const { rows } = await client.query(
        `SELECT * FROM fin.approval_requests WHERE id = $1`,
        [approvalId],
      )
      const approval = rows[0]
      if (
        !approval
        || approval.action_kind !== 'WRITE_OFF'
        || !['APPROVED', 'EXECUTED'].includes(approval.status)
      ) {
        throw finError('ACCOUNTING_WRITE_OFF_UNAPPROVED', { category: CATEGORY.APPROVAL })
      }
    } else if (env.actorType === 'USER') {
      throw finError('ACCOUNTING_WRITE_OFF_UNAPPROVED', { category: CATEGORY.APPROVAL })
    }

    let dunningCase = null
    if (input.caseId) {
      dunningCase = await loadCase(client, input.caseId)
    } else {
      const found = await client.query(
        `SELECT * FROM fin.dunning_cases
          WHERE environment = $1 AND invoice_id = $2
          ORDER BY created_at DESC LIMIT 1`,
        [env.environment, invoiceId],
      )
      dunningCase = found.rows[0] || null
    }

    if (dunningCase) {
      if (dunningCase.status !== 'WRITE_OFF_REVIEW') {
        throw finError('DUNNING_STEP_SKIP', {
          category: CATEGORY.PRECONDITION,
          details: { status: dunningCase.status },
        })
      }
      await client.query(
        `UPDATE fin.dunning_cases
            SET status = 'WRITTEN_OFF', reason_code = $2, updated_at = $3,
                updated_by_actor_type = $4, updated_by_actor_id = $5
          WHERE id = $1`,
        [dunningCase.id, env.reasonCode, env.now, env.actorType, env.actorId],
      )
      await client.query(
        `INSERT INTO fin.dunning_steps (
           id, environment, tenant_id, case_id, step_kind, entered_at, completed_at,
           outcome, reason_code
         ) VALUES ($1,$2,$3,$4,'WRITE_OFF_REVIEW',$5,$5,'WRITTEN_OFF',$6)`,
        [
          randomUUID(), env.environment, dunningCase.tenant_id, dunningCase.id,
          env.now, env.reasonCode,
        ],
      )
    }

    const baId = input.billingAccountId || dunningCase?.billing_account_id
    const ba = baId
      ? (await client.query(
        `SELECT seller_legal_entity_id, tenant_id, billing_currency
           FROM fin.billing_accounts WHERE id = $1`,
        [baId],
      )).rows[0]
      : null

    const loss = await recordCreditLoss(client, {
      invoiceId,
      amountMinor,
      currency: input.currency || ba?.billing_currency || 'USD',
      tenantId: env.tenantId || dunningCase?.tenant_id || ba?.tenant_id,
      billingAccountId: baId,
      legalEntityId: input.legalEntityId || ba?.seller_legal_entity_id,
      environment: env.environment,
      now: env.now,
      actor: { type: env.actorType, id: env.actorId, email: env.actorEmail },
    })

    await insertOutbox(client, {
      environment: env.environment,
      topic: 'fin.dunning.step',
      dedupeKey: `dunning:${dunningCase?.id || invoiceId}:WRITTEN_OFF`,
      payload: { invoice_id: invoiceId, status: 'WRITTEN_OFF' },
      now: env.now,
    })
    await insertAudit(client, {
      environment: env.environment,
      actorType: env.actorType,
      actorId: env.actorId,
      actorEmail: env.actorEmail,
      action: 'INVOICE_UNCOLLECTIBLE',
      targetType: 'INVOICE',
      targetId: invoiceId,
      afterState: {
        status: 'UNCOLLECTIBLE',
        dunning: 'WRITTEN_OFF',
        eventIds: loss.events.map((e) => e.id),
      },
      reasonCode: env.reasonCode,
      approvalRequestId: approvalId || null,
      now: env.now,
    })
    return finish(client, claimed, env, {
      invoiceId,
      status: 'WRITTEN_OFF',
      events: loss.events,
    })
  })
}
