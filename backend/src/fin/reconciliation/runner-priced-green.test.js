import { expect, it } from 'vitest'
import { NOW } from '../testing/seed.js'
import { finPostgresSuite } from '../testing/suite.js'
import { activatePriceVersion, createPrice, draftPriceVersion } from '../pricing/prices.js'
import {
  activateContractVersion,
  createContract,
  draftContractVersion,
} from '../pricing/contracts.js'
import { CHECKS } from './checks.js'
import { runReconciliation } from './runner.js'

// Own throwaway DB: runner.test.js's conservation-trigger bypass leaves R001
// unable to go GREEN in that same file afterwards.

const ERROR_CODES = new Set(['R042', 'R044', 'R049', 'R053'])

finPostgresSuite('reconciliation runner after pricing activations', {}, ({ pool, world }) => {
  it('R047/R048 land in the GREEN batch after real price and contract activations', async () => {
    const price = await createPrice({
      environment: 'LIVE',
      reasonCode: 'TEST',
      now: NOW,
      code: 'priced.green',
      currency: 'USD',
    })
    const pv = await draftPriceVersion({
      environment: 'LIVE',
      reasonCode: 'TEST',
      now: NOW,
      priceId: price.id,
      model: 'PER_UNIT',
      unit_rate_minor: 7,
      effective_from: NOW,
    })
    await activatePriceVersion({
      environment: 'LIVE',
      reasonCode: 'TEST',
      now: NOW,
      priceId: price.id,
      priceVersionId: pv.id,
    })
    const contract = await createContract({
      environment: 'LIVE',
      tenantId: world().tenantA.tenantId,
      billingAccountId: world().tenantA.billingAccountId,
      sellerLegalEntityId: world().legalEntityId,
      contractNumber: 'PRICED-GREEN',
      billingCurrency: 'USD',
      billingTimezone: 'Asia/Riyadh',
      reasonCode: 'TEST',
      now: NOW,
    })
    const cv = await draftContractVersion({
      environment: 'LIVE',
      tenantId: world().tenantA.tenantId,
      reasonCode: 'TEST',
      now: NOW,
      contractId: contract.id,
      effective_from: NOW,
    })
    await activateContractVersion({
      environment: 'LIVE',
      tenantId: world().tenantA.tenantId,
      reasonCode: 'TEST',
      now: NOW,
      contractId: contract.id,
      contractVersionId: cv.id,
    })

    const run = await runReconciliation(pool(), { now: NOW })
    const byCode = Object.fromEntries(run.results.map((r) => [r.check_code, r]))
    for (const check of CHECKS.filter((c) => !ERROR_CODES.has(c.check_code))) {
      expect(byCode[check.check_code].result, check.check_code).toBe('GREEN')
    }
    expect(byCode.R047.result).toBe('GREEN')
    expect(byCode.R048.result).toBe('GREEN')
    expect(byCode.R040.result).toBe('GREEN')
    expect(byCode.R042.result).toBe('ERROR')
  })
})
