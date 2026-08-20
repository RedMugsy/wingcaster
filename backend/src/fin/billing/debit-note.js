/**
 * Debit notes (B §17 / C §5.18). Sequence doc_type=DEBIT_NOTE.
 * Default: invoice_adjustments only; no ledger tx.
 */
import { randomUUID } from 'node:crypto'
import { CATEGORY, finError } from '../errors.js'
import { insertAudit, insertOutbox } from '../ledger/write.js'
import {
  assignSequence, claim, envelope, finish, loadLegalEntity, mapBillingPgError,
  requireReason, withRetry,
} from './helpers.js'
import { loadInvoice } from './invoice-issuer.js'
import { voidIssuedNote } from './credit-note.js'

async function loadNote(client, noteId) {
  const { rows } = await client.query(
    `SELECT * FROM fin.debit_notes WHERE id = $1 FOR UPDATE`,
    [noteId],
  )
  return rows[0] || null
}

export async function draftDebitNote(input) {
  const env = envelope(input)
  requireReason(env.reasonCode)
  const invoiceId = input.invoiceId
  const amount = BigInt(input.amount ?? input.amountMinor ?? 0)
  if (!invoiceId || amount <= 0n) {
    throw finError('REASON_CODE_REQUIRED', {
      category: CATEGORY.VALIDATION,
      details: { field: amount <= 0n ? 'amount' : 'invoiceId' },
    })
  }
  const key = env.idempotencyKey || `DN:DRAFT:${invoiceId}:${amount}:${input.clientKey || '1'}`
  return withRetry(async (client) => {
    const claimed = await claim(client, env, key, {
      cmd: 'DraftDebitNote', invoiceId, amount: amount.toString(),
    })
    if (claimed.kind === 'replay') return claimed.row.response_body
    const invoice = await loadInvoice(client, invoiceId, { forUpdate: true })
    if (!invoice || !['ISSUED', 'PART_PAID', 'PAID', 'UNCOLLECTIBLE'].includes(invoice.status)) {
      throw finError('NOTE_PARENT_NOT_ISSUED', { category: CATEGORY.PRECONDITION })
    }
    env.tenantId = env.tenantId || invoice.tenant_id
    const id = randomUUID()
    await client.query(
      `INSERT INTO fin.debit_notes (
         id, environment, tenant_id, invoice_id, legal_entity_id,
         status, amount_minor, currency, reason_code,
         created_at, created_by_actor_type, created_by_actor_id,
         updated_at, updated_by_actor_type, updated_by_actor_id
       ) VALUES ($1,$2,$3,$4,$5,'DRAFT',$6,$7,$8,$9,$10,$11,$9,$10,$11)`,
      [
        id, env.environment, invoice.tenant_id, invoiceId, invoice.legal_entity_id,
        amount.toString(), invoice.currency, input.reason || env.reasonCode,
        env.now, env.actorType, env.actorId,
      ],
    )
    return finish(client, claimed, env, { noteId: id, status: 'DRAFT', amountMinor: amount.toString() })
  })
}

export async function approveDebitNote(input) {
  const env = envelope(input)
  requireReason(env.reasonCode)
  const noteId = input.noteId
  return withRetry(async (client) => {
    const note = await loadNote(client, noteId)
    if (!note) throw finError('NOTE_PARENT_NOT_ISSUED', { category: CATEGORY.PRECONDITION })
    const key = env.idempotencyKey || `DN:APPROVE:${noteId}:v${note.version}`
    const claimed = await claim(client, env, key, { cmd: 'ApproveDebitNote', noteId })
    if (claimed.kind === 'replay') return claimed.row.response_body
    if (note.status !== 'DRAFT') {
      throw finError('NOTE_PARENT_NOT_ISSUED', {
        category: CATEGORY.PRECONDITION,
        details: { status: note.status },
      })
    }
    await client.query(
      `UPDATE fin.debit_notes
          SET status = 'APPROVED', updated_at = $2,
              updated_by_actor_type = $3, updated_by_actor_id = $4
        WHERE id = $1`,
      [noteId, env.now, env.actorType, env.actorId],
    )
    return finish(client, claimed, env, { noteId, status: 'APPROVED' })
  })
}

export async function issueDebitNote(input) {
  const env = envelope(input)
  requireReason(env.reasonCode)
  const noteId = input.noteId
  const fiscalContext = input.fiscalContext || '2026'
  return withRetry(async (client) => {
    const note = await loadNote(client, noteId)
    if (!note) throw finError('NOTE_PARENT_NOT_ISSUED', { category: CATEGORY.PRECONDITION })
    const key = env.idempotencyKey || `DN:${noteId}`
    const claimed = await claim(client, env, key, { cmd: 'IssueDebitNote', noteId })
    if (claimed.kind === 'replay') return claimed.row.response_body
    if (note.status !== 'APPROVED') {
      throw finError('NOTE_PARENT_NOT_ISSUED', {
        category: CATEGORY.PRECONDITION,
        details: { status: note.status },
      })
    }
    const invoice = await loadInvoice(client, note.invoice_id, { forUpdate: true })
    if (!invoice || invoice.status === 'VOID') {
      throw finError('NOTE_PARENT_NOT_ISSUED', { category: CATEGORY.PRECONDITION })
    }
    const legal = await loadLegalEntity(client, note.legal_entity_id)
    const seq = await assignSequence(client, {
      environment: env.environment,
      legalEntityId: note.legal_entity_id,
      jurisdiction: input.jurisdiction || legal?.jurisdiction || 'SA',
      docType: 'DEBIT_NOTE',
      fiscalContext,
      now: env.now,
    })
    try {
      await client.query(
        `UPDATE fin.debit_notes
            SET status = 'ISSUED', note_number = $2, invoice_sequence_id = $3,
                issued_at = $4, updated_at = $4,
                updated_by_actor_type = $5, updated_by_actor_id = $6
          WHERE id = $1`,
        [noteId, seq.number, seq.sequenceId, env.now, env.actorType, env.actorId],
      )
    } catch (error) {
      throw mapBillingPgError(error)
    }
    await client.query(
      `INSERT INTO fin.invoice_adjustments (
         id, environment, tenant_id, invoice_id, debit_note_id, amount_minor,
         reason_code, created_at, created_by_actor_type, created_by_actor_id
       ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
      [
        randomUUID(), env.environment, note.tenant_id, note.invoice_id, noteId,
        String(note.amount_minor), env.reasonCode,
        env.now, env.actorType, env.actorId,
      ],
    )
    await insertOutbox(client, {
      environment: env.environment,
      topic: 'fin.debit_note.status',
      dedupeKey: `dn:${noteId}:ISSUED:${note.version || 1}`,
      payload: { noteId, status: 'ISSUED', noteNumber: seq.number },
      now: env.now,
    })
    await insertAudit(client, {
      environment: env.environment,
      actorType: env.actorType, actorId: env.actorId, actorEmail: env.actorEmail,
      action: 'DEBIT_NOTE_ISSUED', targetType: 'DEBIT_NOTE', targetId: noteId,
      afterState: { status: 'ISSUED', noteNumber: seq.number },
      reasonCode: env.reasonCode, now: env.now,
    })
    return finish(client, claimed, env, {
      noteId, status: 'ISSUED', noteNumber: seq.number, assigned: seq.assigned,
    })
  })
}

export function voidIssuedDebitNote(input) {
  return voidIssuedNote({ ...input, table: 'debit_notes' })
}
