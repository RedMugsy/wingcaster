import { randomUUID } from 'node:crypto'
import { expect, it } from 'vitest'
import { NOW } from '../testing/seed.js'
import { finPostgresSuite } from '../testing/suite.js'
import { authorizeUsage } from '../auth/authorize.js'
import { captureUsage } from '../auth/capture.js'
import { authInput, seedAuthHolder } from '../auth/test-support.js'
import { runReconciliation } from './runner.js'

finPostgresSuite('reconciliation R020 R021 after real authorize + capture', {}, ({ pool, world }) => {
  it('R020 is GREEN for an OPEN hold; R021 is GREEN after capture', async () => {
    const seeded = await seedAuthHolder(pool(), world(), { label: 'r020', units: 100 })
    const authorized = await authorizeUsage(authInput(world(), seeded, {
      unitsRequested: 25,
      idempotencyKey: `AUTH:${randomUUID()}`,
    }))
    expect(authorized.ok).toBe(true)

    const open = await runReconciliation(pool(), { now: NOW })
    const openBy = Object.fromEntries(open.results.map((r) => [r.check_code, r]))
    expect(openBy.R020.result).toBe('GREEN')

    await captureUsage({
      holdId: authorized.holdId,
      now: NOW,
      reasonCode: 'TEST',
      actorType: 'SYSTEM',
    })

    const captured = await runReconciliation(pool(), { now: NOW })
    const capBy = Object.fromEntries(captured.results.map((r) => [r.check_code, r]))
    expect(capBy.R020.result).toBe('GREEN')
    expect(capBy.R021.result).toBe('GREEN')
    expect(capBy.R023.result).toBe('ERROR')
  })
})
