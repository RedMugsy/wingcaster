import { expect, it } from 'vitest'
import { finPostgresSuite } from '../testing/suite.js'
import { captureFacility, reserveFacility } from './reservations.js'
import { futureExpiry, seedActiveFacility } from './test-support.js'

finPostgresSuite('postpaid capture remaining_units=0', {}, ({ pool, world }) => {
  it('FACILITY_DRAW lot remaining_units is 0 after capture', async () => {
    const seeded = await seedActiveFacility(pool(), world(), { limitMinor: 4_000 })
    const reserved = await reserveFacility({
      ...seeded.env,
      facilityId: seeded.facilityId,
      reservedMinor: 2_000,
      expiresAt: futureExpiry(),
      holderId: world().tenantA.holderId,
    })
    const captured = await captureFacility({
      ...seeded.env,
      reservationId: reserved.reservationId,
      holderId: world().tenantA.holderId,
      bookId: world().tenantA.bookUsd.bookId,
    })
    const lot = await pool().query(
      `SELECT remaining_units, granted_units, status, source_kind
         FROM fin.lots WHERE id = $1`,
      [captured.lotId],
    )
    expect(lot.rows[0].source_kind).toBe('FACILITY_DRAW')
    expect(String(lot.rows[0].remaining_units)).toBe('0')
    expect(lot.rows[0].status).toBe('EXHAUSTED')
    expect(String(lot.rows[0].granted_units)).toBe('2000')
  })
})
