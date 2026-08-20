import { randomUUID } from 'node:crypto'
import { expect, it } from 'vitest'
import { finPostgresSuite } from '../testing/suite.js'
import {
  confirmPurchasePayment, createPurchaseIntent, refundPurchase,
} from '../funding/purchase-intents.js'
import { fundingEnv, seedProduct } from '../funding/test-support.js'
import { spendCredits } from '../auth/spend.js'
import { seedIsolatedMeter } from '../metering/test-support.js'
import { activatePriceVersion, createPrice, draftPriceVersion } from '../pricing/prices.js'
import {
  activateContractVersion, createContract, draftContractVersion,
} from '../pricing/contracts.js'
import { NOW } from '../testing/seed.js'

finPostgresSuite('billing refundPurchase C §5.7', {}, ({ pool, world }) => {
  it('full unused refund reverses remaining PURCHASE lots and flips REFUNDED', async () => {
    const productId = await seedProduct(world(), {
      units: 40, bonus_units: 0, price_minor: 400,
    })
    const created = await createPurchaseIntent({
      ...fundingEnv(world()),
      productId,
      provider: 'MANUAL',
    })
    await confirmPurchasePayment({
      ...fundingEnv(world(), { actorType: 'SYSTEM' }),
      intentId: created.id,
      provider: 'MANUAL',
      now: NOW,
    })
    const refunded = await refundPurchase({
      ...fundingEnv(world(), { actorType: 'SYSTEM' }),
      intentId: created.id,
      amountMinor: 400,
    })
    expect(refunded.status).toBe('REFUNDED')
    expect(refunded.lots.every((l) => l.kind === 'REMAINING')).toBe(true)
    const intent = await pool().query(
      `SELECT status FROM fin.purchase_intents WHERE id = $1`,
      [created.id],
    )
    expect(intent.rows[0].status).toBe('REFUNDED')
  })

  it('consumed-then-refund emits REFUND_REVERSAL and REFUND_REVENUE_REVERSED', async () => {
    const productId = await seedProduct(world(), {
      units: 50, bonus_units: 0, price_minor: 500,
    })
    const created = await createPurchaseIntent({
      ...fundingEnv(world()),
      productId,
      provider: 'MANUAL',
    })
    await confirmPurchasePayment({
      ...fundingEnv(world(), { actorType: 'SYSTEM' }),
      intentId: created.id,
      provider: 'MANUAL',
      now: NOW,
    })
    const { meterId, meterVersionId, eventType } = await seedIsolatedMeter(pool(), {
      label: 'refund',
      aggregationType: 'SUM',
    })
    const price = await createPrice({
      environment: 'LIVE', reasonCode: 'TEST', now: NOW, actorType: 'SYSTEM',
      code: `rf.${randomUUID()}`, currency: 'USD', meterId,
    })
    const pv = await draftPriceVersion({
      environment: 'LIVE', reasonCode: 'TEST', now: NOW,
      priceId: price.id, model: 'PER_UNIT', unit_rate_minor: 10, effective_from: NOW,
    })
    await activatePriceVersion({
      environment: 'LIVE', reasonCode: 'TEST', now: NOW,
      priceId: price.id, priceVersionId: pv.id,
    })
    const contract = await createContract({
      environment: 'LIVE', reasonCode: 'TEST', now: NOW,
      tenantId: world().tenantA.tenantId,
      billingAccountId: world().tenantA.billingAccountId,
      sellerLegalEntityId: world().legalEntityId,
      contractNumber: `RF-${randomUUID()}`,
      billingCurrency: 'USD',
      billingTimezone: 'Asia/Riyadh',
    })
    const cv = await draftContractVersion({
      environment: 'LIVE', reasonCode: 'TEST', now: NOW,
      tenantId: world().tenantA.tenantId,
      contractId: contract.id,
      effective_from: NOW,
      components: [{ component_type: 'METER_PRICE', priceId: price.id, meterId }],
    })
    await activateContractVersion({
      environment: 'LIVE', reasonCode: 'TEST', now: NOW,
      tenantId: world().tenantA.tenantId,
      contractId: contract.id,
      contractVersionId: cv.id,
    })
    const spent = await spendCredits({
      environment: 'LIVE',
      tenantId: world().tenantA.tenantId,
      holderId: world().tenantA.holderId,
      bookId: world().tenantA.bookUsd.bookId,
      meterId,
      meterVersionId,
      sourceSystem: 'orchestrator',
      sourceEventId: randomUUID(),
      eventType,
      unitsRequested: 50,
      occurredAt: NOW,
      receivedAt: NOW,
      now: NOW,
      reasonCode: 'TEST',
      actorType: 'SYSTEM',
      strategy: 'AUTHORIZE_AND_CAPTURE',
      idempotencyKey: `SPEND:${randomUUID()}`,
    })
    expect(spent.ok).toBe(true)

    const refunded = await refundPurchase({
      ...fundingEnv(world(), { actorType: 'SYSTEM' }),
      intentId: created.id,
      amountMinor: 500,
    })
    expect(refunded.status).toBe('REFUNDED')
    expect(refunded.lots.some((l) => l.kind === 'REFUND_REVERSAL')).toBe(true)
    const events = await pool().query(
      `SELECT event_kind FROM fin.accounting_events
        WHERE source_id = $1 AND event_kind = 'REFUND_REVENUE_REVERSED'`,
      [created.id],
    )
    expect(events.rowCount).toBeGreaterThan(0)
  })

  it('PSP refund events dedupe on wh:{provider}:{event_id}', async () => {
    const productId = await seedProduct(world(), {
      units: 10, bonus_units: 0, price_minor: 100,
    })
    const created = await createPurchaseIntent({
      ...fundingEnv(world()),
      productId,
      provider: 'MANUAL',
    })
    await confirmPurchasePayment({
      ...fundingEnv(world(), { actorType: 'SYSTEM' }),
      intentId: created.id,
      provider: 'MANUAL',
      now: NOW,
    })
    const eventId = `re_${randomUUID()}`
    const first = await refundPurchase({
      ...fundingEnv(world(), { actorType: 'SYSTEM' }),
      intentId: created.id,
      amountMinor: 100,
      provider: 'STRIPE',
      providerEventId: eventId,
    })
    const second = await refundPurchase({
      ...fundingEnv(world(), { actorType: 'SYSTEM' }),
      intentId: created.id,
      amountMinor: 100,
      provider: 'STRIPE',
      providerEventId: eventId,
    })
    expect(second.id).toBe(first.id)
    expect(second.status).toBe('REFUNDED')
  })
})
