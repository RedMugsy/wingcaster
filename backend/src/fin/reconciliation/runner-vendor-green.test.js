import { expect, it } from 'vitest'
import { NOW } from '../testing/seed.js'
import { finPostgresSuite } from '../testing/suite.js'
import { CHECKS } from './checks.js'
import { runReconciliation } from './runner.js'
import { rateMeteredUsage } from '../rating/engine.js'
import { rateInput, seedRatedCase } from '../rating/test-support.js'
import { closeMatchingStatement, seedVendorWorld } from '../vendors/test-support.js'

finPostgresSuite('reconciliation runner after vendor economics', {}, ({ pool, world }) => {
  it('non-ERROR checks are GREEN after rate → cost estimate → statement → finalize', async () => {
    const seededCase = await seedRatedCase(pool(), world(), {
      label: 'vendor-green',
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
    const closed = await closeMatchingStatement(world(), vendor, {
      quantityUnits: qty,
      tenantId: world().tenantA.tenantId,
      holderId: seededCase.holderId,
      finalize: true,
    })
    expect(closed.final.status).toBe('FINALIZED')

    const attributed = await pool().query(
      `SELECT COUNT(*)::int AS n FROM fin.accounting_events
        WHERE event_kind = 'PROVIDER_COST_ATTRIBUTED'`,
    )
    expect(attributed.rows[0].n).toBeGreaterThan(0)

    const run = await runReconciliation(pool(), { now: NOW })
    const byCode = Object.fromEntries(run.results.map((r) => [r.check_code, r]))
    for (const check of CHECKS) {
      expect(byCode[check.check_code].result, check.check_code).toBe('GREEN')
    }
    expect(byCode.R080.result).toBe('GREEN')
    expect(byCode.R081.result).toBe('GREEN')
    expect(byCode.R082.result).toBe('GREEN')
    expect(byCode.R083.result).toBe('GREEN')
  })
})
