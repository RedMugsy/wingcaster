/**
 * fin.purchase_intents state machine (B §4). One file.
 * Every command: transaction(fn), claim first, audit + outbox in the same tx.
 * PSP I/O happens AFTER commit (I-14) via webhook.stripe outbox.
 */
import { randomUUID } from 'node:crypto'
import { CATEGORY, finError } from '../errors.js'
import {
  insertAllocation, insertAudit, insertLedgerTx, insertLot, insertOutbox,
  insertPostingPair, loadAccounts, loadBook,
} from '../ledger/write.js'
import { lockAccounts, lockBooks, lockLots } from '../ledger/locks.js'
import {
  assertProvider, claim, envelope, finish, illegalTransition, lockPurchaseIntent,
  requireReason, withRetry,
} from './helpers.js'
import { recordDeferredRevenueForIntent } from '../accounting/deferred-revenue.js'
import { insertEvaluatedEvents, loadActivePolicy } from '../accounting/events.js'
import { evaluateRefund } from '../accounting/policy-engine.js'
import { fundPurchaseFromIntent } from './paid-lots.js'
import { quoteFromProduct, quoteProduct } from './quotes.js'
import { asUnits, toSqlInt, unitsString } from './units.js'

const ALLOW_SUBJECTS = ['BILLING_ACCOUNT', 'HOLDER', 'TENANT']

async function allowPurchases(client, { environment, tenantId, holderId, billingAccountId }) {
  const { rows } = await client.query(
    `SELECT subject_type, allow_purchases
       FROM fin.account_controls
      WHERE environment = $1
        AND (
          (subject_type = 'BILLING_ACCOUNT' AND subject_id = $2)
          OR (subject_type = 'HOLDER' AND subject_id = $3)
          OR (subject_type = 'TENANT' AND subject_id = $4)
        )`,
    [environment, billingAccountId, holderId, tenantId],
  )
  // Missing row = no deny on file (seedWorld has no controls). Explicit false denies.
  for (const rank of ALLOW_SUBJECTS) {
    const hit = rows.find((r) => r.subject_type === rank)
    if (hit && hit.allow_purchases === false) {
      throw finError('CONTROL_DENY', {
        category: CATEGORY.CONTROL,
        details: { flag: 'allow_purchases', subject_type: rank },
      })
    }
  }
}

async function loadIntent(client, intentId, { forUpdate = false } = {}) {
  const sql = forUpdate
    ? `SELECT * FROM fin.purchase_intents WHERE id = $1 FOR UPDATE`
    : `SELECT * FROM fin.purchase_intents WHERE id = $1`
  const { rows } = await client.query(sql, [intentId])
  if (!rows[0]) {
    throw finError('PURCHASE_INTENT_NOT_FOUND', { category: CATEGORY.PRECONDITION, httpStatus: 404 })
  }
  return rows[0]
}

async function writeStatusOutbox(client, intent, { to, now, extra = {} }) {
  // B §1 catalogue is purchase:{id}:{to}. FAILED→PAYMENT_PENDING retries the
  // same `to`, so version is appended (DL-100) to keep UNIQUE(topic, dedupe_key).
  await insertOutbox(client, {
    environment: intent.environment,
    topic: 'fin.purchase.status',
    dedupeKey: `purchase:${intent.id}:${to}:${intent.version ?? 1}`,
    payload: { intentId: intent.id, status: to, version: intent.version ?? 1, ...extra },
    now,
  })
}

async function writeLifecycle(client, intent, { to, now }) {
  await insertOutbox(client, {
    environment: intent.environment,
    topic: 'notification.lifecycle',
    dedupeKey: `purchase:${intent.id}:${to}:notify`,
    payload: { intentId: intent.id, status: to },
    now,
  })
}

async function writeStripeOutbox(client, intent, { now, action, n }) {
  const attempt = n ?? await nextStripeAttempt(client, intent.id)
  await insertOutbox(client, {
    environment: intent.environment,
    topic: 'webhook.stripe',
    dedupeKey: `stripe:${intent.id}:${attempt}`,
    payload: { intentId: intent.id, action: action || 'submit', attempt },
    now,
  })
  return attempt
}

