/**
 * Draft / approve / issue / void invoices (B §16 / C §5.6).
 * Sequence allocated ONLY on ISSUE. VOID keeps invoice_number (spec §124).
 * No ledger posting unless a rounding ADJUSTMENT is needed. No HTTP (I-14).
 */
import { randomUUID } from 'node:crypto'
import { CATEGORY, finError } from '../errors.js'
import { insertAudit, insertOutbox } from '../ledger/write.js'
import { resolveTax } from '../tax/service.js'
import { insertTaxSnapshot } from '../tax/snapshots.js'
import { assembleInvoiceForPeriod } from './invoice-assembler.js'
import {
  ISSUED_LIKE, assignSequence, claim, envelope, finish, loadLegalEntity,
  lockBillingPeriod, mapBillingPgError, requireApproval, requireReason, withRetry,
} from './helpers.js'
import { flipBillingPeriod, loadPeriod } from './periods.js'

async function loadInvoice(client, invoiceId, { forUpdate = false } = {}) {
  const sql = forUpdate
    ? `SELECT * FROM fin.invoices WHERE id = $1 FOR UPDATE`
    : `SELECT * FROM fin.invoices WHERE id = $1`
  const { rows } = await client.query(sql, [invoiceId])
  return rows[0] || null
}

async function writeInvoiceStatus(client, env, invoice, to, extra = {}) {
  // `invoice` MUST be the post-flip row (UPDATE … RETURNING *). trg_bump_version
  // increments version during the UPDATE; a stale pre-flip object reuses the
  // same dedupe key when a later flip lands on the same status (DL-148 / DL-100).
  await insertOutbox(client, {
    environment: env.environment,
    topic: 'fin.invoice.status',
    dedupeKey: `inv:${invoice.id}:${to}:${invoice.version || 1}`,
    payload: { invoiceId: invoice.id, status: to, ...extra },
    now: env.now,
  })
  if (to === 'ISSUED' || to === 'PAID' || to === 'VOID') {
    await insertOutbox(client, {
      environment: env.environment,
      topic: 'notification.lifecycle',
      dedupeKey: `inv:${invoice.id}:${to}:notify`,
      payload: { invoiceId: invoice.id, status: to },
      now: env.now,
    })
  }
  await insertAudit(client, {
    environment: env.environment,
    actorType: env.actorType,
    actorId: env.actorId,
    actorEmail: env.actorEmail,
    action: `INVOICE_${to}`,
    targetType: 'INVOICE',
    targetId: invoice.id,
    beforeState: { status: invoice.status },
    afterState: { status: to, ...extra },
    reasonCode: env.reasonCode,
    approvalRequestId: extra.approvalRequestId || null,
    now: env.now,
  })
}

async function insertLines(client, env, invoiceId, lines) {
  let lineNo = 0
  let subtotal = 0n
  for (const line of lines) {
    if (!line.sourceType || !line.sourceId) {
      throw finError('INVOICE_NOT_DRAFT', {
        category: CATEGORY.VALIDATION,
        details: { reason: 'sourceless_line' },
      })
    }
    lineNo += 1
    const amount = BigInt(line.amount_minor ?? line.amountMinor ?? 0)
    subtotal += amount
    await client.query(
      `INSERT INTO fin.invoice_lines (
         id, environment, tenant_id, invoice_id, line_no,
         source_type, source_id, description, quantity_units,
         unit_rate_minor, amount_minor, created_at
       ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`,
      [
        randomUUID(), env.environment, env.tenantId, invoiceId, lineNo,
        line.sourceType, line.sourceId,
        line.description || `${line.sourceType}:${line.sourceId}`,
        String(line.quantity ?? line.quantity_units ?? 0),
        String(line.unit_rate_minor ?? line.unitRateMinor ?? 0),
        amount.toString(),
        env.now,
      ],
    )
  }
  return { lineNo, subtotal }
}

