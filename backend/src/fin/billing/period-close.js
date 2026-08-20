/**
 * Spec §77 12-step billing-period close. One function per step.
 * Each step is its own transaction(fn) and is idempotent so a crash mid-
 * workflow lets the next tick resume. Statuses stay the B §11 seven;
 * these steps are the worker checklist inside them.
 */
import { CATEGORY, finError } from '../errors.js'
import {
  claim, envelope, finish, lockBillingPeriod, requireReason, withRetry,
} from './helpers.js'
import { flipBillingPeriod, loadPeriod } from './periods.js'
import { approveInvoice, draftInvoice, issueInvoice } from './invoice-issuer.js'
import { assembleInvoiceForPeriod } from './invoice-assembler.js'

const STEPS = [
  'freezeUsageWindow',
  'drainMeteringQueue',
  'verifyMeteredRated',
  'snapshotRated',
  'draftInvoice',
  'resolveTax',
  'populateTaxLines',
  'verifyTotals',
  'approveInvoice',
  'issueInvoice',
  'markPeriodInvoiced',
  'finalizePeriod',
]

async function periodInvoice(client, periodId) {
  const { rows } = await client.query(
    `SELECT * FROM fin.invoices
      WHERE billing_period_id = $1
        AND status NOT IN ('VOID')
      ORDER BY created_at DESC
      LIMIT 1`,
    [periodId],
  )
  return rows[0] || null
}

export async function freezeUsageWindow(input) {
  const env = envelope(input)
  requireReason(env.reasonCode)
  const periodId = input.billingPeriodId
  const key = env.idempotencyKey || `BP:CLOSE:1:${periodId}`
  return withRetry(async (client) => {
    const claimed = await claim(client, env, key, { cmd: 'freezeUsageWindow', periodId })
    if (claimed.kind === 'replay') return claimed.row.response_body
    await lockBillingPeriod(client, periodId)
    const period = await loadPeriod(client, periodId)
    if (!period) throw finError('BILLING_PERIOD_SKIP', { category: CATEGORY.PRECONDITION })
    if (period.status === 'USAGE_CLOSING' || [
      'USAGE_CLOSED', 'RATING_CLOSED', 'INVOICE_DRAFTED', 'INVOICED', 'FINAL',
    ].includes(period.status)) {
      return finish(client, claimed, env, { periodId, status: period.status, step: 1, skipped: true })
    }
    if (Date.parse(period.ends_at) > Date.parse(env.now)) {
      throw finError('BILLING_PERIOD_NOT_ENDED', { category: CATEGORY.PRECONDITION })
    }
    const flipped = await flipBillingPeriod(client, env, period, 'USAGE_CLOSING')
    return finish(client, claimed, env, { ...flipped, step: 1 })
  })
}

export async function drainMeteringQueue(input) {
  const env = envelope(input)
  requireReason(env.reasonCode)
  const periodId = input.billingPeriodId
  const key = env.idempotencyKey || `BP:CLOSE:2:${periodId}`
  return withRetry(async (client) => {
    const claimed = await claim(client, env, key, { cmd: 'drainMeteringQueue', periodId })
    if (claimed.kind === 'replay') return claimed.row.response_body
    await lockBillingPeriod(client, periodId)
    const period = await loadPeriod(client, periodId)
    if (!period) throw finError('BILLING_PERIOD_SKIP', { category: CATEGORY.PRECONDITION })
    if (period.status !== 'USAGE_CLOSING') {
      if (['USAGE_CLOSED', 'RATING_CLOSED', 'INVOICE_DRAFTED', 'INVOICED', 'FINAL'].includes(period.status)) {
        return finish(client, claimed, env, { periodId, status: period.status, step: 2, skipped: true })
      }
      throw finError('BILLING_PERIOD_SKIP', { category: CATEGORY.PRECONDITION, details: { status: period.status } })
    }
    const pending = await client.query(
      `SELECT u.id
         FROM fin.usage_events u
        WHERE u.billing_account_id = $1
          AND u.environment = $2
          AND u.occurred_at >= $3::timestamptz
          AND u.occurred_at < $4::timestamptz
          AND NOT EXISTS (
            SELECT 1 FROM fin.metered_usage_sources s
             WHERE s.usage_event_id = u.id AND s.residency_key = u.residency_key
          )
        LIMIT 1`,
      [period.billing_account_id, period.environment, period.starts_at, period.ends_at],
    )
    if (pending.rowCount) {
      throw finError('BILLING_PERIOD_DRAINAGE_INCOMPLETE', { category: CATEGORY.PRECONDITION })
    }
    const flipped = await flipBillingPeriod(client, env, period, 'USAGE_CLOSED')
    return finish(client, claimed, env, { ...flipped, step: 2 })
  })
}

