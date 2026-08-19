import { describe, expect, it } from 'vitest'
import {
  computeStripeSignature, decodeStripeEvent, verifyStripeSignature,
} from './stripe.js'

const SECRET = 'whsec_test'
const NOW = '2026-08-20T12:00:00.000Z'
const TS = String(Math.floor(Date.parse(NOW) / 1000))

function sign(body) {
  const v1 = computeStripeSignature(SECRET, TS, body)
  return `t=${TS},v1=${v1}`
}

describe('stripe signature + decode (fast)', () => {
  it('accepts a matching v1 HMAC and rejects unsigned / wrong secret / stale timestamp', () => {
    const raw = '{"id":"evt_1","type":"payment_intent.succeeded"}'
    expect(verifyStripeSignature({
      rawBody: raw, header: sign(raw), secret: SECRET, now: NOW,
    }).ok).toBe(true)
    expect(verifyStripeSignature({
      rawBody: raw, header: null, secret: SECRET, now: NOW,
    })).toMatchObject({ ok: false, httpStatus: 401, error: 'unsigned' })
    expect(verifyStripeSignature({
      rawBody: raw, header: sign(raw), secret: 'other', now: NOW,
    })).toMatchObject({ ok: false, httpStatus: 401 })
    expect(verifyStripeSignature({
      rawBody: raw, header: `t=1,v1=${computeStripeSignature(SECRET, '1', raw)}`,
      secret: SECRET, now: NOW,
    })).toMatchObject({ ok: false, error: 'timestamp_window' })
    expect(verifyStripeSignature({
      rawBody: raw, header: sign(raw), secret: null, now: NOW,
    })).toMatchObject({ ok: false, error: 'missing_secret' })
  })

  it('decodes success vs hard-decline events and reads purchase_intent_id metadata', () => {
    const intentId = '11111111-1111-1111-1111-111111111111'
    const success = decodeStripeEvent(JSON.stringify({
      id: 'evt_ok',
      type: 'payment_intent.succeeded',
      data: { object: { metadata: { purchase_intent_id: intentId } } },
    }))
    expect(success).toMatchObject({ id: 'evt_ok', success: true, hardDecline: false, intentId })
    const failed = decodeStripeEvent(JSON.stringify({
      id: 'evt_no',
      type: 'payment_intent.payment_failed',
      data: { object: { metadata: { purchase_intent_id: intentId } } },
    }))
    expect(failed).toMatchObject({ hardDecline: true, success: false, intentId })
  })
})
