import { expect, it } from 'vitest'
import { NOW } from '../testing/seed.js'
import { finPostgresSuite } from '../testing/suite.js'
import { CHECKS } from './checks.js'
import { runReconciliation } from './runner.js'
import {
  confirmPurchasePayment, createPurchaseIntent,
} from '../funding/purchase-intents.js'
import { fundingEnv, seedProduct } from '../funding/test-support.js'

const ERROR_CODES = new Set(['R042', 'R043', 'R044', 'R049', 'R053'])

finPostgresSuite('reconciliation runner after funding', {}, ({ pool, world }) => {
  it('non-ERROR checks are GREEN after a real confirm → FUND', async () => {
    const productId = await seedProduct(world(), {
      units: 80, bonus_units: 20, price_minor: 800,
    })
    const created = await createPurchaseIntent({
      ...fundingEnv(world()),
      productId,
      provider: 'MANUAL',
    })
    const paid = await confirmPurchasePayment({
      ...fundingEnv(world(), { actorType: 'SYSTEM' }),
      intentId: created.id,
      provider: 'MANUAL',
      now: NOW,
    })
    expect(paid.status).toBe('PAID')
    expect(paid.txId).toBeTruthy()

    const run = await runReconciliation(pool(), { now: NOW })
    const byCode = Object.fromEntries(run.results.map((r) => [r.check_code, r]))
    for (const check of CHECKS.filter((c) => !ERROR_CODES.has(c.check_code))) {
      expect(byCode[check.check_code].result, check.check_code).toBe('GREEN')
    }
    expect(byCode.R057.result).toBe('GREEN')
    expect(byCode.R058.result).toBe('GREEN')
    expect(byCode.R023.result).toBe('ERROR')
  })
})
