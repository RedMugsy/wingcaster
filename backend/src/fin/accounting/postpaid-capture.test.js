import { expect, it } from 'vitest'
import { finPostgresSuite } from '../testing/suite.js'
import { captureFacility, reserveFacility } from '../postpaid/reservations.js'
import { futureExpiry, seedActiveFacility } from '../postpaid/test-support.js'

finPostgresSuite('accounting postpaid capture', {}, ({ pool, world }) => {
  it('captureFacility writes RECEIVABLE_CREATED + REVENUE_RECOGNIZED for the same amount', async () => {
    const seeded = await seedActiveFacility(pool(), world(), { limitMinor: 6_000 })
    const reserved = await reserveFacility({
      ...seeded.env,
      facilityId: seeded.facilityId,
      reservedMinor: 800,
      expiresAt: futureExpiry(),
      holderId: world().tenantA.holderId,
    })
    const captured = await captureFacility({
      ...seeded.env,
      reservationId: reserved.reservationId,
      holderId: world().tenantA.holderId,
      bookId: world().tenantA.bookUsd.bookId,
    })
    expect(captured.txId).toBeTruthy()

    const events = await pool().query(
      `SELECT event_kind, amount_minor
         FROM fin.accounting_events
        WHERE source_type = 'FACILITY_RESERVATION' AND source_id = $1
        ORDER BY event_kind`,
      [reserved.reservationId],
    )
    expect(events.rows.map((r) => r.event_kind)).toEqual([
      'RECEIVABLE_CREATED', 'REVENUE_RECOGNIZED',
    ])
    expect(String(events.rows[0].amount_minor)).toBe('800')
    expect(String(events.rows[1].amount_minor)).toBe('800')
  })
})
