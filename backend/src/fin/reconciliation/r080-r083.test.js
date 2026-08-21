import { expect, it } from 'vitest'
import { finPostgresSuite } from '../testing/suite.js'
import { runReconciliation } from './runner.js'
import { rateMeteredUsage } from '../rating/engine.js'
import { rateInput, seedRatedCase } from '../rating/test-support.js'
import { closeMatchingStatement, seedVendorWorld } from '../vendors/test-support.js'

finPostgresSuite('reconciliation R080–R083', {}, ({ pool, world }) => {
  it('R080–R083 are GREEN after a finalized matching vendor statement', async () => {
    const seededCase = await seedRatedCase(pool(), world(), {
      label: 'r080',
      eventCount: 2,
      unitRateMinor: 10,
    })
    const vendor = await seedVendorWorld(world(), {
      meterId: seededCase.meterId,
      unitCostMinor: 5,
    })
    const rated = await rateMeteredUsage(rateInput(seededCase))
    const qty = Number((await pool().query(
      `SELECT measured_units FROM fin.rated_usage WHERE id = $1`,
      [rated.ratedUsageId],
    )).rows[0].measured_units)
    await closeMatchingStatement(world(), vendor, {
      quantityUnits: qty,
      tenantId: world().tenantA.tenantId,
      holderId: seededCase.holderId,
      finalize: true,
    })
    const run = await runReconciliation(pool(), { now: world().now })
    const byCode = Object.fromEntries(run.results.map((r) => [r.check_code, r]))
    expect(byCode.R080.result).toBe('GREEN')
    expect(byCode.R081.result).toBe('GREEN')
    expect(byCode.R082.result).toBe('GREEN')
    expect(byCode.R083.result).toBe('GREEN')
  })
})