export async function verifyMeteredRated(input) {
  const env = envelope(input)
  requireReason(env.reasonCode)
  const periodId = input.billingPeriodId
  const key = env.idempotencyKey || `BP:CLOSE:3:${periodId}`
  return withRetry(async (client) => {
    const claimed = await claim(client, env, key, { cmd: 'verifyMeteredRated', periodId })
    if (claimed.kind === 'replay') return claimed.row.response_body
    await lockBillingPeriod(client, periodId)
    const period = await loadPeriod(client, periodId)
    if (!period) throw finError('BILLING_PERIOD_SKIP', { category: CATEGORY.PRECONDITION })
    if (period.status !== 'USAGE_CLOSED' && period.status !== 'RATING_CLOSED') {
      if (['INVOICE_DRAFTED', 'INVOICED', 'FINAL'].includes(period.status)) {
        return finish(client, claimed, env, { periodId, status: period.status, step: 3, skipped: true })
      }
      throw finError('BILLING_PERIOD_SKIP', { category: CATEGORY.PRECONDITION, details: { status: period.status } })
    }
    const missing = await client.query(
      `SELECT m.id
         FROM fin.metered_usage m
         JOIN fin.holders h ON h.id = m.holder_id
         JOIN fin.billing_accounts ba ON ba.holder_id = h.id AND ba.environment = m.environment
        WHERE ba.id = $1
          AND m.environment = $2
          AND m.status = 'ACTIVE'
          AND m.metered_at >= $3::timestamptz
          AND m.metered_at < $4::timestamptz
          AND NOT EXISTS (
            SELECT 1 FROM fin.rated_usage r WHERE r.metered_usage_id = m.id
          )
        LIMIT 1`,
      [period.billing_account_id, period.environment, period.starts_at, period.ends_at],
    )
    if (missing.rowCount) {
      throw finError('BILLING_PERIOD_RATING_INCOMPLETE', { category: CATEGORY.PRECONDITION })
    }
    if (period.status === 'USAGE_CLOSED') {
      await flipBillingPeriod(client, env, period, 'RATING_CLOSED')
    }
    return finish(client, claimed, env, { periodId, status: 'RATING_CLOSED', step: 3 })
  })
}

export async function snapshotRated(input) {
  const env = envelope(input)
  requireReason(env.reasonCode)
  const periodId = input.billingPeriodId
  const key = env.idempotencyKey || `BP:CLOSE:4:${periodId}`
  return withRetry(async (client) => {
    const claimed = await claim(client, env, key, { cmd: 'snapshotRated', periodId })
    if (claimed.kind === 'replay') return claimed.row.response_body
    await lockBillingPeriod(client, periodId)
    const period = await loadPeriod(client, periodId)
    const assembled = await assembleInvoiceForPeriod(client, { billingPeriodId: periodId })
    return finish(client, claimed, env, {
      periodId,
      status: period?.status,
      step: 4,
      lineCount: assembled.lines.length,
      subtotalMinor: assembled.subtotalMinor,
    })
  })
}

export async function draftInvoiceStep(input) {
  const env = envelope(input)
  const periodId = input.billingPeriodId
  return draftInvoice({
    ...env,
    billingPeriodId: periodId,
    idempotencyKey: env.idempotencyKey || `INV:DRAFT:${periodId}`,
  })
}

export async function resolveTaxStep(input) {
  const env = envelope(input)
  requireReason(env.reasonCode)
  const periodId = input.billingPeriodId
  const key = env.idempotencyKey || `BP:CLOSE:6:${periodId}`
  return withRetry(async (client) => {
    const claimed = await claim(client, env, key, { cmd: 'resolveTax', periodId })
    if (claimed.kind === 'replay') return claimed.row.response_body
    const invoice = await periodInvoice(client, periodId)
    return finish(client, claimed, env, {
      periodId, step: 6, invoiceId: invoice?.id, status: invoice?.status,
    })
  })
}