async function nextStripeAttempt(client, intentId) {
  const { rows } = await client.query(
    `SELECT COUNT(*)::int AS n FROM fin.outbox_events
      WHERE topic = 'webhook.stripe' AND dedupe_key LIKE $1`,
    [`stripe:${intentId}:%`],
  )
  return rows[0].n + 1
}

async function stampTransition(client, intent, {
  to, now, actorType, actorId, reasonCode, provider, providerEventId,
  extraSet = '', extraValues = [],
}) {
  const timestampCol = {
    PAID: 'paid_at',
    FAILED: 'failed_at',
    CANCELED: 'canceled_at',
    REFUNDED: 'refunded_at',
  }[to]
  const sets = [
    'status = $2',
    'updated_at = $3',
    'updated_by_actor_type = $4',
    'updated_by_actor_id = $5',
    'reason_code = $6',
  ]
  const values = [intent.id, to, now, actorType, actorId, reasonCode || intent.reason_code]
  let i = 7
  if (timestampCol) {
    sets.push(`${timestampCol} = $${i}`)
    values.push(now)
    i += 1
  }
  if (provider !== undefined) {
    sets.push(`provider = $${i}`)
    values.push(provider)
    i += 1
  }
  if (providerEventId !== undefined) {
    sets.push(`provider_event_id = $${i}`)
    values.push(providerEventId)
    i += 1
  }
  if (extraSet) {
    sets.push(extraSet.replaceAll('?', () => { const p = `$${i}`; i += 1; return p }))
    values.push(...extraValues)
  }
  const { rows } = await client.query(
    `UPDATE fin.purchase_intents SET ${sets.join(', ')} WHERE id = $1 RETURNING *`,
    values,
  )
  return rows[0]
}

export async function createPurchaseIntent(input) {
  const env = envelope(input)
  requireReason(env.reasonCode)
  const holderId = input.holderId || input.holder_id
  const billingAccountId = input.billingAccountId || input.billing_account_id
  const productId = input.productId || input.product_id
  const provider = input.provider || null
  if (provider) assertProvider(provider)

  const quote = input.quote || (input.product
    ? quoteFromProduct(input.product, {
      holderId, currency: input.currency, promo: input.promo, now: env.now,
    })
    : productId
      ? await quoteProduct({
        productId, holderId, currency: input.currency, promo: input.promo, now: env.now,
      })
      : null)
  if (!quote) throw finError('FIN_PRODUCT_NOT_FOUND', { category: CATEGORY.PRECONDITION, httpStatus: 404 })
  const units = asUnits(quote.units)
  const bonusUnits = asUnits(quote.bonus_units)
  const minor = asUnits(quote.price_minor)
  if (units <= 0n || minor <= 0n) {
    throw finError('QUOTE_INVALID', { category: CATEGORY.VALIDATION })
  }

  const fingerprint = {
    cmd: 'CreatePurchaseIntent',
    tenantId: env.tenantId,
    holderId,
    quoteHash: quote.price_snapshot?.product_row_hash,
    reasonCode: env.reasonCode,
  }
  const key = env.idempotencyKey || `PI:CREATE:${fingerprint.quoteHash}:${holderId}:${randomUUID()}`
  return withRetry(async (client) => {
    const claimed = await claim(client, env, key, fingerprint)
    if (claimed.kind === 'replay') return claimed.row.response_body

    await allowPurchases(client, {
      environment: env.environment,
      tenantId: env.tenantId,
      holderId,
      billingAccountId,
    })

    const id = randomUUID()
    await client.query(
      `INSERT INTO fin.purchase_intents (
         id, environment, tenant_id, billing_account_id, holder_id, status,
         quoted_units, quoted_bonus_units, quoted_minor, currency, price_snapshot,
         provider, reason_code,
         created_at, created_by_actor_type, created_by_actor_id,
         updated_at, updated_by_actor_type, updated_by_actor_id
       ) VALUES (
         $1,$2,$3,$4,$5,'CREATED',
         $6,$7,$8,$9,$10::jsonb,
         $11,$12,
         $13,$14,$15,$13,$14,$15
       )`,
      [
        id, env.environment, env.tenantId, billingAccountId, holderId,
        unitsString(units), unitsString(bonusUnits), unitsString(minor),
        quote.currency, JSON.stringify(quote.price_snapshot),
        provider, env.reasonCode,
        env.now, env.actorType, env.actorId,
      ],
    )
    const intent = { id, environment: env.environment, status: 'CREATED' }
    await insertAudit(client, {
      environment: env.environment,
      actorType: env.actorType,
      actorId: env.actorId,
      actorEmail: env.actorEmail,
      action: 'PURCHASE_CREATED',
      targetType: 'PURCHASE_INTENT',
      targetId: id,
      afterState: { status: 'CREATED', units: unitsString(units), minor: unitsString(minor) },
      reasonCode: env.reasonCode,
      now: env.now,
    })
    await writeStatusOutbox(client, intent, { to: 'CREATED', now: env.now })
    return finish(client, claimed, env, {
      command: 'CreatePurchaseIntent',
      id,
      status: 'CREATED',
      quoted_units: unitsString(units),
      quoted_bonus_units: unitsString(bonusUnits),
      quoted_minor: unitsString(minor),
      currency: quote.currency,
    })
  })
}

