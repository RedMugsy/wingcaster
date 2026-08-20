import { randomUUID } from 'node:crypto'
import { commandEnv } from '../testing/seed.js'
import { insertControls } from '../funding/test-support.js'
import {
  activateFacility, createFacility,
} from './facilities.js'

export async function seedActiveFacility(pool, world, {
  limitMinor = 10_000,
  currency = 'USD',
  netTermsDays = 30,
} = {}) {
  const env = commandEnv(world, { reasonCode: 'TEST' })
  await insertControls(pool, {
    environment: env.environment,
    subjectType: 'BILLING_ACCOUNT',
    subjectId: world.tenantA.billingAccountId,
  })
  const created = await createFacility({
    ...env,
    billingAccountId: world.tenantA.billingAccountId,
    currency,
    limitMinor,
    netTermsDays,
    actorType: 'SYSTEM',
  })
  const activated = await activateFacility({
    ...env,
    facilityId: created.facilityId,
    actorType: 'SYSTEM',
  })
  return { ...created, ...activated, env }
}

export function futureExpiry(ms = 15 * 60 * 1000) {
  return new Date(Date.now() + ms).toISOString()
}

export { randomUUID }
