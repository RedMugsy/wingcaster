/**
 * Record / apply / reverse payments (B §payments / C §5.13 / C §6).
 * Partial allocation keeps status RECEIVED; remainder in unapplied_cash.
 * unapplied_cash is command-owned (DL-134). Allocations are SIGN-FLEXIBLE (DL-133).
 */
import { randomUUID } from 'node:crypto'
import { CATEGORY, finError } from '../errors.js'
import { insertAudit, insertOutbox } from '../ledger/write.js'
import { OPEN_STATUSES, cureDunning } from '../dunning/cases.js'
import { refundPurchase } from '../funding/purchase-intents.js'
import {
  claim, envelope, finish, mapBillingPgError, requireReason, withRetry,
} from './helpers.js'
import { loadInvoice, writeInvoiceStatus } from './invoice-issuer.js'

async function loadPayment(client, paymentId) {
  const { rows } = await client.query(
    `SELECT * FROM fin.payments WHERE id = $1 FOR UPDATE`,
    [paymentId],
  )
  return rows[0] || null
}

async function bumpUnapplied(client, {
  environment, tenantId, billingAccountId, currency, delta, now,
}) {
  await client.query(
    `SELECT billing_account_id FROM fin.unapplied_cash
      WHERE environment = $1 AND billing_account_id = $2 AND currency = $3
      FOR UPDATE`,
    [environment, billingAccountId, currency],
  )
  await client.query(
    `INSERT INTO fin.unapplied_cash (
       environment, billing_account_id, currency, tenant_id, balance_minor, updated_at
     ) VALUES ($1,$2,$3,$4,$5,$6)
     ON CONFLICT (environment, billing_account_id, currency)
     DO UPDATE SET
       balance_minor = fin.unapplied_cash.balance_minor + EXCLUDED.balance_minor,
       updated_at = EXCLUDED.updated_at`,
    [environment, billingAccountId, currency, tenantId, String(delta), now],
  )
}

async function writePaymentStatus(client, env, payment, to) {
  await insertOutbox(client, {
    environment: env.environment,
    topic: 'fin.payment.status',
    dedupeKey: `pay:${payment.id}:${to}:${payment.version || 1}`,
    payload: { paymentId: payment.id, status: to },
    now: env.now,
  })
  await insertAudit(client, {
    environment: env.environment,
    actorType: env.actorType,
    actorId: env.actorId,
    actorEmail: env.actorEmail,
    action: `PAYMENT_${to}`,
    targetType: 'PAYMENT',
    targetId: payment.id,
    beforeState: { status: payment.status },
    afterState: { status: to },
    reasonCode: env.reasonCode,
    now: env.now,
  })
}

export async function recordPayment(input) {
  const env = envelope(input)
  requireReason(env.reasonCode)
  const amountMinor = BigInt(input.amountMinor ?? input.amount_minor ?? 0)
  if (!input.billingAccountId || !input.currency || amountMinor <= 0n) {
    throw finError('REASON_CODE_REQUIRED', {
      category: CATEGORY.VALIDATION,
      details: { reason: 'payment_fields_required' },
    })
  }
  const provider = input.provider || null
  const providerEventId = input.providerEventId || input.provider_event_id || null
  const key = env.idempotencyKey
    || (providerEventId
      ? `PAY:RECORD:${provider}:${providerEventId}`
      : `PAY:RECORD:${env.tenantId || input.tenantId}:${input.clientKey || randomUUID()}`)
  return withRetry(async (client) => {
    if (providerEventId) {
      const reused = await client.query(
        `SELECT id, status FROM fin.payments
          WHERE provider = $1 AND provider_event_id = $2
          FOR UPDATE`,
        [provider, providerEventId],
      )
      if (reused.rowCount) {
        return {
          paymentId: reused.rows[0].id,
          status: reused.rows[0].status,
          replayed: true,
        }
      }
    }
    const claimed = await claim(client, env, key, {
      cmd: 'RecordPayment', provider, providerEventId, amountMinor: amountMinor.toString(),
    })
    if (claimed.kind === 'replay') return claimed.row.response_body
    if (providerEventId) {
      const reused = await client.query(
        `SELECT id, status FROM fin.payments
          WHERE provider = $1 AND provider_event_id = $2`,
        [provider, providerEventId],
      )
      if (reused.rowCount) {
        return finish(client, claimed, env, {
          paymentId: reused.rows[0].id,
          status: reused.rows[0].status,
          replayed: true,
        })
      }
    }
    const ba = (await client.query(
      `SELECT tenant_id FROM fin.billing_accounts WHERE id = $1`,
      [input.billingAccountId],
    )).rows[0]
    const tenantId = env.tenantId || ba?.tenant_id
    env.tenantId = tenantId
    const id = randomUUID()
    try {
      await client.query(
        `INSERT INTO fin.payments (
           id, environment, tenant_id, billing_account_id, currency, amount_minor,
           status, provider, provider_event_id, received_at, reason_code,
           created_at, created_by_actor_type, created_by_actor_id,
           updated_at, updated_by_actor_type, updated_by_actor_id
         ) VALUES ($1,$2,$3,$4,$5,$6,'RECEIVED',$7,$8,$9,$10,$9,$11,$12,$9,$11,$12)`,
        [
          id, env.environment, tenantId, input.billingAccountId, input.currency,
          amountMinor.toString(), provider, providerEventId,
          input.receivedAt || env.now, env.reasonCode,
          env.actorType, env.actorId,
        ],
      )
    } catch (error) {
      if (error.code === '23505') {
        const row = await client.query(
          `SELECT id, status FROM fin.payments
            WHERE provider = $1 AND provider_event_id = $2`,
          [provider, providerEventId],
        )
        return finish(client, claimed, env, {
          paymentId: row.rows[0].id, status: row.rows[0].status, replayed: true,
        })
      }
      throw mapBillingPgError(error)
    }
    await bumpUnapplied(client, {
      environment: env.environment,
      tenantId,
      billingAccountId: input.billingAccountId,
      currency: input.currency,
      delta: amountMinor,
      now: env.now,
    })
    const payment = { id, status: null, version: 1 }
    await writePaymentStatus(client, env, payment, 'RECEIVED')
    return finish(client, claimed, env, {
      paymentId: id, status: 'RECEIVED', amountMinor: amountMinor.toString(),
    })
  })
}

