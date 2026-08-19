import { expect, it } from 'vitest'
import { randomUUID } from 'node:crypto'
import { asRole, NOW } from '../testing/seed.js'
import { finPostgresSuite } from '../testing/suite.js'
import { rateMeteredUsage } from './engine.js'
import { rateInput, seedRatedCase } from './test-support.js'

finPostgresSuite('fin.rated_usage append-only grants', {}, ({ pool, world }) => {
  it('fin_app_role cannot UPDATE or DELETE rated_usage; CHECK rejects bad billable_units', async () => {
    const seeded = await seedRatedCase(pool(), world(), { label: 'append', eventCount: 2 })
    const rated = await rateMeteredUsage(rateInput(seeded))
    const gucs = {
      'fin.environment': 'LIVE',
      'fin.tenant_id': world().tenantA.tenantId,
    }
    const client = await pool().connect()
    try {
      await expect(asRole(client, 'fin_app_role', gucs, (c) => c.query(
        `UPDATE fin.rated_usage SET amount_minor = 1 WHERE id = $1`,
        [rated.ratedUsageId],
      ))).rejects.toThrow(/permission denied|insufficient privilege/i)

      await expect(asRole(client, 'fin_app_role', gucs, (c) => c.query(
        `DELETE FROM fin.rated_usage WHERE id = $1`,
        [rated.ratedUsageId],
      ))).rejects.toThrow(/permission denied|insufficient privilege/i)

      await expect(pool().query(
        `INSERT INTO fin.rated_usage (
           id, environment, tenant_id, metered_usage_id, contract_version_id,
           price_version_id, measured_units, included_units, billable_units,
           amount_minor, currency, rating_hash, explanation, late_class,
           occurred_at, received_at, metered_at, rated_at, created_at,
           adjustment_of_id
         ) VALUES (
           $1,'LIVE',$2,$3,$4,
           $5,10,0,9,
           0,'USD','deadbeef','{}'::jsonb,'OPEN_PERIOD',
           $6,$6,$6,$6,$6,
           $7
         )`,
        [
          randomUUID(), world().tenantA.tenantId, seeded.meteredUsageId,
          seeded.contractVersionId, seeded.priceVersionId, NOW,
          rated.ratedUsageId,
        ],
      )).rejects.toThrow(/check constraint|billable_units/i)
    } finally {
      client.release()
    }
  })
})
