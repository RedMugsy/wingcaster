import { expect, it } from 'vitest'
import { finPostgresSuite } from '../testing/suite.js'
import { computeStripeSignature, confirmWebhook } from './psp/index.js'
import {
  confirmPurchasePayment, createPurchaseIntent, submitPurchasePayment,
} from './purchase-intents.js'
import { fundingEnv, seedProduct } from './test-support.js'

const SECRET = 'whsec_test'
const NOW = '2026-08-20T12:00:00.000Z'
const TS = String(Math.floor(Date.parse(NOW) / 1000))

function signed(event) {
  const raw = JSON.stringify(event)
  const header = `t=${TS},v1=${computeStripeSignature(SECRET, TS, raw)}`
  return { raw, headers: { 'stripe-signature': header } }
}

finPostgresSuite('psp-retry E §5', {}, ({ world }) => {
  async function pendingIntent() {
    const productId = await seedProduct(world())
    const created = await createPurchaseIntent({
      ...fundingEnv(world()),
      productId,
      provider: 'STRIPE',
    })
    await submitPurchasePayment({
      ...fundingEnv(world()),
      intentId: created.id,
      provider: 'STRIPE',
    })
    return created.id
  }

  it('same (provider, provider_event_id) twice returns the same PAID intent', async () => {
    const intentId = await pendingIntent()
    const eventId = `evt_${intentId}`
    const first = await confirmPurchasePayment({
      ...fundingEnv(world(), { actorType: 'PSP', reasonCode: 'PSP_CAPTURE' }),
      intentId,
      provider: 'STRIPE',
      providerEventId: eventId,
    })
    const second = await confirmPurchasePayment({
      ...fundingEnv(world(), { actorType: 'PSP', reasonCode: 'PSP_CAPTURE' }),
      intentId,
      provider: 'STRIPE',
      providerEventId: eventId,
      idempotencyKey: `wh:STRIPE:${eventId}:replay`,
    })
    expect(first.status).toBe('PAID')
    expect(second.status).toBe('PAID')
    expect(second.duplicate).toBe(true)
    expect(second.txId).toBe(first.txId)
  })

  it('different intent + same event_id → PURCHASE_PROVIDER_EVENT_REUSED', async () => {
    const a = await pendingIntent()
    const b = await pendingIntent()
    const eventId = `evt_shared_${a}`
    await confirmPurchasePayment({
      ...fundingEnv(world(), { actorType: 'PSP', reasonCode: 'PSP_CAPTURE' }),
      intentId: a,
      provider: 'STRIPE',
      providerEventId: eventId,
    })
    await expect(confirmPurchasePayment({
      ...fundingEnv(world(), { actorType: 'PSP', reasonCode: 'PSP_CAPTURE' }),
      intentId: b,
      provider: 'STRIPE',
      providerEventId: eventId,
    })).rejects.toMatchObject({ code: 'PURCHASE_PROVIDER_EVENT_REUSED' })
  })

  it('unsigned webhook is rejected 401; signed success confirms the intent', async () => {
    const intentId = await pendingIntent()
    const unsigned = await confirmWebhook(
      JSON.stringify({ id: 'evt_x', type: 'payment_intent.succeeded' }),
      {},
      { secret: SECRET, now: NOW },
    )
    expect(unsigned.httpStatus).toBe(401)

    const { raw, headers } = signed({
      id: `evt_ok_${intentId}`,
      type: 'payment_intent.succeeded',
      data: { object: { metadata: { purchase_intent_id: intentId } } },
    })
    const ok = await confirmWebhook(raw, headers, {
      secret: SECRET, now: NOW, environment: 'LIVE', reasonCode: 'PSP_CAPTURE',
    })
    expect(ok.httpStatus).toBe(200)
    expect(ok.body.status).toBe('PAID')
    expect(ok.body.duplicate).toBe(false)
  })
})
