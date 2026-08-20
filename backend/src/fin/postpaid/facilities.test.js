import { describe, expect, it } from 'vitest'
import { commandEnv } from '../testing/seed.js'
import { finPostgresSuite } from '../testing/suite.js'
import {
  activateFacility, amendFacilityLimit, closeFacility, createFacility,
  pauseFacility, resumeFacility, suspendFacility,
} from './facilities.js'
import { seedActiveFacility } from './test-support.js'

describe('createFacility validation (fast)', () => {
  it('rejects a missing reason before opening a transaction', async () => {
    await expect(createFacility({
      billingAccountId: '00000000-0000-0000-0000-000000000001',
      currency: 'USD',
      limitMinor: 100,
      netTermsDays: 30,
    })).rejects.toMatchObject({ code: 'REASON_CODE_REQUIRED' })
  })
})

finPostgresSuite('credit facilities B §18', {}, ({ pool, world }) => {
  it('walks PENDING→ACTIVE→PAUSED→ACTIVE→SUSPENDED→ACTIVE→CLOSED', async () => {
    const env = commandEnv(world(), { reasonCode: 'TEST' })
    const created = await createFacility({
      ...env,
      billingAccountId: world().tenantA.billingAccountId,
      currency: 'USD',
      limitMinor: 5_000,
      netTermsDays: 15,
      actorType: 'SYSTEM',
    })
    expect(created.status).toBe('PENDING')
    const active = await activateFacility({ ...env, facilityId: created.facilityId, actorType: 'SYSTEM' })
    expect(active.status).toBe('ACTIVE')
    const paused = await pauseFacility({ ...env, facilityId: created.facilityId, actorType: 'SYSTEM' })
    expect(paused.status).toBe('PAUSED')
    const resumed = await resumeFacility({ ...env, facilityId: created.facilityId, actorType: 'SYSTEM' })
    expect(resumed.status).toBe('ACTIVE')
    const suspended = await suspendFacility({ ...env, facilityId: created.facilityId, actorType: 'WORKER' })
    expect(suspended.status).toBe('SUSPENDED')
    const unsuspended = await resumeFacility({ ...env, facilityId: created.facilityId, actorType: 'SYSTEM' })
    expect(unsuspended.status).toBe('ACTIVE')
    const closed = await closeFacility({ ...env, facilityId: created.facilityId, actorType: 'SYSTEM' })
    expect(closed.status).toBe('CLOSED')
  })

  it('rejects CLOSED→ACTIVE at the trigger', async () => {
    const seeded = await seedActiveFacility(pool(), world(), { limitMinor: 1_000 })
    await closeFacility({ ...seeded.env, facilityId: seeded.facilityId, actorType: 'SYSTEM' })
    await expect(activateFacility({
      ...seeded.env, facilityId: seeded.facilityId, actorType: 'SYSTEM',
    })).rejects.toBeTruthy()
  })

  it('amends limit_minor on ACTIVE', async () => {
    const seeded = await seedActiveFacility(pool(), world(), { limitMinor: 1_000 })
    const approvalId = await insertApprovalForOps(pool(), world())
    const amended = await amendFacilityLimit({
      ...seeded.env,
      facilityId: seeded.facilityId,
      limitMinor: 2_000,
      actorType: 'USER',
      actorId: world().tenantA.holderId,
      approvalRequestId: approvalId,
    })
    expect(Number(amended.limitMinor)).toBe(2_000)
  })
})

async function insertApprovalForOps(pool, world) {
  const { insertApproval } = await import('../testing/seed.js')
  return insertApproval(pool, {
    tenantId: world.tenantA.tenantId,
    actionKind: 'FACILITY_OPS',
  })
}