export async function populateTaxLinesStep(input) {
  const env = envelope(input)
  requireReason(env.reasonCode)
  const periodId = input.billingPeriodId
  const key = env.idempotencyKey || `BP:CLOSE:7:${periodId}`
  return withRetry(async (client) => {
    const claimed = await claim(client, env, key, { cmd: 'populateTaxLines', periodId })
    if (claimed.kind === 'replay') return claimed.row.response_body
    const invoice = await periodInvoice(client, periodId)
    return finish(client, claimed, env, {
      periodId, step: 7, invoiceId: invoice?.id,
    })
  })
}

export async function verifyTotalsStep(input) {
  const env = envelope(input)
  requireReason(env.reasonCode)
  const periodId = input.billingPeriodId
  const key = env.idempotencyKey || `BP:CLOSE:8:${periodId}`
  return withRetry(async (client) => {
    const claimed = await claim(client, env, key, { cmd: 'verifyTotals', periodId })
    if (claimed.kind === 'replay') return claimed.row.response_body
    const invoice = await periodInvoice(client, periodId)
    if (!invoice) {
      throw finError('INVOICE_NOT_DRAFT', { category: CATEGORY.PRECONDITION })
    }
    const sums = await client.query(
      `SELECT COALESCE(SUM(amount_minor), 0)::bigint AS lines
         FROM fin.invoice_lines WHERE invoice_id = $1`,
      [invoice.id],
    )
    if (BigInt(sums.rows[0].lines) !== BigInt(invoice.subtotal_minor)) {
      throw finError('INVOICE_NOT_DRAFT', {
        category: CATEGORY.PRECONDITION,
        details: { reason: 'total_mismatch' },
      })
    }
    return finish(client, claimed, env, { periodId, step: 8, invoiceId: invoice.id })
  })
}

export async function approveInvoiceStep(input) {
  const env = envelope(input)
  const periodId = input.billingPeriodId
  return withRetry(async (client) => {
    const invoice = await periodInvoice(client, periodId)
    if (!invoice) throw finError('INVOICE_NOT_DRAFT', { category: CATEGORY.PRECONDITION })
    if (invoice.status === 'APPROVED' || invoice.status === 'ISSUED' || invoice.status === 'PAID' || invoice.status === 'PART_PAID') {
      return { invoiceId: invoice.id, status: invoice.status, step: 9, skipped: true }
    }
    return approveInvoice({
      ...env,
      invoiceId: invoice.id,
      idempotencyKey: env.idempotencyKey || `INV:APPROVE:${invoice.id}:v${invoice.version}`,
    })
  })
}

export async function issueInvoiceStep(input) {
  const env = envelope(input)
  const periodId = input.billingPeriodId
  return withRetry(async (client) => {
    const invoice = await periodInvoice(client, periodId)
    if (!invoice) throw finError('INVOICE_NOT_DRAFT', { category: CATEGORY.PRECONDITION })
    if (['ISSUED', 'PART_PAID', 'PAID'].includes(invoice.status)) {
      return { invoiceId: invoice.id, status: invoice.status, step: 10, skipped: true }
    }
    return issueInvoice({
      ...env,
      invoiceId: invoice.id,
      fiscalContext: input.fiscalContext || '2026',
      idempotencyKey: env.idempotencyKey || `INV:ISSUE:${invoice.id}:v${invoice.version}`,
    })
  })
}

export async function markPeriodInvoiced(input) {
  const env = envelope(input)
  requireReason(env.reasonCode)
  const periodId = input.billingPeriodId
  const key = env.idempotencyKey || `BP:CLOSE:11:${periodId}`
  return withRetry(async (client) => {
    const claimed = await claim(client, env, key, { cmd: 'markPeriodInvoiced', periodId })
    if (claimed.kind === 'replay') return claimed.row.response_body
    await lockBillingPeriod(client, periodId)
    const period = await loadPeriod(client, periodId)
    if (period.status === 'INVOICED' || period.status === 'FINAL') {
      return finish(client, claimed, env, { periodId, status: period.status, step: 11, skipped: true })
    }
    if (period.status !== 'INVOICE_DRAFTED') {
      throw finError('BILLING_PERIOD_SKIP', { category: CATEGORY.PRECONDITION, details: { status: period.status } })
    }
    const invoice = await periodInvoice(client, periodId)
    if (!invoice || invoice.status !== 'ISSUED' && invoice.status !== 'PAID' && invoice.status !== 'PART_PAID') {
      throw finError('BILLING_PERIOD_SKIP', { category: CATEGORY.PRECONDITION, details: { reason: 'invoice_not_issued' } })
    }
    const flipped = await flipBillingPeriod(client, env, period, 'INVOICED')
    return finish(client, claimed, env, { ...flipped, step: 11 })
  })
}

