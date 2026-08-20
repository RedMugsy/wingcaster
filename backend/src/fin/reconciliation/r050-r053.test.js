import { expect, it } from 'vitest'
import { runReconciliation } from './runner.js'
import { finPostgresSuite } from '../testing/suite.js'
import { captureFacility, reserveFacility } from '../postpaid/reservations.js'
import { futureExpiry, seedActiveFacility } from '../postpaid/test-support.js'

finPostgresSuite('reconciliation R050–R053', {}, ({ pool, world }) => {
  it('R050–R052 are GREEN after a captured facility draw; R053 is ERROR without invoices', async () => {
    const seeded = await seedActiveFacility(pool(), world(), { limitMinor: 7_000 })
    const reserved = await reserveFacility({
      ...seeded.env,
      facilityId: seeded.facilityId,
      reservedMinor: 1_000,
      expiresAt: futureExpiry(),
      holderId: world().tenantA.holderId,
    })
    await captureFacility({
      ...seeded.env,
      reservationId: reserved.reservationId,
      holderId: world().tenantA.holderId,
      bookId: world().tenantA.bookUsd.bookId,
    })
    const run = await runReconciliation(pool(), { now: seeded.env.now })
    const byCode = Object.fromEntries(run.results.map((r) => [r.check_code, r]))
    expect(byCode.R050.result).toBe('GREEN')
    expect(byCode.R051.result).toBe('GREEN')
    expect(byCode.R052.result).toBe('GREEN')
    expect(byCode.R053.result).toBe('ERROR')
  })
})
