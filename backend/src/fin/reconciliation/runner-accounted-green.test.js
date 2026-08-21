import { randomUUID } from 'node:crypto'
import { expect, it } from 'vitest'
import { commandEnv, insertApproval, NOW } from '../testing/seed.js'
import { finPostgresSuite } from '../testing/suite.js'
import { CHECKS } from './checks.js'
import { runReconciliation } from './runner.js'
import { spendCredits } from '../auth/spend.js'
import { seedIsolatedMeter } from '../metering/test-support.js'
import { activatePriceVersion, createPrice, draftPriceVersion } from '../pricing/prices.js'
import {
  activateContractVersion, createContract, draftContractVersion,
} from '../pricing/contracts.js'
import {
  confirmPurchasePayment, createPurchaseIntent,
} from '../funding/purchase-intents.js'
import { fundingEnv, insertControls, seedProduct } from '../funding/test-support.js'
import { expireLot } from '../ledger/expire-lot.js'
import { openDunningCase } from '../dunning/cases.js'
import { advanceDunning } from '../dunning/steps.js'
import { seedIssuedInvoice } from '../billing/test-support.js'
import { writeOffInvoice } from '../dunning/write-off-invoice.js'

const ERROR_CODES = new Set()

finPostgresSuite('reconciliation runner after accounting flow', {}, ({ pool, world }) => {
  it('non-ERROR checks are GREEN and R060–R063 are GREEN after the Stage 9 flow', async () => {
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
      label: 'acct-green',
      aggregationType: 'SUM',
    })
    const price = await createPrice({
      environment: 'LIVE', reasonCode: 'TEST', now: NOW, actorType: 'SYSTEM',
      code: `ag.${randomUUID()}`, currency: 'USD', meterId,
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
      contractNumber: `AG-${randomUUID()}`,
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
      unitsRequested: 20,
      occurredAt: NOW,
      receivedAt: NOW,
      now: NOW,
      reasonCode: 'TEST',
      actorType: 'SYSTEM',
      strategy: 'AUTHORIZE_AND_CAPTURE',
      idempotencyKey: `SPEND:${randomUUID()}`,
    })
    expect(spent.ok).toBe(true)

    const lot = await pool().query(
      `SELECT id FROM fin.lots
        WHERE purchase_intent_id = $1 AND source_kind = 'PURCHASE'`,
      [created.id],
    )
    await expireLot({
      ...commandEnv(world(), { reasonCode: 'LOT_TTL', actorType: 'WORKER' }),
      lotId: lot.rows[0].id,
      now: NOW,
    })

    await insertControls(pool(), {
      subjectType: 'BILLING_ACCOUNT',
      subjectId: world().tenantA.billingAccountId,
    })
    const issued = await seedIssuedInvoice(pool(), world(), {
      dueAt: '2020-01-01T00:00:00.000Z',
      amountMinor: 100,
    })
    const env = commandEnv(world(), { reasonCode: 'TEST' })
    const opened = await openDunningCase({
      ...env,
      invoiceId: issued.invoiceId,
      billingAccountId: world().tenantA.billingAccountId,
      invoiceStatus: 'ISSUED',
      dueAt: '2020-01-01T00:00:00.000Z',
      policyDelayMs: 0,
    })
    for (let i = 0; i < 6; i += 1) {
      await advanceDunning({
        ...env,
        caseId: opened.caseId,
        now: new Date(Date.now() + i * 1000).toISOString(),
        idempotencyKey: `DUNNING:ADV:${opened.caseId}:${i}`,
      })
    }
    const approvalId = await insertApproval(pool(), {
      tenantId: world().tenantA.tenantId,
      actionKind: 'WRITE_OFF',
      status: 'APPROVED',
    })
    await writeOffInvoice({
      ...env,
      invoiceId: issued.invoiceId,
      caseId: opened.caseId,
      amountMinor: 100,
      approvalRequestId: approvalId,
      billingAccountId: world().tenantA.billingAccountId,
    })

    const run = await runReconciliation(pool(), { now: NOW })
    const byCode = Object.fromEntries(run.results.map((r) => [r.check_code, r]))
    for (const check of CHECKS.filter((c) => !ERROR_CODES.has(c.check_code))) {
      expect(byCode[check.check_code].result, check.check_code).toBe('GREEN')
    }
    expect(byCode.R060.result).toBe('GREEN')
    expect(byCode.R061.result).toBe('GREEN')
    expect(byCode.R062.result).toBe('GREEN')
    expect(byCode.R063.result).toBe('GREEN')
  })
})
