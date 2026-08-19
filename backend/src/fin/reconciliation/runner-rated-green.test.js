import { expect, it } from 'vitest'
import { NOW } from '../testing/seed.js'
import { finPostgresSuite } from '../testing/suite.js'
import { rateMeteredUsage } from '../rating/engine.js'
import { rateInput, seedRatedCase } from '../rating/test-support.js'
import { CHECKS } from './checks.js'
import { runReconciliation } from './runner.js'

// Own throwaway DB: runner.test.js's conservation-trigger bypass leaves R001
// unable to go GREEN in that same file afterwards.

const ERROR_CODES = new Set(['R023', 'R042', 'R043', 'R044', 'R049'])

finPostgresSuite('reconciliation runner after rating', {}, ({ pool, world }) => {
  it('R040/R041/R045/R046 land in the GREEN batch after a real rating run', async () => {
    const seeded = await seedRatedCase(pool(), world(), {
      label: 'rated-green',
      eventCount: 3,
      unitRateMinor: 9,
    })
    const rated = await rateMeteredUsage(rateInput(seeded))
    expect(rated.ok).toBe(true)
    expect(rated.amountMinor).toBe(27)

    const run = await runReconciliation(pool(), { now: NOW })
    const byCode = Object.fromEntries(run.results.map((r) => [r.check_code, r]))
    for (const check of CHECKS.filter((c) => !ERROR_CODES.has(c.check_code))) {
      expect(byCode[check.check_code].result, check.check_code).toBe('GREEN')
    }
    expect(byCode.R040.result).toBe('GREEN')
    expect(byCode.R041.result).toBe('GREEN')
    expect(byCode.R045.result).toBe('GREEN')
    expect(byCode.R046.result).toBe('GREEN')
    expect(byCode.R042.result).toBe('ERROR')
    expect(byCode.R023.result).toBe('ERROR')
  })
})