async function invoiceAllocated(client, invoiceId) {
  const { rows } = await client.query(
    `SELECT COALESCE(SUM(amount_minor), 0)::bigint AS qty
       FROM fin.invoice_payment_allocations WHERE invoice_id = $1`,
    [invoiceId],
  )
  return BigInt(rows[0].qty)
}

async function flipInvoiceForAllocation(client, env, invoice, allocated) {
  const adjustments = (await client.query(
    `SELECT COALESCE(SUM(amount_minor), 0)::bigint AS qty
       FROM fin.invoice_adjustments WHERE invoice_id = $1`,
    [invoice.id],
  )).rows[0]
  const net = BigInt(invoice.total_minor) + BigInt(adjustments.qty)
  let to = invoice.status
  if (invoice.status === 'VOID') return invoice.status
  if (allocated <= 0n) {
    to = ['PAID', 'PART_PAID'].includes(invoice.status) ? 'ISSUED' : invoice.status
  } else if (net > 0n && allocated >= net) {
    to = 'PAID'
  } else if (allocated > 0n && allocated < net) {
    to = 'PART_PAID'
  }
  if (to !== invoice.status) {
    await client.query(
      `UPDATE fin.invoices
          SET status = $2, updated_at = $3,
              updated_by_actor_type = $4, updated_by_actor_id = $5
        WHERE id = $1`,
      [invoice.id, to, env.now, env.actorType, env.actorId],
    )
    await writeInvoiceStatus(client, env, invoice, to)
  }
  return to
}

async function cureIfPaid(client, env, invoiceId, to) {
  if (to !== 'PAID') return
  const found = await client.query(
    `SELECT id, status FROM fin.dunning_cases
      WHERE environment = $1 AND invoice_id = $2
        AND status NOT IN ('CURED', 'WRITTEN_OFF', 'CANCELED')
      LIMIT 1`,
    [env.environment, invoiceId],
  )
  if (!found.rowCount) return
  const row = found.rows[0]
  if (!OPEN_STATUSES.has(row.status) && row.status !== 'WRITE_OFF_REVIEW') return
  await cureDunning({
    ...env,
    caseId: row.id,
    reasonCode: env.reasonCode || 'AR_CURED',
    idempotencyKey: `DUNNING:CURED:${row.id}:pay`,
  })
}