export async function draftInvoice(input) {
  const env = envelope(input)
  requireReason(env.reasonCode)
  const billingPeriodId = input.billingPeriodId
  if (!billingPeriodId && !(input.lines && input.billingAccountId)) {
    throw finError('REASON_CODE_REQUIRED', {
      category: CATEGORY.VALIDATION,
      details: { field: 'billingPeriodId' },
    })
  }
  const key = env.idempotencyKey || `INV:DRAFT:${billingPeriodId || input.clientKey || randomUUID()}`
  return withRetry(async (client) => {
    const claimed = await claim(client, env, key, {
      cmd: 'DraftInvoice', billingPeriodId, clientKey: input.clientKey,
    })
    if (claimed.kind === 'replay') return claimed.row.response_body

    let period = null
    if (billingPeriodId) {
      await lockBillingPeriod(client, billingPeriodId)
      period = await loadPeriod(client, billingPeriodId)
      if (!period) {
        throw finError('BILLING_PERIOD_SKIP', { category: CATEGORY.PRECONDITION })
      }
      if (period.status !== 'RATING_CLOSED' && period.status !== 'INVOICE_DRAFTED') {
        throw finError('BILLING_PERIOD_SKIP', {
          category: CATEGORY.PRECONDITION,
          details: { status: period.status, expected: 'RATING_CLOSED' },
        })
      }
    }

    const assembled = billingPeriodId
      ? await assembleInvoiceForPeriod(client, { billingPeriodId })
      : { lines: input.lines || [] }
    const lines = (input.lines && input.lines.length) ? input.lines : assembled.lines
    if (!lines.length) {
      throw finError('INVOICE_NOT_DRAFT', {
        category: CATEGORY.VALIDATION,
        details: { reason: 'no_lines' },
      })
    }

    const baId = input.billingAccountId || period.billing_account_id
    const ba = (await client.query(
      `SELECT * FROM fin.billing_accounts WHERE id = $1`,
      [baId],
    )).rows[0]
    const tenantId = env.tenantId || period?.tenant_id || ba.tenant_id
    env.tenantId = tenantId
    const legalEntityId = input.legalEntityId || ba.seller_legal_entity_id
    const currency = input.currency || ba.billing_currency
    const dueAt = input.dueAt || null
    const id = randomUUID()
    const { subtotal } = await (async () => {
      await client.query(
        `INSERT INTO fin.invoices (
           id, environment, tenant_id, billing_account_id, legal_entity_id,
           billing_period_id, status, currency, subtotal_minor, tax_minor, total_minor,
           due_at, reason_code,
           created_at, created_by_actor_type, created_by_actor_id,
           updated_at, updated_by_actor_type, updated_by_actor_id
         ) VALUES ($1,$2,$3,$4,$5,$6,'DRAFT',$7,0,0,0,$8,$9,$10,$11,$12,$10,$11,$12)`,
        [
          id, env.environment, tenantId, baId, legalEntityId,
          billingPeriodId || null, currency, dueAt, env.reasonCode,
          env.now, env.actorType, env.actorId,
        ],
      )
      return insertLines(client, env, id, lines)
    })()

    const drafted = (await client.query(
      `UPDATE fin.invoices
          SET subtotal_minor = $2, tax_minor = 0, total_minor = $2, updated_at = $3
        WHERE id = $1
        RETURNING *`,
      [id, subtotal.toString(), env.now],
    )).rows[0]
    if (period && period.status === 'RATING_CLOSED') {
      await flipBillingPeriod(client, env, period, 'INVOICE_DRAFTED')
    }
    await writeInvoiceStatus(client, env, { ...drafted, status: null }, 'DRAFT')
    return finish(client, claimed, env, {
      invoiceId: id,
      invoiceDraftId: id,
      status: 'DRAFT',
      subtotalMinor: subtotal.toString(),
      lineCount: lines.length,
    })
  })
}

