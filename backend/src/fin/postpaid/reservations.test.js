import { expect, it } from 'vitest'
import { commandEnv } from '../testing/seed.js'
import { finPostgresSuite } from '../testing/suite.js'
import {
  captureFacility, expireFacilityReservation, releaseFacility, reserveFacility,
} from './reservations.js'
import { seedActiveFacility, futureExpiry } from './test-support.js'

finPostgresSuite('facility reservations B §12', {}, ({ pool, world }) => {
  it('OPEN → CAPTURED, OPEN → RELEASED, OPEN → EXPIRED', async () => {
    const seeded = await seedActiveFacility(pool(), world(), { limitMinor: 9_000 })
    const env = seeded.env
    const a = await reserveFacility({
      ...env, facilityId: seeded.facilityId, reservedMinor: 1_000,
      expiresAt: futureExpiry(), holderId: world().tenantA.holderId,
    })
    expect(a.status).toBe('OPEN')
    const captured = await captureFacility({
      ...env, reservationId: a.reservationId, holderId: world().tenantA.holderId,
      bookId: world().tenantA.bookUsd.bookId,
    })
    expect(captured.status).toBe('CAPTURED')
    expect(captured.remainingUnits).toBe('0')

    const b = await reserveFacility({
      ...env, facilityId: seeded.facilityId, reservedMinor: 1_000,
      expiresAt: futureExpiry(), idempotencyKey: `FACRES:${crypto.randomUUID()}`,
    })
    const released = await releaseFacility({ ...env, reservationId: b.reservationId })
    expect(released.status).toBe('RELEASED')

    const c = await reserveFacility({
      ...env, facilityId: seeded.facilityId, reservedMinor: 1_000,
      expiresAt: futureExpiry(), idempotencyKey: `FACRES:${crypto.randomUUID()}`,
    })
    const expired = await expireFacilityReservation({ ...env, reservationId: c.reservationId })
    expect(expired.status).toBe('EXPIRED')
  })

  it('concurrent reserves over the limit: one wins, one FACILITY_LIMIT_EXCEEDED', async () => {
    const seeded = await seedActiveFacility(pool(), world(), { limitMinor: 5_000 })
    const env = commandEnv(world(), { reasonCode: 'TEST' })
    const attempts = await Promise.allSettled([
      reserveFacility({
        ...env, facilityId: seeded.facilityId, reservedMinor: 5_000,
        expiresAt: futureExpiry(), idempotencyKey: `FACRES:${crypto.randomUUID()}`,
      }),
      reserveFacility({
        ...env, facilityId: seeded.facilityId, reservedMinor: 5_000,
        expiresAt: futureExpiry(), idempotencyKey: `FACRES:${crypto.randomUUID()}`,
      }),
    ])
    const ok = attempts.filter((r) => r.status === 'fulfilled')
    const denied = attempts.filter((r) => r.status === 'rejected')
    expect(ok).toHaveLength(1)
    expect(denied).toHaveLength(1)
    expect(denied[0].reason.code).toBe('FACILITY_LIMIT_EXCEEDED')
  })
})
