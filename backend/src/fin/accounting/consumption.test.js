import { randomUUID } from 'node:crypto'
import { expect, it } from 'vitest'
import { seedIsolatedMeter } from '../metering/test-support.js'
import { activatePriceVersion, createPrice, draftPriceVersion } from '../pricing/prices.js'
import {
  activateContractVersion, createContract, draftContractVersion,
} from '../pricing/contracts.js'
import { NOW } from '../testing/seed.js'
import { finPostgresSuite } from '../testing/suite.js'
import { spendCredits } from '../auth/spend.js'
import {
  confirmPurchasePayment, createPurchaseIntent,
} from '../funding/purchase-intents.js'
import { fundingEnv, seedProduct } from '../funding/test-support.js'

finPostgresSuite('accounting consumption', {}, ({ pool, world }) => {
  it('spendCredits AUTHORIZE_AND_CAPTURE writes REVENUE_RECOGNIZED = rated amount and bumps the line', async () => {
    const productId = await seedProduct(world(), {
      units: 100, bonus_units: 0, price_minor: 1000,
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
      label: 'acct-consume',
      aggregationType: 'SUM',
    })
    const price = await createPrice({
      environment: 'LIVE', reasonCode: 'TEST', now: NOW, actorType: 'SYSTEM',
      code: `ac.${randomUUID()}`, currency: 'USD', meterId,
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
      contractNumber: `AC-${randomUUID()}`,
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
      unitsRequested: 30,
      occurredAt: NOW,
      receivedAt: NOW,
      now: NOW,
      reasonCode: 'TEST',
      actorType: 'SYSTEM',
      strategy: 'AUTHORIZE_AND_CAPTURE',
      idempotencyKey: `SPEND:${randomUUID()}`,
    })
    expect(spent.ok).toBe(true)

    const rated = await pool().query(
      `SELECT amount_minor FROM fin.rated_usage WHERE id = $1`,
      [spent.ratedUsageId],
    )
    const recognized = await pool().query(
      `SELECT amount_minor FROM fin.accounting_events
        WHERE event_kind = 'REVENUE_RECOGNIZED' AND source_id = $1`,
      [spent.ratedUsageId],
    )
    expect(recognized.rowCount).toBe(1)
    expect(String(recognized.rows[0].amount_minor)).toBe(String(rated.rows[0].amount_minor))

    const line = await pool().query(
      `SELECT recognized_amount_minor, status
         FROM fin.revenue_allocation_lines
        WHERE group_id = (
          SELECT id FROM fin.revenue_allocation_groups
           WHERE source_type = 'PURCHASE_INTENT' AND source_id = $1
        )`,
      [created.id],
    )
    expect(String(line.rows[0].recognized_amount_minor)).toBe(String(rated.rows[0].amount_minor))
    expect(['PARTIAL', 'RECOGNIZED']).toContain(line.rows[0].status)
  })
})
