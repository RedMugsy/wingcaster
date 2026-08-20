/**
 * Credit notes (B §17 / C §5.17). Sequence doc_type=CREDIT_NOTE.
 * INSERT invoice_adjustments on ISSUE. Parent may go PAID → PART_PAID.
 */
import { randomUUID } from 'node:crypto'
import { CATEGORY, finError } from '../errors.js'
import { insertAudit, insertOutbox } from '../ledger/write.js'
import {
  assignSequence, claim, envelope, finish, loadLegalEntity, mapBillingPgError,
  requireApproval, requireReason, withRetry,
} from './helpers.js'
import { loadInvoice, writeInvoiceStatus } from './invoice-issuer.js'

async function loadNote(client, noteId) {
  const { rows } = await client.query(
    `SELECT * FROM fin.credit_notes WHERE id = $1 FOR UPDATE`,
    [noteId],
  )
  return rows[0] || null
}

export async function draftCreditNote(input) {
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
  const key = env.idempotencyKey || `CN:DRAFT:${invoiceId}:${amount}:${input.clientKey || '1'}`
  return withRetry(async (client) => {
    const claimed = await claim(client, env, key, {
      cmd: 'DraftCreditNote', invoiceId, amount: amount.toString(),
    })
    if (claimed.kind === 'replay') return claimed.row.response_body
    const invoice = await loadInvoice(client, invoiceId, { forUpdate: true })
    if (!invoice || !['ISSUED', 'PART_PAID', 'PAID', 'UNCOLLECTIBLE'].includes(invoice.status)) {
      throw finError('NOTE_PARENT_NOT_ISSUED', { category: CATEGORY.PRECONDITION })
    }
    const existing = await client.query(
      `SELECT COALESCE(SUM(amount_minor), 0)::bigint AS qty
         FROM fin.credit_notes
        WHERE invoice_id = $1 AND status IN ('DRAFT', 'APPROVED', 'ISSUED')`,
      [invoiceId],
    )
    if (BigInt(existing.rows[0].qty) + amount > BigInt(invoice.total_minor)) {
      throw finError('NOTE_EXCEEDS_INVOICE', { category: CATEGORY.PRECONDITION })
    }
    env.tenantId = env.tenantId || invoice.tenant_id
    const id = randomUUID()
    await client.query(
      `INSERT INTO fin.credit_notes (
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

export async function approveCreditNote(input) {
  const env = envelope(input)
  requireReason(env.reasonCode)
  const noteId = input.noteId
  return withRetry(async (client) => {
    const note = await loadNote(client, noteId)
    if (!note) throw finError('NOTE_PARENT_NOT_ISSUED', { category: CATEGORY.PRECONDITION })
    const key = env.idempotencyKey || `CN:APPROVE:${noteId}:v${note.version}`
    const claimed = await claim(client, env, key, { cmd: 'ApproveCreditNote', noteId })
    if (claimed.kind === 'replay') return claimed.row.response_body
    if (note.status !== 'DRAFT') {
      throw finError('NOTE_PARENT_NOT_ISSUED', {
        category: CATEGORY.PRECONDITION,
        details: { status: note.status },
      })
    }
    await client.query(
      `UPDATE fin.credit_notes
          SET status = 'APPROVED', updated_at = $2,
              updated_by_actor_type = $3, updated_by_actor_id = $4
        WHERE id = $1`,
      [noteId, env.now, env.actorType, env.actorId],
    )
    return finish(client, claimed, env, { noteId, status: 'APPROVED' })
  })
}

export async function issueCreditNote(input) {
  const env = envelope(input)
  requireReason(env.reasonCode)
  const noteId = input.noteId
  const fiscalContext = input.fiscalContext || '2026'
  return withRetry(async (client) => {
    const note = await loadNote(client, noteId)
    if (!note) throw finError('NOTE_PARENT_NOT_ISSUED', { category: CATEGORY.PRECONDITION })
    const key = env.idempotencyKey || `CN:${noteId}`
    const claimed = await claim(client, env, key, { cmd: 'IssueCreditNote', noteId })
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
      docType: 'CREDIT_NOTE',
      fiscalContext,
      now: env.now,
    })
    try {
      await client.query(
        `UPDATE fin.credit_notes
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
         id, environment, tenant_id, invoice_id, credit_note_id, amount_minor,
         reason_code, created_at, created_by_actor_type, created_by_actor_id
       ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
      [
        randomUUID(), env.environment, note.tenant_id, note.invoice_id, noteId,
        (-BigInt(note.amount_minor)).toString(), env.reasonCode,
        env.now, env.actorType, env.actorId,
      ],
    )
    const allocated = (await client.query(
      `SELECT COALESCE(SUM(amount_minor), 0)::bigint AS qty
         FROM fin.invoice_payment_allocations WHERE invoice_id = $1`,
      [invoice.id],
    )).rows[0]
    const net = BigInt(invoice.total_minor) - BigInt(note.amount_minor)
    if (invoice.status === 'PAID' && BigInt(allocated.qty) > net) {
      const updated = (await client.query(
        `UPDATE fin.invoices
            SET status = 'PART_PAID', updated_at = $2,
                updated_by_actor_type = $3, updated_by_actor_id = $4
          WHERE id = $1
          RETURNING *`,
        [invoice.id, env.now, env.actorType, env.actorId],
      )).rows[0]
      await writeInvoiceStatus(client, env, updated, 'PART_PAID')
    }
    await insertOutbox(client, {
      environment: env.environment,
      topic: 'fin.credit_note.status',
      dedupeKey: `cn:${noteId}:ISSUED:${note.version || 1}`,
      payload: { noteId, status: 'ISSUED', noteNumber: seq.number },
      now: env.now,
    })
    await insertAudit(client, {
      environment: env.environment,
      actorType: env.actorType, actorId: env.actorId, actorEmail: env.actorEmail,
      action: 'CREDIT_NOTE_ISSUED', targetType: 'CREDIT_NOTE', targetId: noteId,
      afterState: { status: 'ISSUED', noteNumber: seq.number },
      reasonCode: env.reasonCode, now: env.now,
    })
    return finish(client, claimed, env, {
      noteId, status: 'ISSUED', noteNumber: seq.number, assigned: seq.assigned,
    })
  })
}

