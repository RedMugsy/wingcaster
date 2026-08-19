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

function priceEnv(world, extra = {}) {
  return {
    environment: 'LIVE',
    reasonCode: 'TEST',
    actorType: 'SYSTEM',
    now: world.now,
    ...extra,
  }
}

finPostgresSuite('reconciliation R040–R049 after pricing', {}, ({ pool, world }) => {
  it('R047 and R048 are GREEN after real activations; R042–R044/R049 stay ERROR; empty R040/R041/R045/R046 GREEN', async () => {
    const price = await createPrice(priceEnv(world(), { code: 'r047.p', currency: 'USD' }))
    const pv = await draftPriceVersion(priceEnv(world(), {
      priceId: price.id,
      model: 'PER_UNIT',
      unit_rate_minor: 10,
      effective_from: NOW,
    }))
    await activatePriceVersion(priceEnv(world(), {
      priceId: price.id,
      priceVersionId: pv.id,
    }))

    const contract = await createContract({
      ...priceEnv(world()),
      tenantId: world().tenantA.tenantId,
      billingAccountId: world().tenantA.billingAccountId,
      sellerLegalEntityId: world().legalEntityId,
      contractNumber: 'R048-1',
      billingCurrency: 'USD',
      billingTimezone: 'Asia/Riyadh',
    })
    const cv = await draftContractVersion({
      ...priceEnv(world()),
      tenantId: world().tenantA.tenantId,
      contractId: contract.id,
      effective_from: NOW,
    })
    await activateContractVersion({
      ...priceEnv(world()),
      tenantId: world().tenantA.tenantId,
      contractId: contract.id,
      contractVersionId: cv.id,
    })

    const run = await runReconciliation(pool(), { now: NOW })
    const byCode = Object.fromEntries(run.results.map((r) => [r.check_code, r]))
    expect(CHECKS.some((c) => c.check_code === 'R047')).toBe(true)
    expect(byCode.R047.result).toBe('GREEN')
    expect(byCode.R048.result).toBe('GREEN')
    for (const code of ['R040', 'R041', 'R045', 'R046']) {
      expect(byCode[code].result, code).toBe('GREEN')
    }
    for (const code of ['R042', 'R043', 'R044', 'R049']) {
      expect(byCode[code].result, code).toBe('ERROR')
    }
  })
})
