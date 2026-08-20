import { expect, it } from 'vitest'
import { finPostgresSuite } from '../testing/suite.js'
import { directSpendPostpaid } from './direct-spend.js'
import { seedActiveFacility } from './test-support.js'

finPostgresSuite('direct spend postpaid', {}, ({ pool, world }) => {
  it('reserves and captures in one tx with no hold', async () => {
    const seeded = await seedActiveFacility(pool(), world(), { limitMinor: 8_000 })
    const spent = await directSpendPostpaid({
      ...seeded.env,
      holderId: world().tenantA.holderId,
      bookId: world().tenantA.bookUsd.bookId,
      unitsRequested: 500,
      amountMinor: 500,
      facility: { id: seeded.facilityId, status: 'ACTIVE' },
      idempotencyKey: `DSP:${crypto.randomUUID()}`,
    })
    expect(spent.ok).toBe(true)
    expect(spent.holdId).toBeNull()
    expect(spent.remainingUnits).toBe('0')
    const holds = await pool().query(
      `SELECT id FROM fin.holds WHERE facility_reservation_id = $1`,
      [spent.reservationId],
    )
    expect(holds.rowCount).toBe(0)
  })
})