export async function finalizePeriod(input) {
  const env = envelope(input)
  requireReason(env.reasonCode)
  const periodId = input.billingPeriodId
  const key = env.idempotencyKey || `BP:CLOSE:12:${periodId}`
  return withRetry(async (client) => {
    const claimed = await claim(client, env, key, { cmd: 'finalizePeriod', periodId })
    if (claimed.kind === 'replay') return claimed.row.response_body
    await lockBillingPeriod(client, periodId)
    const period = await loadPeriod(client, periodId)
    if (period.status === 'FINAL') {
      return finish(client, claimed, env, { periodId, status: 'FINAL', step: 12, skipped: true })
    }
    if (period.status !== 'INVOICED') {
      throw finError('BILLING_PERIOD_SKIP', { category: CATEGORY.PRECONDITION, details: { status: period.status } })
    }
    const invoice = await periodInvoice(client, periodId)
    if (invoice?.status === 'VOID') {
      throw finError('BILLING_PERIOD_FINAL', { category: CATEGORY.PRECONDITION })
    }
    const flipped = await flipBillingPeriod(client, env, period, 'FINAL')
    return finish(client, claimed, env, { ...flipped, step: 12 })
  })
}

const STEP_FNS = [
  freezeUsageWindow,
  drainMeteringQueue,
  verifyMeteredRated,
  snapshotRated,
  draftInvoiceStep,
  resolveTaxStep,
  populateTaxLinesStep,
  verifyTotalsStep,
  approveInvoiceStep,
  issueInvoiceStep,
  markPeriodInvoiced,
  finalizePeriod,
]

function nextStepIndex(status, invoiceStatus) {
  if (status === 'OPEN') return 0
  if (status === 'USAGE_CLOSING') return 1
  if (status === 'USAGE_CLOSED') return 2
  if (status === 'RATING_CLOSED') return 4
  if (status === 'INVOICE_DRAFTED') {
    if (!invoiceStatus || invoiceStatus === 'DRAFT') return 5
    if (invoiceStatus === 'APPROVED') return 9
    return 10
  }
  if (status === 'INVOICED') return 11
  return -1
}

export async function advanceBillingPeriodClose(input) {
  const env = envelope(input)
  requireReason(env.reasonCode)
  const periodId = input.billingPeriodId
  if (!periodId) {
    throw finError('REASON_CODE_REQUIRED', {
      category: CATEGORY.VALIDATION,
      details: { field: 'billingPeriodId' },
    })
  }
  const target = input.targetStatus || null
  let last = null
  for (let guard = 0; guard < 12; guard += 1) {
    const snapshot = await withRetry(async (client) => {
      const period = (await client.query(
        `SELECT * FROM fin.billing_periods WHERE id = $1`,
        [periodId],
      )).rows[0]
      const invoice = period ? await periodInvoice(client, periodId) : null
      return { period, invoice }
    })
    if (!snapshot.period) {
      throw finError('BILLING_PERIOD_SKIP', { category: CATEGORY.PRECONDITION })
    }
    if (snapshot.period.status === 'FINAL' || (target && snapshot.period.status === target)) {
      return last || { periodId, status: snapshot.period.status, done: true }
    }
    const idx = nextStepIndex(snapshot.period.status, snapshot.invoice?.status)
    if (idx < 0) {
      return last || { periodId, status: snapshot.period.status, done: true }
    }
    last = await STEP_FNS[idx]({
      ...env,
      billingPeriodId: periodId,
      fiscalContext: input.fiscalContext,
      idempotencyKey: undefined,
    })
    if (!target) return last
  }
  return last
}

export { STEPS }