export async function voidIssuedNote(input) {
  const env = envelope(input)
  requireReason(env.reasonCode)
  const noteId = input.noteId
  const table = input.table === 'debit_notes' ? 'debit_notes' : 'credit_notes'
  const qualified = table === 'debit_notes' ? 'fin.debit_notes' : 'fin.credit_notes'
  return withRetry(async (client) => {
    const { rows } = await client.query(
      `SELECT * FROM ${qualified} WHERE id = $1 FOR UPDATE`,
      [noteId],
    )
    const note = rows[0]
    if (!note) throw finError('NOTE_PARENT_NOT_ISSUED', { category: CATEGORY.PRECONDITION })
    const key = env.idempotencyKey || `NOTE:VOID:${noteId}:v${note.version}`
    const claimed = await claim(client, env, key, { cmd: 'VoidIssuedNote', noteId, table })
    if (claimed.kind === 'replay') return claimed.row.response_body
    await requireApproval(client, {
      approvalId: input.approvalRequestId,
      actionKind: 'INVOICE_VOID',
      actorType: env.actorType,
    })
    if (input.jurisdictionForbidden) {
      throw finError('NOTE_VOID_FORBIDDEN', { category: CATEGORY.PRECONDITION })
    }
    const legal = await loadLegalEntity(client, note.legal_entity_id)
    if (legal?.jurisdiction === 'XX') {
      throw finError('NOTE_VOID_FORBIDDEN', { category: CATEGORY.PRECONDITION })
    }
    if (note.status !== 'ISSUED' && !['DRAFT', 'APPROVED'].includes(note.status)) {
      throw finError('NOTE_PARENT_NOT_ISSUED', {
        category: CATEGORY.PRECONDITION,
        details: { status: note.status },
      })
    }
    await client.query(
      `UPDATE ${qualified}
          SET status = 'VOID', reason_code = $2, updated_at = $3,
              updated_by_actor_type = $4, updated_by_actor_id = $5
        WHERE id = $1`,
      [noteId, env.reasonCode, env.now, env.actorType, env.actorId],
    )
    const topic = table === 'debit_notes' ? 'fin.debit_note.status' : 'fin.credit_note.status'
    await insertOutbox(client, {
      environment: env.environment,
      topic,
      dedupeKey: `${table === 'debit_notes' ? 'dn' : 'cn'}:${noteId}:VOID:${note.version || 1}`,
      payload: { noteId, status: 'VOID', noteNumber: note.note_number },
      now: env.now,
    })
    return finish(client, claimed, env, {
      noteId, status: 'VOID', noteNumber: note.note_number,
    })
  })
}