export async function applyPayment(input) {
  const env = envelope(input)
  requireReason(env.reasonCode)
  const paymentId = input.paymentId
  const allocations = input.allocations || []
  if (!paymentId || !allocations.length) {
    throw finError('REASON_CODE_REQUIRED', {
      category: CATEGORY.VALIDATION,
      details: { field: allocations.length ? 'paymentId' : 'allocations' },
    })
  }
  const key = env.idempotencyKey || `PAY:APPLY:${paymentId}:${allocations.map((a) => a.invoiceId).join(',')}`
  return withRetry(async (client) => {
    const claimed = await claim(client, env, key, {
      cmd: 'ApplyPayment', paymentId, allocations: allocations.map((a) => ({
        invoiceId: a.invoiceId, amountMinor: String(a.amountMinor ?? a.amount_minor),
      })),
    })
    if (claimed.kind === 'replay') return claimed.row.response_body
    const payment = await loadPayment(client, paymentId)
    if (!payment) {
      throw finError('PAYMENT_NOT_FOUND', { category: CATEGORY.PRECONDITION, httpStatus: 404 })
    }
    if (payment.status === 'REVERSED' || payment.status === 'ALLOCATED') {
      throw finError('PAYMENTS_ILLEGAL_TRANSITION', {
        category: CATEGORY.PRECONDITION,
        details: { status: payment.status },
      })
    }
    env.tenantId = env.tenantId || payment.tenant_id
    const invoiceIds = [...new Set(allocations.map((a) => a.invoiceId))].sort()
    await client.query(
      `SELECT id FROM fin.invoices WHERE id = ANY($1::uuid[]) ORDER BY id ASC FOR UPDATE`,
      [invoiceIds],
    )
    let applied = 0n
    const results = []
    for (const alloc of allocations) {
      const amount = BigInt(alloc.amountMinor ?? alloc.amount_minor ?? 0)
      if (amount === 0n) continue
      const invoice = await loadInvoice(client, alloc.invoiceId)
      // ApplyPayment is cash against an issued receivable. DRAFT is correctly
      // rejected here (not inverted). runner-billed-green must ISSUE first
      // (period-close nextStepIndex; DL-146).
      if (!invoice || !['ISSUED', 'PART_PAID', 'UNCOLLECTIBLE'].includes(invoice.status)) {
        throw finError('INVOICE_NOT_DRAFT', {
          category: CATEGORY.PRECONDITION,
          details: { invoiceId: alloc.invoiceId, status: invoice?.status },
        })
      }
      await client.query(
        `INSERT INTO fin.payment_allocations (
           id, environment, tenant_id, payment_id, invoice_id, amount_minor,
           created_at, created_by_actor_type, created_by_actor_id
         ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
        [
          randomUUID(), env.environment, payment.tenant_id, paymentId, alloc.invoiceId,
          amount.toString(), env.now, env.actorType, env.actorId,
        ],
      )
      await client.query(
        `INSERT INTO fin.invoice_payment_allocations (
           id, environment, tenant_id, invoice_id, payment_id, amount_minor,
           created_at, created_by_actor_type, created_by_actor_id
         ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
        [
          randomUUID(), env.environment, payment.tenant_id, alloc.invoiceId, paymentId,
          amount.toString(), env.now, env.actorType, env.actorId,
        ],
      )
      applied += amount
      const allocated = await invoiceAllocated(client, alloc.invoiceId)
      const to = await flipInvoiceForAllocation(client, env, invoice, allocated)
      await cureIfPaid(client, env, alloc.invoiceId, to)
      results.push({ invoiceId: alloc.invoiceId, status: to, allocated: allocated.toString() })
    }
    await bumpUnapplied(client, {
      environment: env.environment,
      tenantId: payment.tenant_id,
      billingAccountId: payment.billing_account_id,
      currency: payment.currency,
      delta: -applied,
      now: env.now,
    })
    const already = await client.query(
      `SELECT COALESCE(SUM(amount_minor), 0)::bigint AS qty
         FROM fin.payment_allocations WHERE payment_id = $1`,
      [paymentId],
    )
    let status = payment.status
    if (BigInt(already.rows[0].qty) === BigInt(payment.amount_minor)) {
      await client.query(
        `UPDATE fin.payments
            SET status = 'ALLOCATED', updated_at = $2,
                updated_by_actor_type = $3, updated_by_actor_id = $4
          WHERE id = $1`,
        [paymentId, env.now, env.actorType, env.actorId],
      )
      await writePaymentStatus(client, env, payment, 'ALLOCATED')
      status = 'ALLOCATED'
    }
    return finish(client, claimed, env, { paymentId, status, invoices: results })
  })
}

export async function reversePayment(input) {
  const env = envelope(input)
  requireReason(env.reasonCode)
  const paymentId = input.paymentId
  if (!paymentId) {
    throw finError('REASON_CODE_REQUIRED', {
      category: CATEGORY.VALIDATION,
      details: { field: 'paymentId' },
    })
  }
  const key = env.idempotencyKey || `PAYREV:${paymentId}`
  return withRetry(async (client) => {
    const claimed = await claim(client, env, key, { cmd: 'ReversePayment', paymentId })
    if (claimed.kind === 'replay') return claimed.row.response_body
    const payment = await loadPayment(client, paymentId)
    if (!payment) {
      throw finError('PAYMENT_NOT_FOUND', { category: CATEGORY.PRECONDITION, httpStatus: 404 })
    }
    if (payment.status === 'REVERSED') {
      return finish(client, claimed, env, { paymentId, status: 'REVERSED' })
    }
    env.tenantId = env.tenantId || payment.tenant_id
    const allocs = (await client.query(
      `SELECT invoice_id, SUM(amount_minor)::bigint AS qty
         FROM fin.payment_allocations
        WHERE payment_id = $1 AND invoice_id IS NOT NULL
        GROUP BY invoice_id
        ORDER BY invoice_id ASC`,
      [paymentId],
    )).rows
    const invoiceIds = allocs.map((a) => a.invoice_id).sort()
    if (invoiceIds.length) {
      await client.query(
        `SELECT id FROM fin.invoices WHERE id = ANY($1::uuid[]) ORDER BY id ASC FOR UPDATE`,
        [invoiceIds],
      )
    }
    for (const row of allocs) {
      const amount = BigInt(row.qty)
      if (amount === 0n) continue
      await client.query(
        `INSERT INTO fin.payment_allocations (
           id, environment, tenant_id, payment_id, invoice_id, amount_minor,
           created_at, created_by_actor_type, created_by_actor_id
         ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
        [
          randomUUID(), env.environment, payment.tenant_id, paymentId, row.invoice_id,
          (-amount).toString(), env.now, env.actorType, env.actorId,
        ],
      )
      await client.query(
        `INSERT INTO fin.invoice_payment_allocations (
           id, environment, tenant_id, invoice_id, payment_id, amount_minor,
           created_at, created_by_actor_type, created_by_actor_id
         ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
        [
          randomUUID(), env.environment, payment.tenant_id, row.invoice_id, paymentId,
          (-amount).toString(), env.now, env.actorType, env.actorId,
        ],
      )
      const invoice = await loadInvoice(client, row.invoice_id)
      const allocated = await invoiceAllocated(client, row.invoice_id)
      await flipInvoiceForAllocation(client, env, invoice, allocated)
    }
    const positive = (await client.query(
      `SELECT COALESCE(SUM(amount_minor), 0)::bigint AS qty
         FROM fin.payment_allocations
        WHERE payment_id = $1 AND amount_minor > 0`,
      [paymentId],
    )).rows[0]
    const residual = BigInt(payment.amount_minor) - BigInt(positive.qty)
    // Residual is the leftover in unapplied_cash from this payment.
    // Reverse removes it so the cache looks as if the payment never existed.
    // Applied cash was already subtracted at applyPayment and stays out.
    if (residual !== 0n) {
      await bumpUnapplied(client, {
        environment: env.environment,
        tenantId: payment.tenant_id,
        billingAccountId: payment.billing_account_id,
        currency: payment.currency,
        delta: -residual,
        now: env.now,
      })
    }

    await client.query(
      `UPDATE fin.payments
          SET status = 'REVERSED', reversed_at = $2, reason_code = $3,
              updated_at = $2, updated_by_actor_type = $4, updated_by_actor_id = $5
        WHERE id = $1`,
      [paymentId, env.now, input.reason || env.reasonCode, env.actorType, env.actorId],
    )
    await writePaymentStatus(client, env, payment, 'REVERSED')

    if (payment.provider === 'INVOICE') {
      const funded = await client.query(
        `SELECT id FROM fin.purchase_intents
          WHERE provider = 'INVOICE'
            AND status = 'PAID'
            AND (
              provider_event_id = $1
              OR provider_event_id = $2
            )
          FOR UPDATE`,
        [payment.id, payment.provider_event_id],
      )
      for (const intent of funded.rows) {
        await refundPurchase({
          ...env,
          intentId: intent.id,
          amountMinor: payment.amount_minor,
          reasonCode: env.reasonCode,
          idempotencyKey: `REFUND:${intent.id}:payrev:${paymentId}`,
        })
      }
    }
    return finish(client, claimed, env, { paymentId, status: 'REVERSED' })
  })
}

export { bumpUnapplied, loadPayment }
