import { expect, it } from 'vitest'
import { runReconciliation } from './runner.js'
import { finPostgresSuite } from '../testing/suite.js'
import { captureFacility, reserveFacility } from '../postpaid/reservations.js'
import { futureExpiry, seedActiveFacility } from '../postpaid/test-support.js'

const ERROR_CODES = new Set(['R042', 'R043', 'R044', 'R049', 'R053'])

finPostgresSuite('reconciliation runner after postpaid capture', {}, ({ pool, world }) => {
  it('non-ERROR checks are GREEN after reserve+capture', async () => {
    const seeded = await seedActiveFacility(pool(), world(), { limitMinor: 6_000 })
    const reserved = await reserveFacility({
      ...seeded.env,
      facilityId: seeded.facilityId,
      reservedMinor: 800,
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
    for (const [code, row] of Object.entries(byCode)) {
      if (ERROR_CODES.has(code)) {
        expect(row.result, code).toBe('ERROR')
      } else {
        expect(row.result, code).toBe('GREEN')
      }
    }
  })
})
