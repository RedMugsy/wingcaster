import { expect, it } from 'vitest'
import { FIN_FACILITY_RESERVATION_EXPIRY } from '../foundation/advisory-locks.js'
import { finPostgresSuite } from '../testing/suite.js'
import { runFacilityReservationExpiryTick } from './expiry-worker.js'
import { reserveFacility } from './reservations.js'
import { seedActiveFacility } from './test-support.js'

finPostgresSuite('facility reservation expiry worker', {}, ({ pool, world }) => {
  it('expires OPEN rows whose expires_at is in the past', async () => {
    const seeded = await seedActiveFacility(pool(), world(), { limitMinor: 3_000 })
    const reserved = await reserveFacility({
      ...seeded.env,
      facilityId: seeded.facilityId,
      reservedMinor: 500,
      expiresAt: new Date(Date.now() - 60_000).toISOString(),
    })
    const tick = await runFacilityReservationExpiryTick({ pool: pool(), now: new Date().toISOString() })
    expect(tick.skipped).toBe(false)
    expect(tick.processed).toBeGreaterThanOrEqual(1)
    const row = await pool().query(
      `SELECT status FROM fin.facility_reservations WHERE id = $1`,
      [reserved.reservationId],
    )
    expect(row.rows[0].status).toBe('EXPIRED')
  })

  it('skips the tick when the advisory lock is held', async () => {
    const client = await pool().connect()
    try {
      await client.query('SELECT pg_advisory_lock($1, 0)', [FIN_FACILITY_RESERVATION_EXPIRY])
      const tick = await runFacilityReservationExpiryTick({ pool: pool() })
      expect(tick.skipped).toBe(true)
    } finally {
      await client.query('SELECT pg_advisory_unlock($1, 0)', [FIN_FACILITY_RESERVATION_EXPIRY])
      client.release()
    }
  })
})