export async function submitPurchasePayment(input) {
  const env = envelope(input)
  requireReason(env.reasonCode)
  const intentId = input.intentId || input.id
  const provider = input.provider || 'STRIPE'
  assertProvider(provider, { psp: true })
  const key = env.idempotencyKey || `PI:SUBMIT:${intentId}`
  return withRetry(async (client) => {
    const claimed = await claim(client, env, key, {
      cmd: 'SubmitPurchasePayment', intentId, provider,
    })
    if (claimed.kind === 'replay') return claimed.row.response_body

    await lockPurchaseIntent(client, intentId)
    const intent = await loadIntent(client, intentId, { forUpdate: true })
    if (intent.environment !== env.environment) {
      throw finError('ENV_MISMATCH', { category: CATEGORY.VALIDATION })
    }
    if (intent.provider_event_id) {
      throw finError('PURCHASE_ALREADY_PAID', { category: CATEGORY.CONFLICT })
    }
    if (intent.status !== 'CREATED' && intent.status !== 'FAILED') {
      if (intent.status === 'PAID') {
        throw finError('PURCHASE_ALREADY_PAID', { category: CATEGORY.CONFLICT })
      }
      throw illegalTransition(intent.status, 'PAYMENT_PENDING', 'SubmitPurchasePayment')
    }

    const updated = await stampTransition(client, intent, {
      to: 'PAYMENT_PENDING',
      now: env.now,
      actorType: env.actorType,
      actorId: env.actorId,
      reasonCode: env.reasonCode,
      provider,
      providerEventId: null,
    })
    await insertAudit(client, {
      environment: env.environment,
      actorType: env.actorType,
      actorId: env.actorId,
      actorEmail: env.actorEmail,
      action: 'PURCHASE_SUBMITTED',
      targetType: 'PURCHASE_INTENT',
      targetId: intentId,
      beforeState: { status: intent.status },
      afterState: { status: 'PAYMENT_PENDING', provider },
      reasonCode: env.reasonCode,
      now: env.now,
    })
    await writeStatusOutbox(client, updated, { to: 'PAYMENT_PENDING', now: env.now })
    const attempt = await writeStripeOutbox(client, updated, { now: env.now, action: 'submit' })
    return finish(client, claimed, env, {
      command: 'SubmitPurchasePayment',
      id: intentId,
      status: 'PAYMENT_PENDING',
      provider,
      stripeAttempt: attempt,
    })
  })
}

