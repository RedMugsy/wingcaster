import { expect, it } from 'vitest'
import { NOW } from '../testing/seed.js'
import { finPostgresSuite } from '../testing/suite.js'
import { activatePriceVersion, draftPriceVersion } from '../pricing/prices.js'
import { rateMeteredUsage } from '../rating/engine.js'
import { rateInput, seedRatedCase } from '../rating/test-support.js'
import { runReconciliation } from './runner.js'

finPostgresSuite('reconciliation R040–R046 after rating', {}, ({ pool, world }) => {
  it('R040 R041 R045 R046 are GREEN after a real rate + re-rate; R042 is GREEN with OPEN_PERIOD', async () => {
    const seeded = await seedRatedCase(pool(), world(), {
      label: 'r040',
      eventCount: 4,
      unitRateMinor: 10,
    })
    const first = await rateMeteredUsage(rateInput(seeded))
    expect(first.ok).toBe(true)

    const v2 = await draftPriceVersion({
      environment: 'LIVE',
      reasonCode: 'TEST',
      now: NOW,
      priceId: seeded.priceId,
      model: 'PER_UNIT',
      unit_rate_minor: 11,
      effective_from: '2026-08-19T00:00:00.000Z',
    })
    await activatePriceVersion({
      environment: 'LIVE',
      reasonCode: 'TEST',
      now: NOW,
      priceId: seeded.priceId,
      priceVersionId: v2.id,
    })
    const second = await rateMeteredUsage(rateInput(seeded, { priceVersionId: v2.id }))
    expect(second.adjustmentOf).toBe(first.ratedUsageId)

    const run = await runReconciliation(pool(), { now: NOW })
    const byCode = Object.fromEntries(run.results.map((r) => [r.check_code, r]))
    expect(byCode.R040.result).toBe('GREEN')
    expect(byCode.R041.result).toBe('GREEN')
    expect(byCode.R045.result).toBe('GREEN')
    expect(byCode.R046.result).toBe('GREEN')
    expect(byCode.R042.result).toBe('GREEN')
  })
})
