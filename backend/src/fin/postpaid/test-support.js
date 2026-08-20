import { randomUUID } from 'node:crypto'
import { commandEnv } from '../testing/seed.js'
import { insertControls } from '../funding/test-support.js'
import {
  activateFacility, createFacility,
} from './facilities.js'

export async function seedActiveFacility(pool, world, {
  limitMinor = 10_000,
  currency,
  netTermsDays = 30,
} = {}) {
  const env = commandEnv(world, { reasonCode: 'TEST' })
  await insertControls(pool, {
    environment: env.environment,
    subjectType: 'BILLING_ACCOUNT',
    subjectId: world.tenantA.billingAccountId,
  })
  // One facility per (environment, billing_account_id, currency) (DL-111).
  // Shared-world files (facilities.test.js, reservations.test.js) call this
  // more than once; pick a free currency so create is a real insert, not a
  // replay of FACILITY:CREATE:{account}:USD with a different limitMinor.
  let chosen = currency || 'USD'
  if (!currency) {
    const taken = await pool.query(
      `SELECT 1 FROM fin.credit_facilities
        WHERE billing_account_id = $1 AND environment = $2 AND currency = $3`,
      [world.tenantA.billingAccountId, env.environment, 'USD'],
    )
    if (taken.rowCount) {
      chosen = `T${randomUUID().replace(/-/g, '').slice(0, 2).toUpperCase()}`
    }
  }
  const created = await createFacility({
    ...env,
    billingAccountId: world.tenantA.billingAccountId,
    currency: chosen,
    limitMinor,
    netTermsDays,
    actorType: 'SYSTEM',
    idempotencyKey: `FACILITY:CREATE:${randomUUID()}`,
  })
  const activated = await activateFacility({
    ...env,
    facilityId: created.facilityId,
    actorType: 'SYSTEM',
    idempotencyKey: `FACILITY:ACTIVATE:${created.facilityId}:${randomUUID()}`,
  })
  return { ...created, ...activated, env }
}

export function futureExpiry(ms = 15 * 60 * 1000) {
  return new Date(Date.now() + ms).toISOString()
}

export { randomUUID }
