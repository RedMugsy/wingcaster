import { expect, it } from 'vitest'
import { NOW } from '../testing/seed.js'
import { finPostgresSuite } from '../testing/suite.js'
import { ingestUsageEvent } from '../usage/ingest.js'
import { meterPeriod } from '../metering/pipeline.js'
import { countUsageByEventType, meterInput, seedIsolatedMeter, usagePayload } from '../metering/test-support.js'
import { runReconciliation } from './runner.js'

finPostgresSuite('reconciliation R035–R039 after metering', {}, ({ pool, world }) => {
  it('R035 R036 R037 (and R034 R038 R039) are GREEN after a real meterPeriod including supersession', async () => {
    const { meterVersionId, eventType } = await seedIsolatedMeter(pool(), { label: 'recon' })
    const original = await ingestUsageEvent(usagePayload(world(), { eventType, quantityUnits: 1_000_000 }))
    await ingestUsageEvent(usagePayload(world(), { eventType, quantityUnits: 2_000_000 }))
    const first = await meterPeriod(meterInput(world(), { meterVersionId }))
    expect(first.ok).toBe(true)

    await ingestUsageEvent(usagePayload(world(), {
      eventType,
      eventKind: 'CORRECTION',
      correctsEventId: original.id,
      correctsResidencyKey: 'ksa',
      quantityUnits: 5_000_000,
      occurredAt: '2026-08-22T00:00:00.000Z',
    }))
    expect(await countUsageByEventType(pool(), eventType)).toBe(3)
    const second = await meterPeriod(meterInput(world(), { meterVersionId }))
    expect(second.superseded).toBe(first.meteredUsageId)

    const run = await runReconciliation(pool(), { now: NOW })
    const byCode = Object.fromEntries(run.results.map((r) => [r.check_code, r]))
    for (const code of ['R034', 'R035', 'R036', 'R037', 'R038', 'R039']) {
      expect(byCode[code], code).toBeTruthy()
      expect(byCode[code].result, code).toBe('GREEN')
    }
  })
})