export async function confirmPurchasePayment(input) {
  const env = envelope(input)
  requireReason(env.reasonCode)
  const intentId = input.intentId || input.id
  const provider = input.provider || 'STRIPE'
  const providerEventId = input.providerEventId || input.provider_event_id
  assertProvider(provider)
  if (provider === 'STRIPE' && !providerEventId) {
    throw finError('QUOTE_INVALID', {
      category: CATEGORY.VALIDATION,
      details: { field: 'provider_event_id' },
    })
  }
  const webhookKey = providerEventId
    ? `wh:${provider}:${providerEventId}`
    : (env.idempotencyKey || `PI:CONFIRM:${intentId}`)
  const key = env.idempotencyKey || webhookKey
  return withRetry(async (client) => {
    // UNIQUE(provider, provider_event_id) is layer-3 (E §5). Check before
    // claim so a second intent with the same event id is REUSED, not a
    // fingerprint clash on `wh:STRIPE:{event_id}`.
    if (providerEventId) {
      const reused = await client.query(
        `SELECT id, status FROM fin.purchase_intents
          WHERE provider = $1 AND provider_event_id = $2
          FOR UPDATE`,
        [provider, providerEventId],
      )
      if (reused.rowCount) {
        const row = reused.rows[0]
        if (row.id !== intentId) {
          throw finError('PURCHASE_PROVIDER_EVENT_REUSED', {
            category: CATEGORY.CONFLICT,
            httpStatus: 409,
            details: { existing_intent_id: row.id },
          })
        }
      }
    }

    const claimed = await claim(client, env, key, {
      cmd: 'ConfirmPurchase', intentId, provider, providerEventId,
    })
    if (claimed.kind === 'replay') return claimed.row.response_body

    if (providerEventId) {
      const reused = await client.query(
        `SELECT id, status FROM fin.purchase_intents
          WHERE provider = $1 AND provider_event_id = $2`,
        [provider, providerEventId],
      )
      if (reused.rowCount) {
        const row = reused.rows[0]
        if (row.id !== intentId) {
          throw finError('PURCHASE_PROVIDER_EVENT_REUSED', {
            category: CATEGORY.CONFLICT,
            httpStatus: 409,
            details: { existing_intent_id: row.id },
          })
        }
        if (row.status === 'PAID') {
          const funded = await fundPurchaseFromIntent(client, {
            intentId, now: env.now, actorType: env.actorType, actorId: env.actorId,
            actorEmail: env.actorEmail, reasonCode: env.reasonCode,
            idempotencyKeyId: claimed.row.id,
          })
          return finish(client, claimed, env, {
            command: 'ConfirmPurchase',
            id: intentId,
            status: 'PAID',
            duplicate: true,
            txId: funded.txId,
            lotIds: funded.lotIds,
          })
        }
      }
    }

    await lockPurchaseIntent(client, intentId)
    const intent = await loadIntent(client, intentId, { forUpdate: true })
    if (intent.environment !== env.environment) {
      throw finError('ENV_MISMATCH', { category: CATEGORY.VALIDATION })
    }
    if (intent.status === 'PAID') {
      const funded = await fundPurchaseFromIntent(client, {
        intentId, now: env.now, actorType: env.actorType, actorId: env.actorId,
        actorEmail: env.actorEmail, reasonCode: env.reasonCode,
        idempotencyKeyId: claimed.row.id,
      })
      return finish(client, claimed, env, {
        command: 'ConfirmPurchase',
        id: intentId,
        status: 'PAID',
        duplicate: true,
        txId: funded.txId,
        lotIds: funded.lotIds,
      })
    }

    const fromCreated = intent.status === 'CREATED' && (provider === 'MANUAL' || provider === 'INVOICE')
    const fromPending = intent.status === 'PAYMENT_PENDING'
    if (!fromCreated && !fromPending) {
      if (intent.status === 'PAID') {
        throw finError('PURCHASE_ALREADY_PAID', { category: CATEGORY.CONFLICT })
      }
      throw illegalTransition(intent.status, 'PAID', 'ConfirmPurchase')
    }

    let updated
    try {
      updated = await stampTransition(client, intent, {
        to: 'PAID',
        now: env.now,
        actorType: env.actorType,
        actorId: env.actorId,
        reasonCode: env.reasonCode || 'PSP_CAPTURE',
        provider,
        providerEventId: providerEventId || null,
      })
    } catch (error) {
      if (error.code === '23505') {
        throw finError('PURCHASE_PROVIDER_EVENT_REUSED', {
          category: CATEGORY.CONFLICT,
          httpStatus: 409,
        })
      }
      throw error
    }

    const funded = await fundPurchaseFromIntent(client, {
      intentId, now: env.now, actorType: env.actorType, actorId: env.actorId,
      actorEmail: env.actorEmail, reasonCode: env.reasonCode || 'PSP_CAPTURE',
      idempotencyKeyId: claimed.row.id,
    })
    await recordDeferredRevenueForIntent(client, {
      intent: updated,
      fundingTxId: funded.txId,
      now: env.now,
      actor: { type: env.actorType, id: env.actorId, email: env.actorEmail },
    })
    await insertAudit(client, {
      environment: env.environment,
      actorType: env.actorType,
      actorId: env.actorId,
      actorEmail: env.actorEmail,
      action: 'PURCHASE_PAID',
      targetType: 'PURCHASE_INTENT',
      targetId: intentId,
      beforeState: { status: intent.status },
      afterState: { status: 'PAID', txId: funded.txId, lotIds: funded.lotIds },
      reasonCode: env.reasonCode || 'PSP_CAPTURE',
      now: env.now,
    })
    await writeStatusOutbox(client, updated, { to: 'PAID', now: env.now })
    await writeLifecycle(client, updated, { to: 'PAID', now: env.now })
    return finish(client, claimed, env, {
      command: 'ConfirmPurchase',
      id: intentId,
      status: 'PAID',
      duplicate: false,
      txId: funded.txId,
      lotIds: funded.lotIds,
    })
  })
}

