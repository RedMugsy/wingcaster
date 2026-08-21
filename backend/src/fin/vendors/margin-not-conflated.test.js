import { randomUUID } from 'node:crypto'
import { expect, it } from 'vitest'
import { NOW } from '../testing/seed.js'
import { finPostgresSuite } from '../testing/suite.js'
import { spendCredits } from '../auth/spend.js'
import {
  confirmPurchasePayment, createPurchaseIntent,
} from '../funding/purchase-intents.js'
import { fundingEnv, seedProduct } from '../funding/test-support.js'
import { seedIsolatedMeter } from '../metering/test-support.js'
import { activatePriceVersion, createPrice, draftPriceVersion } from '../pricing/prices.js'
import {
  activateContractVersion, createContract, draftContractVersion,
} from '../pricing/contracts.js'
import { computeMargin } from './margin.js'
import { closeMatchingStatement, seedVendorWorld } from './test-support.js'
import { transaction } from '../../db.js'

finPostgresSuite('fin.vendors margin-not-conflated', {}, ({ pool, world }) => {
  it('margin uses accounting revenue − actual cost and ignores lot.remaining_units', async () => {
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
      label: 'margin-nc',
      aggregationType: 'SUM',
    })
    const vendor = await seedVendorWorld(world(), {
      meterId,
      unitCostMinor: 7,
    })
    const price = await createPrice({
      environment: 'LIVE', reasonCode: 'TEST', now: NOW, actorType: 'SYSTEM',
      code: `mn.${randomUUID()}`, currency: 'USD', meterId,
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
      contractNumber: `MN-${randomUUID()}`,
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

    await closeMatchingStatement(world(), vendor, {
      quantityUnits: 30,
      tenantId: world().tenantA.tenantId,
      holderId: world().tenantA.holderId,
      finalize: true,
    })

    const before = await transaction((client) => computeMargin(client, {
      tenantId: world().tenantA.tenantId,
      from: '2026-01-01T00:00:00.000Z',
      to: '2027-01-01T00:00:00.000Z',
    }))
    expect(Number(before.recognizedRevenueMinor)).toBeGreaterThan(0)
    expect(Number(before.attributableProviderCostMinor)).toBeGreaterThan(0)
    expect(before.contributionMarginMinor).toBe(
      (BigInt(before.recognizedRevenueMinor) - BigInt(before.attributableProviderCostMinor)).toString(),
    )

    await pool().query(`
      DO $$
      DECLARE r record;
      BEGIN
        FOR r IN
          SELECT conname FROM pg_constraint
           WHERE conrelid = 'fin.lots'::regclass
             AND contype = 'c'
             AND pg_get_constraintdef(oid) ILIKE '%remaining_units%'
        LOOP
          EXECUTE format('ALTER TABLE fin.lots DROP CONSTRAINT %I', r.conname);
        END LOOP;
      END $$;
    `)
    await pool().query(`UPDATE fin.lots SET remaining_units = remaining_units + 999999`)
    const after = await transaction((client) => computeMargin(client, {
      tenantId: world().tenantA.tenantId,
      from: '2026-01-01T00:00:00.000Z',
      to: '2027-01-01T00:00:00.000Z',
    }))
    expect(after).toEqual(before)
  })
})
