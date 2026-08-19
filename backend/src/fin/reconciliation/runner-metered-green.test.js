import { expect, it } from 'vitest'
import { NOW } from '../testing/seed.js'
import { finPostgresSuite } from '../testing/suite.js'
import { ingestUsageEvent } from '../usage/ingest.js'
import { meterPeriod } from '../metering/pipeline.js'
import { countUsageByEventType, meterInput, seedIsolatedMeter, usagePayload } from '../metering/test-support.js'
import { CHECKS } from './checks.js'
import { runReconciliation } from './runner.js'

// Own throwaway DB: runner.test.js's conservation-trigger bypass leaves R001
// unable to go GREEN in that same file afterwards.

finPostgresSuite('reconciliation runner after metering', {}, ({ pool, world }) => {
  it('R001–R039 stay GREEN after a metered seed world (R023 still ERROR; R040–R046 ERROR)', async () => {
    const { meterVersionId, eventType } = await seedIsolatedMeter(pool(), { label: 'runner' })
    await ingestUsageEvent(usagePayload(world(), { eventType, quantityUnits: 1_000_000 }))
    await ingestUsageEvent(usagePayload(world(), { eventType, quantityUnits: 2_000_000 }))
    expect(await countUsageByEventType(pool(), eventType)).toBe(2)
    const metered = await meterPeriod(meterInput(world(), { meterVersionId }))
    expect(metered.ok).toBe(true)

    const run = await runReconciliation(pool(), { now: NOW })
    const byCode = Object.fromEntries(run.results.map((r) => [r.check_code, r]))
    const errorCodes = new Set(['R023', 'R040', 'R041', 'R042', 'R043', 'R044', 'R045', 'R046', 'R049'])
    for (const check of CHECKS.filter((c) => !errorCodes.has(c.check_code))) {
      expect(byCode[check.check_code].result, check.check_code).toBe('GREEN')
    }
    expect(byCode.R022.result).toBe('GREEN')
    expect(byCode.R023.result).toBe('ERROR')
    expect(byCode.R047.result).toBe('GREEN')
    expect(byCode.R048.result).toBe('GREEN')
  })
})