export async function failPurchase(input) {
  const env = envelope(input)
  requireReason(env.reasonCode)
  const intentId = input.intentId || input.id
  const key = env.idempotencyKey || `PI:FAIL:${intentId}`
  return withRetry(async (client) => {
    const claimed = await claim(client, env, key, { cmd: 'FailPurchase', intentId })
    if (claimed.kind === 'replay') return claimed.row.response_body
    await lockPurchaseIntent(client, intentId)
    const intent = await loadIntent(client, intentId, { forUpdate: true })
    if (intent.status !== 'PAYMENT_PENDING') {
      throw illegalTransition(intent.status, 'FAILED', 'FailPurchase')
    }
    const updated = await stampTransition(client, intent, {
      to: 'FAILED',
      now: env.now,
      actorType: env.actorType,
      actorId: env.actorId,
      reasonCode: env.reasonCode,
      providerEventId: input.providerEventId || input.provider_event_id || intent.provider_event_id,
    })
    await insertAudit(client, {
      environment: env.environment,
      actorType: env.actorType,
      actorId: env.actorId,
      actorEmail: env.actorEmail,
      action: 'PURCHASE_FAILED',
      targetType: 'PURCHASE_INTENT',
      targetId: intentId,
      beforeState: { status: intent.status },
      afterState: { status: 'FAILED' },
      reasonCode: env.reasonCode,
      now: env.now,
    })
    await writeStatusOutbox(client, updated, { to: 'FAILED', now: env.now })
    await writeLifecycle(client, updated, { to: 'FAILED', now: env.now })
    return finish(client, claimed, env, {
      command: 'FailPurchase', id: intentId, status: 'FAILED',
    })
  })
}

export async function cancelPurchase(input) {
  const env = envelope(input)
  requireReason(env.reasonCode)
  const intentId = input.intentId || input.id
  const key = env.idempotencyKey || `PI:CANCEL:${intentId}`
  return withRetry(async (client) => {
    const claimed = await claim(client, env, key, { cmd: 'CancelPurchase', intentId })
    if (claimed.kind === 'replay') return claimed.row.response_body
    await lockPurchaseIntent(client, intentId)
    const intent = await loadIntent(client, intentId, { forUpdate: true })
    const fromCreated = intent.status === 'CREATED'
    const fromPending = intent.status === 'PAYMENT_PENDING'
    const fromFailed = intent.status === 'FAILED'
    if (!fromCreated && !fromPending && !fromFailed) {
      throw illegalTransition(intent.status, 'CANCELED', 'CancelPurchase')
    }
    const updated = await stampTransition(client, intent, {
      to: 'CANCELED',
      now: env.now,
      actorType: env.actorType,
      actorId: env.actorId,
      reasonCode: env.reasonCode,
    })
    await insertAudit(client, {
      environment: env.environment,
      actorType: env.actorType,
      actorId: env.actorId,
      actorEmail: env.actorEmail,
      action: 'PURCHASE_CANCELED',
      targetType: 'PURCHASE_INTENT',
      targetId: intentId,
      beforeState: { status: intent.status },
      afterState: { status: 'CANCELED' },
      reasonCode: env.reasonCode,
      now: env.now,
    })
    await writeStatusOutbox(client, updated, { to: 'CANCELED', now: env.now })
    if (fromPending) {
      await writeStripeOutbox(client, updated, { now: env.now, action: 'void' })
    }
    return finish(client, claimed, env, {
      command: 'CancelPurchase', id: intentId, status: 'CANCELED',
    })
  })
}