export async function approveInvoice(input) {
  const env = envelope(input)
  requireReason(env.reasonCode)
  const invoiceId = input.invoiceId
  if (!invoiceId) {
    throw finError('REASON_CODE_REQUIRED', {
      category: CATEGORY.VALIDATION,
      details: { field: 'invoiceId' },
    })
  }
  return withRetry(async (client) => {
    const invoice = await loadInvoice(client, invoiceId, { forUpdate: true })
    if (!invoice) {
      throw finError('INVOICE_NOT_FOUND', { category: CATEGORY.PRECONDITION, httpStatus: 404 })
    }
    const key = env.idempotencyKey || `INV:APPROVE:${invoiceId}:v${invoice.version}`
    const claimed = await claim(client, env, key, { cmd: 'ApproveInvoice', invoiceId })
    if (claimed.kind === 'replay') return claimed.row.response_body
    if (invoice.status !== 'DRAFT') {
      throw finError('INVOICE_NOT_DRAFT', {
        category: CATEGORY.PRECONDITION,
        details: { status: invoice.status },
      })
    }
    const sums = await client.query(
      `SELECT
         COALESCE((SELECT SUM(amount_minor) FROM fin.invoice_lines WHERE invoice_id = $1), 0) AS lines,
         COALESCE((SELECT SUM(tax_minor) FROM fin.invoice_tax_lines WHERE invoice_id = $1), 0) AS tax`,
      [invoiceId],
    )
    const lines = BigInt(sums.rows[0].lines)
    const tax = BigInt(sums.rows[0].tax)
    const expected = lines + tax
    if (expected !== BigInt(invoice.total_minor) && tax === 0n && lines !== BigInt(invoice.subtotal_minor)) {
      throw finError('INVOICE_NOT_DRAFT', {
        category: CATEGORY.PRECONDITION,
        details: { reason: 'total_mismatch', lines: lines.toString(), total: String(invoice.total_minor) },
      })
    }
    const updated = (await client.query(
      `UPDATE fin.invoices
          SET status = 'APPROVED', subtotal_minor = $2, tax_minor = $3, total_minor = $4,
              updated_at = $5, updated_by_actor_type = $6, updated_by_actor_id = $7
        WHERE id = $1
        RETURNING *`,
      [
        invoiceId, lines.toString(), tax.toString(), (lines + tax).toString(),
        env.now, env.actorType, env.actorId,
      ],
    )).rows[0]
    await writeInvoiceStatus(client, env, updated, 'APPROVED')
    return finish(client, claimed, env, { invoiceId, status: 'APPROVED' })
  })
}

