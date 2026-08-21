import { expect, it } from 'vitest'
import { NOW } from '../testing/seed.js'
import { finPostgresSuite } from '../testing/suite.js'
import { rateMeteredUsage } from '../rating/engine.js'
import { rateInput, seedRatedCase } from '../rating/test-support.js'
import { activateRateVersion, draftRateVersion, mapMeterVendor } from './registry.js'
import { seedVendorWorld, vendorEnv } from './test-support.js'

finPostgresSuite('fin.vendors rate-effective-date', {}, ({ pool, world }) => {
  it('rated_usage before the new version effective_from keeps the OLD unit_cost', async () => {
    const caseA = await seedRatedCase(pool(), world(), {
      label: 'rate-old',
      eventCount: 2,
      unitRateMinor: 10,
    })
    const seeded = await seedVendorWorld(world(), {
      meterId: caseA.meterId,
      unitCostMinor: 100,
      effectiveFrom: NOW,
    })
    await rateMeteredUsage(rateInput(caseA))
    const oldEstimate = await pool().query(
      `SELECT unit_cost_minor, vendor_rate_version_id FROM fin.vendor_cost_estimates
        WHERE rated_usage_id = (SELECT id FROM fin.rated_usage WHERE metered_usage_id = $1)
        AND status = 'ACTIVE'`,
      [caseA.meteredUsageId],
    )
    expect(Number(oldEstimate.rows[0].unit_cost_minor)).toBe(100)

    const v2 = await draftRateVersion(vendorEnv(world(), {
      rateCardId: seeded.rateCardId,
      rates: { [seeded.productCode]: { unit_cost_minor: 250, currency: 'USD' } },
      effective_from: '2026-10-01T00:00:00.000Z',
    }))
    await activateRateVersion(vendorEnv(world(), {
      rateCardId: seeded.rateCardId,
      rateVersionId: v2.id,
    }))

    const caseB = await seedRatedCase(pool(), world(), {
      label: 'rate-new',
      eventCount: 2,
      unitRateMinor: 10,
    })
    await pool().query(
      `UPDATE fin.metered_usage SET metered_at = $2 WHERE id = $1`,
      [caseB.meteredUsageId, '2026-10-02T00:00:00.000Z'],
    )
    await mapMeterVendor(vendorEnv(world(), {
      meterId: caseB.meterId,
      vendorId: seeded.vendorId,
      vendorProductCode: seeded.productCode,
      now: '2026-10-02T00:00:00.000Z',
    }))
    await rateMeteredUsage(rateInput(caseB, { now: '2026-10-02T00:00:00.000Z' }))

    const stillOld = await pool().query(
      `SELECT unit_cost_minor FROM fin.vendor_cost_estimates
        WHERE rated_usage_id = (SELECT id FROM fin.rated_usage WHERE metered_usage_id = $1)
        AND status = 'ACTIVE'`,
      [caseA.meteredUsageId],
    )
    const newer = await pool().query(
      `SELECT unit_cost_minor FROM fin.vendor_cost_estimates
        WHERE rated_usage_id = (SELECT id FROM fin.rated_usage WHERE metered_usage_id = $1)
        AND status = 'ACTIVE'`,
      [caseB.meteredUsageId],
    )
    expect(Number(stillOld.rows[0].unit_cost_minor)).toBe(100)
    expect(Number(newer.rows[0].unit_cost_minor)).toBe(250)
  })
})