async function allowRefunds(client, { environment, tenantId, holderId, billingAccountId }) {
  const { rows } = await client.query(
    `SELECT subject_type, allow_refunds
       FROM fin.account_controls
      WHERE environment = $1
        AND (
          (subject_type = 'BILLING_ACCOUNT' AND subject_id = $2)
          OR (subject_type = 'HOLDER' AND subject_id = $3)
          OR (subject_type = 'TENANT' AND subject_id = $4)
        )`,
    [environment, billingAccountId, holderId, tenantId],
  )
  for (const rank of ALLOW_SUBJECTS) {
    const hit = rows.find((r) => r.subject_type === rank)
    if (hit && hit.allow_refunds === false) {
      throw finError('CONTROL_DENY', {
        category: CATEGORY.CONTROL,
        details: { flag: 'allow_refunds', subject_type: rank },
      })
    }
  }
}

/**
 * C §5.7 / Stage 10 un-501 of DL-095.
 * Reverse PURCHASE-lot remaining first (LIFO). If remaining depleted, emit
 * REFUND_REVERSAL lot. Cumulative REFUND txs ≤ quoted_minor. Full refund
 * flips PAID → REFUNDED. Stage 9 evaluateRefund → REFUND_REVENUE_REVERSED
 * (does NOT book credit-loss).
 */
