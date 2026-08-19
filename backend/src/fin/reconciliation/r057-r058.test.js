import { expect, it } from 'vitest'
import { NOW } from '../testing/seed.js'
import { finPostgresSuite } from '../testing/suite.js'
import { runReconciliation } from './runner.js'
import {
  confirmPurchasePayment, createPurchaseIntent,
} from '../funding/purchase-intents.js'
import { fundingEnv, seedProduct } from '../funding/test-support.js'

finPostgresSuite('reconciliation R057–R058 after funding', {}, ({ pool, world }) => {
  it('R057 PAID intent has FUNDING; R058 bonus consideration is 0', async () => {
    const productId = await seedProduct(world(), {
      units: 40, bonus_units: 8, price_minor: 400,
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
    })
    const run = await runReconciliation(pool(), { now: NOW })
    const byCode = Object.fromEntries(run.results.map((r) => [r.check_code, r]))
    expect(byCode.R057.result).toBe('GREEN')
    expect(byCode.R058.result).toBe('GREEN')
  })
})
