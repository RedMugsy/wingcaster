import { expect, it } from 'vitest'
import { finPostgresSuite } from '../testing/suite.js'
import { rateMeteredUsage } from '../rating/engine.js'
import { rateInput, seedRatedCase } from '../rating/test-support.js'
import { closeMatchingStatement, seedVendorWorld } from './test-support.js'

finPostgresSuite('fin.vendors traceability', {}, ({ pool, world }) => {
  it('customer charge → rated_usage → estimate → actual → statement line is joinable', async () => {
    const seededCase = await seedRatedCase(pool(), world(), {
      label: 'trace',
      eventCount: 2,
      unitRateMinor: 10,
    })
    const vendor = await seedVendorWorld(world(), {
      meterId: seededCase.meterId,
      unitCostMinor: 7,
    })
    const rated = await rateMeteredUsage(rateInput(seededCase))
    const hops = await pool().query(
      `SELECT ru.id AS rated_usage_id,
              e.id AS estimate_id,
              a.id AS actual_id,
              l.id AS line_id,
              s.id AS statement_id
         FROM fin.rated_usage ru
         JOIN fin.vendor_cost_estimates e ON e.rated_usage_id = ru.id AND e.status = 'ACTIVE'
         JOIN fin.vendor_actual_costs a ON a.rated_usage_id = ru.id
         JOIN fin.vendor_statement_lines l ON l.id = a.vendor_statement_line_id
         JOIN fin.vendor_statements s ON s.id = l.statement_id
        WHERE ru.id = $1`,
      [rated.ratedUsageId],
    )
    expect(hops.rowCount).toBe(0)

    const qty = Number((await pool().query(
      `SELECT measured_units FROM fin.rated_usage WHERE id = $1`,
      [rated.ratedUsageId],
    )).rows[0].measured_units)
    await closeMatchingStatement(world(), vendor, {
      quantityUnits: qty,
      tenantId: world().tenantA.tenantId,
      holderId: seededCase.holderId,
      finalize: false,
    })
    const after = await pool().query(
      `SELECT ru.id AS rated_usage_id,
              e.id AS estimate_id,
              a.id AS actual_id,
              l.id AS line_id,
              s.id AS statement_id
         FROM fin.rated_usage ru
         JOIN fin.vendor_cost_estimates e ON e.rated_usage_id = ru.id AND e.status = 'ACTIVE'
         JOIN fin.vendor_actual_costs a ON a.rated_usage_id = ru.id
         JOIN fin.vendor_statement_lines l ON l.id = a.vendor_statement_line_id
         JOIN fin.vendor_statements s ON s.id = l.statement_id
        WHERE ru.id = $1`,
      [rated.ratedUsageId],
    )
    expect(after.rowCount).toBe(1)
    expect(after.rows[0].estimate_id).toBeTruthy()
    expect(after.rows[0].actual_id).toBeTruthy()
    expect(after.rows[0].line_id).toBeTruthy()
    expect(after.rows[0].statement_id).toBeTruthy()
  })
})
