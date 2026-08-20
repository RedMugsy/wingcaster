import { randomUUID } from 'node:crypto'
import { expect, it } from 'vitest'
import { NOW, commandEnv, seedBook } from '../testing/seed.js'
import { finPostgresSuite } from '../testing/suite.js'
import { rateMeteredUsage } from '../rating/engine.js'
import { rateInput, seedRatedCase } from '../rating/test-support.js'
import { fundPurchase } from '../ledger/transactions.js'
import { authorizeUsage } from '../auth/authorize.js'
import { captureUsage } from '../auth/capture.js'
import { CHECKS } from './checks.js'
import { runReconciliation } from './runner.js'

const ERROR_CODES = new Set(['R042', 'R044', 'R049', 'R053'])

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

    const book = await seedBook(pool(), {
      environment: 'LIVE',
      tenantId: world().tenantA.tenantId,
      billingAccountId: seeded.billingAccountId,
    })
    await fundPurchase({
      ...commandEnv(world(), { holderId: seeded.holderId, bookId: book.bookId }),
      purchaseIntentId: randomUUID(),
      paidUnits: 50,
      bonusUnits: 0,
      considerationMinor: 1,
    })
    const authorized = await authorizeUsage({
      ...commandEnv(world(), { holderId: seeded.holderId, bookId: book.bookId }),
      meterId: seeded.meterId,
      unitsRequested: 3,
      ratedUsageId: rated.ratedUsageId,
      subjectType: 'RATED_USAGE',
      subjectId: rated.ratedUsageId,
      idempotencyKey: `AUTH:${rated.ratedUsageId}`,
      now: NOW,
    })
    expect(authorized.ok).toBe(true)
    await captureUsage({
      holdId: authorized.holdId,
      now: NOW,
      reasonCode: 'TEST',
      actorType: 'SYSTEM',
    })

    const run = await runReconciliation(pool(), { now: NOW })
    const byCode = Object.fromEntries(run.results.map((r) => [r.check_code, r]))
    for (const check of CHECKS.filter((c) => !ERROR_CODES.has(c.check_code))) {
      expect(byCode[check.check_code].result, check.check_code).toBe('GREEN')
    }
    expect(byCode.R020.result).toBe('GREEN')
    expect(byCode.R021.result).toBe('GREEN')
    expect(byCode.R022.result).toBe('GREEN')
    expect(byCode.R040.result).toBe('GREEN')
    expect(byCode.R041.result).toBe('GREEN')
    expect(byCode.R045.result).toBe('GREEN')
    expect(byCode.R046.result).toBe('GREEN')
    expect(byCode.R042.result).toBe('ERROR')
    expect(byCode.R023.result).toBe('GREEN')
  })
})
