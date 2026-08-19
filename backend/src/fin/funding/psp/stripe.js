/**
 * Stripe PSP adapter. Called OUTSIDE fin.* transaction(fn) (I-14).
 * Airwallex / Areeba are Stage 8+ — interface is pluggable, not implemented.
 */
import { createHmac, timingSafeEqual } from 'node:crypto'
import { CATEGORY, FinError, finError } from '../../errors.js'
import { iso } from '../helpers.js'
import { confirmPurchasePayment, failPurchase } from '../purchase-intents.js'

export const STRIPE_SIGNATURE_TOLERANCE_SEC = 300

export function stripeSignedPayload(timestamp, rawBody) {
  const body = Buffer.isBuffer(rawBody) ? rawBody.toString('utf8') : String(rawBody || '')
  return `${timestamp}.${body}`
}

export function computeStripeSignature(secret, timestamp, rawBody) {
  return createHmac('sha256', secret)
    .update(stripeSignedPayload(timestamp, rawBody), 'utf8')
    .digest('hex')
}

export function parseStripeSignatureHeader(header) {
  const parts = Object.fromEntries(
    String(header || '')
      .split(',')
      .map((part) => part.trim().split('='))
      .filter((pair) => pair.length === 2),
  )
  return { timestamp: parts.t || null, v1: parts.v1 || null }
}

export function verifyStripeSignature({ rawBody, header, secret, now, toleranceSec = STRIPE_SIGNATURE_TOLERANCE_SEC }) {
  if (!secret) {
    return { ok: false, error: 'missing_secret', httpStatus: 401 }
  }
  if (!header) {
    return { ok: false, error: 'unsigned', httpStatus: 401 }
  }
  const { timestamp, v1 } = parseStripeSignatureHeader(header)
  if (!timestamp || !v1) {
    return { ok: false, error: 'malformed_signature', httpStatus: 401 }
  }
  const clock = now ? Date.parse(iso(now)) / 1000 : Date.now() / 1000
  const ts = Number(timestamp)
  if (!Number.isFinite(ts) || Math.abs(clock - ts) > toleranceSec) {
    return { ok: false, error: 'timestamp_window', httpStatus: 401 }
  }
  const expected = computeStripeSignature(secret, timestamp, rawBody)
  const left = Buffer.from(v1, 'utf8')
  const right = Buffer.from(expected, 'utf8')
  if (left.length !== right.length || !timingSafeEqual(left, right)) {
    return { ok: false, error: 'bad_signature', httpStatus: 401 }
  }
  return { ok: true, timestamp, v1 }
}

export function decodeStripeEvent(rawBody) {
  const text = Buffer.isBuffer(rawBody) ? rawBody.toString('utf8') : String(rawBody || '')
  let parsed
  try {
    parsed = JSON.parse(text)
  } catch {
    throw finError('QUOTE_INVALID', { category: CATEGORY.VALIDATION, details: { field: 'body' } })
  }
  return {
    id: parsed.id,
    type: parsed.type,
    data: parsed.data || {},
    intentId: parsed.data?.object?.metadata?.purchase_intent_id
      || parsed.data?.object?.metadata?.intentId
      || parsed.data?.object?.client_reference_id
      || null,
    hardDecline: parsed.type === 'payment_intent.payment_failed'
      || parsed.type === 'charge.failed',
    success: parsed.type === 'payment_intent.succeeded'
      || parsed.type === 'checkout.session.completed'
      || parsed.type === 'charge.succeeded',
    raw: parsed,
  }
}

/**
 * After-commit side effect. Never called inside transaction(fn).
 * Tests / missing Stripe key: returns a deterministic TEST action.
 */
export async function submitPayment(intent, providerHint = {}) {
  const provider = providerHint.provider || intent.provider || 'STRIPE'
  if (provider !== 'STRIPE') {
    return { provider, action: { type: 'none' } }
  }
  const secret = providerHint.secret || process.env.STRIPE_SECRET_KEY
  if (!secret) {
    return {
      provider: 'STRIPE',
      action: {
        type: 'client_secret',
        payment_intent_id: `pi_test_${intent.id.replaceAll('-', '').slice(0, 24)}`,
        client_secret: `cs_test_${intent.id.replaceAll('-', '').slice(0, 24)}`,
        simulated: true,
      },
    }
  }
  // Live Stripe SDK is not a Stage 7 dependency. Outbox worker retries until
  // ops wires a client; the HTTP path returns the TEST-shaped action when
  // STRIPE_SECRET_KEY is unset.
  return {
    provider: 'STRIPE',
    action: {
      type: 'client_secret',
      payment_intent_id: `pi_live_pending_${intent.id}`,
      client_secret: null,
      pending_worker: true,
    },
  }
}

export async function confirmWebhook(rawBody, headers, {
  secret, now, environment = 'LIVE', actorType = 'PSP', actorId = null,
  reasonCode = 'PSP_CAPTURE',
} = {}) {
  const header = headers?.['stripe-signature'] || headers?.['Stripe-Signature']
  const verified = verifyStripeSignature({
    rawBody,
    header,
    secret: secret || process.env.STRIPE_WEBHOOK_SECRET,
    now,
  })
  if (!verified.ok) {
    return { httpStatus: verified.httpStatus, body: { error: verified.error } }
  }

  let event
  try {
    event = decodeStripeEvent(rawBody)
  } catch {
    return { httpStatus: 400, body: { error: 'unparseable' } }
  }
  if (!event.id) {
    return { httpStatus: 400, body: { error: 'missing_event_id' } }
  }
  if (!event.success && !event.hardDecline) {
    return { httpStatus: 200, body: { received: true, duplicate: false, ignored: true } }
  }
  if (!event.intentId) {
    return { httpStatus: 400, body: { error: 'missing_intent_id' } }
  }

  try {
    if (event.hardDecline) {
      const failed = await failPurchase({
        intentId: event.intentId,
        provider: 'STRIPE',
        providerEventId: event.id,
        environment,
        actorType,
        actorId,
        reasonCode: 'PSP_DECLINE',
        now,
        idempotencyKey: `wh:STRIPE:${event.id}`,
      })
      return {
        httpStatus: 200,
        body: { received: true, duplicate: false, status: failed.status, id: failed.id },
      }
    }
    const confirmed = await confirmPurchasePayment({
      intentId: event.intentId,
      provider: 'STRIPE',
      providerEventId: event.id,
      environment,
      actorType,
      actorId,
      reasonCode,
      now,
      idempotencyKey: `wh:STRIPE:${event.id}`,
    })
    return {
      httpStatus: 200,
      body: {
        received: true,
        duplicate: Boolean(confirmed.duplicate),
        status: confirmed.status,
        id: confirmed.id,
        txId: confirmed.txId,
      },
    }
  } catch (error) {
    if (error instanceof FinError && error.code === 'IDEMPOTENCY_KEY_IN_FLIGHT') {
      return {
        httpStatus: 409,
        retryAfter: error.retryAfter || 2,
        body: { code: 'IDEMPOTENCY_IN_FLIGHT' },
      }
    }
    if (error instanceof FinError && error.code === 'PURCHASE_PROVIDER_EVENT_REUSED') {
      return { httpStatus: 409, body: error.toJSON() }
    }
    if (error instanceof FinError && error.code === 'PURCHASE_ILLEGAL_TRANSITION') {
      return { httpStatus: 400, body: error.toJSON() }
    }
    throw error
  }
}