export async function refundPurchase(input = {}) {
  const env = envelope(input)
  requireReason(env.reasonCode)
  const intentId = input.intentId || input.id || input.purchaseIntentId
  if (!intentId) {
    throw finError('PURCHASE_INTENT_NOT_FOUND', { category: CATEGORY.VALIDATION, httpStatus: 404 })
  }
  const provider = input.provider || null
  const providerEventId = input.providerEventId || input.provider_event_id || null
  const key = env.idempotencyKey
    || (providerEventId
      ? `wh:${provider || 'STRIPE'}:${providerEventId}`
      : `REFUND:${intentId}:${input.idemSuffix || '1'}`)
  return withRetry(async (client) => {
    const claimed = await claim(client, env, key, {
      cmd: 'RefundPurchase', intentId, provider, providerEventId,
      amountMinor: input.amountMinor != null ? String(input.amountMinor) : null,
    })
    if (claimed.kind === 'replay') return claimed.row.response_body
    await lockPurchaseIntent(client, intentId)
    const intent = await loadIntent(client, intentId, { forUpdate: true })
    if (intent.status !== 'PAID' && intent.status !== 'REFUNDED') {
      throw illegalTransition(intent.status, 'REFUNDED', 'RefundPurchase')
    }
    if (intent.status === 'REFUNDED') {
      return finish(client, claimed, env, {
        command: 'RefundPurchase', id: intentId, status: 'REFUNDED', replayed: true,
      })
    }
    await allowRefunds(client, {
      environment: intent.environment,
      tenantId: intent.tenant_id,
      holderId: intent.holder_id,
      billingAccountId: intent.billing_account_id,
    })

    const thisMinor = asUnits(input.amountMinor ?? input.amount_minor ?? intent.quoted_minor)
    const prior = await client.query(
      `SELECT COALESCE(SUM(ae.amount_minor), 0)::bigint AS qty
         FROM fin.accounting_events ae
        WHERE ae.event_kind = 'REFUND_REVENUE_REVERSED'
          AND ae.source_type = 'PURCHASE_INTENT'
          AND ae.source_id = $1`,
      [intentId],
    )
    if (asUnits(prior.rows[0].qty) + thisMinor > asUnits(intent.quoted_minor)) {
      throw finError('NOTE_EXCEEDS_INVOICE', {
        category: CATEGORY.PRECONDITION,
        details: { reason: 'cumulative_refund_exceeds_quoted' },
      })
    }

    const lots = await client.query(
      `SELECT * FROM fin.lots
        WHERE purchase_intent_id = $1 AND source_kind = 'PURCHASE'
        ORDER BY created_at DESC, id DESC
        FOR UPDATE`,
      [intentId],
    )
    await lockLots(client, lots.rows.map((l) => l.id))
    const openHold = await client.query(
      `SELECT h.id FROM fin.holds h
         JOIN fin.lot_allocations a ON a.hold_id = h.id
        WHERE a.lot_id = ANY($1::uuid[]) AND h.status = 'OPEN'
        LIMIT 1`,
      [lots.rows.map((l) => l.id)],
    )
    if (openHold.rowCount) {
      throw finError('HOLD_NOT_OPEN', {
        category: CATEGORY.PRECONDITION,
        details: { reason: 'open_hold_on_refund_lot', holdId: openHold.rows[0].id },
      })
    }

    const quotedUnits = asUnits(intent.quoted_units)
    const quotedMinor = asUnits(intent.quoted_minor)
    let unitsToReverse = input.units != null
      ? asUnits(input.units)
      : (quotedMinor === 0n ? 0n : (thisMinor * quotedUnits) / quotedMinor)
    if (unitsToReverse <= 0n) unitsToReverse = quotedUnits

    const bookRow = (await client.query(
      `SELECT * FROM fin.ledger_books
        WHERE billing_account_id = $1 AND environment = $2 AND book_type = 'CUSTOMER'
        ORDER BY id ASC LIMIT 1`,
      [intent.billing_account_id, intent.environment],
    )).rows[0]
    const book = await loadBook(client, bookRow.id)
    const accounts = await loadAccounts(client, book.id)
    await lockBooks(client, [book.id])
    await lockAccounts(client, Object.values(accounts))

    const refundId = randomUUID()
    const txId = await insertLedgerTx(client, {
      environment: intent.environment,
      bookId: book.id,
      shape: 'REFUND',
      economicSourceType: 'REFUND',
      economicSourceId: refundId,
      actorType: env.actorType,
      actorId: env.actorId,
      reasonCode: env.reasonCode,
      idempotencyKeyId: claimed.row.id,
      now: env.now,
    })

    let remainingNeed = unitsToReverse
    const reversedLots = []
    for (const lot of lots.rows) {
      if (remainingNeed <= 0n) break
      const avail = asUnits(lot.remaining_units)
      if (avail <= 0n) continue
      const take = avail < remainingNeed ? avail : remainingNeed
      const pair = await insertPostingPair(client, {
        environment: intent.environment,
        transactionId: txId,
        bookId: book.id,
        accounts,
        debitType: 'AVAILABLE',
        creditType: 'ISSUANCE',
        units: toSqlInt(take),
        debitLotId: lot.id,
        now: env.now,
      })
      await insertAllocation(client, {
        environment: intent.environment,
        lotId: lot.id,
        postingId: pair.debitId,
        units: toSqlInt(-take),
        now: env.now,
      })
      if (avail === take) {
        await client.query(
          `UPDATE fin.lots SET status = 'EXHAUSTED', updated_at = $2 WHERE id = $1`,
          [lot.id, env.now],
        )
      }
      remainingNeed -= take
      reversedLots.push({ lotId: lot.id, units: take.toString(), kind: 'REMAINING' })
    }

    let reversalLotId = null
    if (remainingNeed > 0n) {
      reversalLotId = await insertLot(client, {
        environment: intent.environment,
        tenantId: intent.tenant_id,
        bookId: book.id,
        billingAccountId: intent.billing_account_id,
        holderId: intent.holder_id,
        sourceKind: 'REFUND_REVERSAL',
        grantedUnits: toSqlInt(remainingNeed),
        remainingUnits: toSqlInt(remainingNeed),
        considerationMinor: 0,
        currency: intent.currency,
        purchaseIntentId: intentId,
        now: env.now,
      })
      await insertPostingPair(client, {
        environment: intent.environment,
        transactionId: txId,
        bookId: book.id,
        accounts,
        debitType: 'ISSUANCE',
        creditType: 'AVAILABLE',
        units: toSqlInt(remainingNeed),
        creditLotId: reversalLotId,
        now: env.now,
      })
      reversedLots.push({
        lotId: reversalLotId, units: remainingNeed.toString(), kind: 'REFUND_REVERSAL',
      })
    }

    // Stage 9 stamps REVENUE_RECOGNIZED as RATED_USAGE (DL-128), not
    // PURCHASE_INTENT. GREATEST of events vs the ON_CONSUMPTION line
    // accumulator so a fully consumed purchase still reverses (DL-144).
    const recognized = await client.query(
      `SELECT GREATEST(
           COALESCE((
             SELECT SUM(ae.amount_minor)
               FROM fin.accounting_events ae
              WHERE ae.event_kind = 'REVENUE_RECOGNIZED'
                AND (
                  (ae.source_type = 'PURCHASE_INTENT' AND ae.source_id = $1)
                  OR (
                    ae.source_type = 'RATED_USAGE'
                    AND ae.source_id IN (
                      SELECT l.rated_usage_id
                        FROM fin.revenue_allocation_lines l
                        JOIN fin.revenue_allocation_groups g ON g.id = l.group_id
                       WHERE g.source_type = 'PURCHASE_INTENT'
                         AND g.source_id = $1
                         AND l.rated_usage_id IS NOT NULL
                    )
                  )
                  OR (
                    ae.source_type = 'RATED_USAGE'
                    AND ae.source_id IN (
                      SELECT h.subject_id
                        FROM fin.lots l
                        JOIN fin.lot_allocations a ON a.lot_id = l.id
                        JOIN fin.holds h ON h.id = a.hold_id
                       WHERE l.purchase_intent_id = $1
                         AND h.subject_type = 'RATED_USAGE'
                         AND h.subject_id IS NOT NULL
                    )
                  )
                )
           ), 0),
           COALESCE((
             SELECT SUM(l.recognized_amount_minor)
               FROM fin.revenue_allocation_lines l
               JOIN fin.revenue_allocation_groups g ON g.id = l.group_id
              WHERE g.source_type = 'PURCHASE_INTENT'
                AND g.source_id = $1
           ), 0)
         )::bigint AS qty`,
      [intentId],
    )
    const policy = await loadActivePolicy(client, {
      environment: intent.environment,
      now: env.now,
    })
    const ba = (await client.query(
      `SELECT seller_legal_entity_id FROM fin.billing_accounts WHERE id = $1`,
      [intent.billing_account_id],
    )).rows[0]
    let recognizedMinor = asUnits(recognized.rows[0].qty)
    if (recognizedMinor === 0n && reversalLotId) {
      // Consumed-then-refund: units are gone so remaining_units cannot gate
      // the reversal. Reverse the refund amount itself (DL-144).
      recognizedMinor = thisMinor
    }
    const evaluated = evaluateRefund({
      id: intentId,
      currency: intent.currency,
      recognized_minor: recognizedMinor.toString(),
      refund_minor: thisMinor.toString(),
      sourceType: 'PURCHASE_INTENT',
    }, { id: txId, amountMinor: thisMinor.toString() }, policy.policy_definition)
    const events = await insertEvaluatedEvents(client, {
      evaluated,
      environment: intent.environment,
      tenantId: intent.tenant_id,
      billingAccountId: intent.billing_account_id,
      legalEntityId: ba?.seller_legal_entity_id,
      ledgerTransactionId: txId,
      now: env.now,
      actor: { type: env.actorType, id: env.actorId, email: env.actorEmail },
      currency: intent.currency,
    })

    const full = asUnits(prior.rows[0].qty) + thisMinor >= quotedMinor
    let status = 'PAID'
    if (full) {
      const updated = await stampTransition(client, intent, {
        to: 'REFUNDED',
        now: env.now,
        actorType: env.actorType,
        actorId: env.actorId,
        reasonCode: env.reasonCode,
      })
      status = 'REFUNDED'
      await writeStatusOutbox(client, updated, { to: 'REFUNDED', now: env.now })
      await writeLifecycle(client, updated, { to: 'REFUNDED', now: env.now })
    }
    await insertOutbox(client, {
      environment: intent.environment,
      topic: 'fin.ledger.posted',
      dedupeKey: `tx:${txId}`,
      payload: { txId, shape: 'REFUND' },
      now: env.now,
    })
    await insertAudit(client, {
      environment: intent.environment,
      actorType: env.actorType,
      actorId: env.actorId,
      actorEmail: env.actorEmail,
      action: 'PURCHASE_REFUNDED',
      targetType: 'PURCHASE_INTENT',
      targetId: intentId,
      afterState: { status, txId, refundId, lots: reversedLots },
      reasonCode: env.reasonCode,
      now: env.now,
    })
    return finish(client, claimed, env, {
      command: 'RefundPurchase',
      id: intentId,
      status,
      txId,
      refundId,
      amountMinor: thisMinor.toString(),
      lots: reversedLots,
      reversalLotId,
      events: events.map((e) => e.id),
    })
  })
}