export async function issueInvoice(input) {
  const env = envelope(input)
  requireReason(env.reasonCode)
  const invoiceId = input.invoiceId
  if (!invoiceId) {
    throw finError('REASON_CODE_REQUIRED', {
      category: CATEGORY.VALIDATION,
      details: { field: 'invoiceId' },
    })
  }
  const fiscalContext = input.fiscalContext || '2026'
  return withRetry(async (client) => {
    const invoice = await loadInvoice(client, invoiceId, { forUpdate: true })
    if (!invoice) {
      throw finError('INVOICE_NOT_FOUND', { category: CATEGORY.PRECONDITION, httpStatus: 404 })
    }
    const key = env.idempotencyKey || `INV:ISSUE:${invoiceId}:v${invoice.version}`
    const claimed = await claim(client, env, key, { cmd: 'IssueInvoice', invoiceId })
    if (claimed.kind === 'replay') return claimed.row.response_body
    if (invoice.status !== 'APPROVED') {
      throw finError('INVOICE_NOT_DRAFT', {
        category: CATEGORY.PRECONDITION,
        details: { status: invoice.status, expected: 'APPROVED' },
      })
    }
    env.tenantId = env.tenantId || invoice.tenant_id

    const legal = await loadLegalEntity(client, invoice.legal_entity_id)
    const jurisdiction = input.jurisdiction || legal?.jurisdiction || 'SA'

    const lineRows = (await client.query(
      `SELECT * FROM fin.invoice_lines WHERE invoice_id = $1 ORDER BY line_no`,
      [invoiceId],
    )).rows
    let taxTotal = 0n
    for (const line of lineRows) {
      const resolved = resolveTax({
        sellerLegalEntityId: invoice.legal_entity_id,
        buyerJurisdiction: jurisdiction,
        netMinor: line.amount_minor,
        at: env.now,
      })
      const taxMinor = BigInt(resolved.tax_minor)
      taxTotal += taxMinor
      const snap = await insertTaxSnapshot(client, {
        environment: env.environment,
        tenantId: invoice.tenant_id,
        invoiceId,
        jurisdiction,
        taxTreatment: resolved.tax_treatment,
        vatBps: resolved.vat_bps,
        taxMinor: taxMinor.toString(),
        provider: resolved.provider,
        now: env.now,
      })
      await client.query(
        `INSERT INTO fin.invoice_tax_lines (
           id, environment, tenant_id, invoice_id, tax_snapshot_id,
           tax_minor, vat_bps, tax_treatment, jurisdiction, created_at
         ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
        [
          randomUUID(), env.environment, invoice.tenant_id, invoiceId, snap.id,
          taxMinor.toString(), resolved.vat_bps, resolved.tax_treatment, jurisdiction,
          env.now,
        ],
      )
    }

    const subtotal = lineRows.reduce((sum, row) => sum + BigInt(row.amount_minor), 0n)
    const total = subtotal + taxTotal

    const seq = await assignSequence(client, {
      environment: env.environment,
      legalEntityId: invoice.legal_entity_id,
      jurisdiction,
      docType: 'INVOICE',
      fiscalContext,
      now: env.now,
    })

    const xmlUuid = jurisdiction === 'SA' ? randomUUID() : (input.xmlUuid || null)
    if (jurisdiction === 'SA' && !xmlUuid) {
      throw finError('INVOICE_ZATCA_FIELDS_MISSING', { category: CATEGORY.PRECONDITION })
    }

    let issued
    try {
      issued = (await client.query(
        `UPDATE fin.invoices
            SET status = 'ISSUED',
                invoice_number = $2,
                invoice_sequence_id = $3,
                issued_at = $4,
                subtotal_minor = $5,
                tax_minor = $6,
                total_minor = $7,
                xml_uuid = COALESCE($8, xml_uuid),
                updated_at = $4,
                updated_by_actor_type = $9,
                updated_by_actor_id = $10
          WHERE id = $1
          RETURNING *`,
        [
          invoiceId, seq.number, seq.sequenceId, env.now,
          subtotal.toString(), taxTotal.toString(), total.toString(),
          xmlUuid, env.actorType, env.actorId,
        ],
      )).rows[0]
    } catch (error) {
      if (error.code === '23505') {
        throw finError('INVOICE_SEQUENCE_REUSE', { category: CATEGORY.CONFLICT })
      }
      throw mapBillingPgError(error)
    }

    await insertOutbox(client, {
      environment: env.environment,
      topic: 'fin.invoice.render',
      dedupeKey: `inv:${invoiceId}:render`,
      payload: { invoiceId, invoiceNumber: seq.number },
      now: env.now,
    })
    if (jurisdiction === 'SA') {
      await insertOutbox(client, {
        environment: env.environment,
        topic: 'fin.zatca.submit',
        dedupeKey: `inv:${invoiceId}:zatca`,
        payload: { invoiceId, xmlUuid },
        now: env.now,
      })
    }

    if (invoice.billing_period_id) {
      await lockBillingPeriod(client, invoice.billing_period_id)
      const period = await loadPeriod(client, invoice.billing_period_id)
      if (period && period.status === 'INVOICE_DRAFTED') {
        await flipBillingPeriod(client, env, period, 'INVOICED')
      }
    }

    await writeInvoiceStatus(client, env, issued, 'ISSUED', {
      invoiceNumber: seq.number,
      assigned: seq.assigned,
    })
    return finish(client, claimed, env, {
      invoiceId,
      status: 'ISSUED',
      invoiceNumber: seq.number,
      assigned: seq.assigned,
      totalMinor: total.toString(),
      taxMinor: taxTotal.toString(),
    })
  })
}

export async function voidIssuedInvoice(input) {
  const env = envelope(input)
  requireReason(env.reasonCode)
  const invoiceId = input.invoiceId
  if (!invoiceId) {
    throw finError('REASON_CODE_REQUIRED', {
      category: CATEGORY.VALIDATION,
      details: { field: 'invoiceId' },
    })
  }
  if (env.actorType === 'USER') {
    // validated inside tx against approval row
  }
  return withRetry(async (client) => {
    const invoice = await loadInvoice(client, invoiceId, { forUpdate: true })
    if (!invoice) {
      throw finError('INVOICE_NOT_FOUND', { category: CATEGORY.PRECONDITION, httpStatus: 404 })
    }
    const key = env.idempotencyKey || `INV:VOID:${invoiceId}:v${invoice.version}`
    const claimed = await claim(client, env, key, { cmd: 'VoidIssuedInvoice', invoiceId })
    if (claimed.kind === 'replay') return claimed.row.response_body

    await requireApproval(client, {
      approvalId: input.approvalRequestId,
      actionKind: 'INVOICE_VOID',
      actorType: env.actorType,
      missingCode: 'APPROVAL_NOT_APPROVED',
    })

    if (!['ISSUED', 'PART_PAID'].includes(invoice.status)) {
      if (invoice.status === 'DRAFT' || invoice.status === 'APPROVED') {
        const voidedDraft = (await client.query(
          `UPDATE fin.invoices
              SET status = 'VOID', reason_code = $2, updated_at = $3,
                  updated_by_actor_type = $4, updated_by_actor_id = $5
            WHERE id = $1
            RETURNING *`,
          [invoiceId, env.reasonCode, env.now, env.actorType, env.actorId],
        )).rows[0]
        await writeInvoiceStatus(client, env, voidedDraft, 'VOID')
        return finish(client, claimed, env, {
          invoiceId, status: 'VOID', invoiceNumber: invoice.invoice_number,
        })
      }
      throw finError('INVOICE_NOT_DRAFT', {
        category: CATEGORY.PRECONDITION,
        details: { status: invoice.status },
      })
    }

    const legal = await loadLegalEntity(client, invoice.legal_entity_id)
    if (input.jurisdictionForbidden || legal?.note_void_forbidden) {
      throw finError('NOTE_VOID_FORBIDDEN', { category: CATEGORY.PRECONDITION })
    }

    const allocated = await client.query(
      `SELECT COALESCE(SUM(amount_minor), 0)::bigint AS qty
         FROM fin.invoice_payment_allocations WHERE invoice_id = $1`,
      [invoiceId],
    )
    if (BigInt(allocated.rows[0].qty) !== 0n) {
      throw finError('INVOICE_VOID_WITH_CASH', { category: CATEGORY.PRECONDITION })
    }

    const voided = (await client.query(
      `UPDATE fin.invoices
          SET status = 'VOID', reason_code = $2, updated_at = $3,
              updated_by_actor_type = $4, updated_by_actor_id = $5
        WHERE id = $1
        RETURNING *`,
      [invoiceId, env.reasonCode, env.now, env.actorType, env.actorId],
    )).rows[0]
    await writeInvoiceStatus(client, env, voided, 'VOID', {
      invoiceNumber: voided.invoice_number,
    })
    return finish(client, claimed, env, {
      invoiceId,
      status: 'VOID',
      invoiceNumber: invoice.invoice_number,
    })
  })
}

export async function allocatedTotal(client, invoiceId) {
  const { rows } = await client.query(
    `SELECT COALESCE(SUM(amount_minor), 0)::bigint AS qty
       FROM fin.invoice_payment_allocations WHERE invoice_id = $1`,
    [invoiceId],
  )
  return BigInt(rows[0].qty)
}

export async function setInvoicePaidStatus(client, env, invoice, allocated) {
  const total = BigInt(invoice.total_minor)
  const credits = (await client.query(
    `SELECT COALESCE(SUM(amount_minor), 0)::bigint AS qty
       FROM fin.invoice_adjustments WHERE invoice_id = $1`,
    [invoice.id],
  )).rows[0]
  const net = total + BigInt(credits.qty)
  let to = invoice.status
  if (invoice.status === 'UNCOLLECTIBLE') {
    to = allocated >= net && net > 0n ? 'PAID' : 'PART_PAID'
  } else if (allocated === 0n || allocated === 0n && net > 0n) {
    to = allocated === 0n ? (['PAID', 'PART_PAID'].includes(invoice.status) ? 'ISSUED' : invoice.status) : to
    if (allocated === 0n && ['PAID', 'PART_PAID'].includes(invoice.status)) to = 'ISSUED'
  } else if (allocated >= net && net > 0n) {
    to = 'PAID'
  } else if (allocated > 0n && allocated < net) {
    to = 'PART_PAID'
  }
  if (to !== invoice.status && ISSUED_LIKE.includes(invoice.status) || ['ISSUED', 'PART_PAID', 'PAID', 'UNCOLLECTIBLE'].includes(invoice.status)) {
    if (to !== invoice.status) {
      const updated = (await client.query(
        `UPDATE fin.invoices
            SET status = $2, updated_at = $3,
                updated_by_actor_type = $4, updated_by_actor_id = $5
          WHERE id = $1
          RETURNING *`,
        [invoice.id, to, env.now, env.actorType, env.actorId],
      )).rows[0]
      await writeInvoiceStatus(client, env, updated, to)
    }
  }
  return to
}

export { loadInvoice, writeInvoiceStatus }
