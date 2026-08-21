import { expect, it } from 'vitest'
import { finPostgresSuite } from '../testing/suite.js'
import { VARIANCE_REASONS } from './reconciliation.js'
import { closeMatchingStatement, seedVendorWorld, vendorEnv, PERIOD_KEY } from './test-support.js'
import { createStatement, addStatementLine, receiveStatement } from './statement-ingest.js'
import { reconcileStatement } from './reconciliation.js'

finPostgresSuite('fin.vendors statement-recon', {}, ({ pool, world }) => {
  it('matching 6-way recon writes no unresolved rows', async () => {
    const seeded = await seedVendorWorld(world())
    const closed = await closeMatchingStatement(world(), seeded, {
      quantityUnits: 5,
      finalize: false,
    })
    const rows = await pool().query(
      `SELECT axis, resolved FROM fin.vendor_variances WHERE statement_id = $1`,
      [closed.statementId],
    )
    expect(rows.rows.filter((r) => r.resolved === false)).toHaveLength(0)
    expect(closed.recon.status).toBe('RECONCILED')
  })

  it('each of the 10 reason codes is produced by a seed variant', async () => {
    const produced = new Set()
    const groups = [
      VARIANCE_REASONS.slice(0, 6),
      VARIANCE_REASONS.slice(6),
    ]
    for (const codes of groups) {
      const seeded = await seedVendorWorld(world())
      const hints = {}
      codes.forEach((reason, index) => {
        hints[['A', 'B', 'C', 'D', 'E', 'F'][index]] = { reason }
      })
      const closed = await closeMatchingStatement(world(), seeded, {
        quantityUnits: 2,
        finalize: false,
        hints,
      })
      const rows = await pool().query(
        `SELECT reason_code FROM fin.vendor_variances WHERE statement_id = $1`,
        [closed.statementId],
      )
      for (const row of rows.rows) produced.add(row.reason_code)
    }
    expect([...produced].sort()).toEqual([...VARIANCE_REASONS].sort())
  })

  it('receiveStatement flips DRAFT → RECEIVED', async () => {
    const seeded = await seedVendorWorld(world())
    const statement = await createStatement(vendorEnv(world(), {
      vendorId: seeded.vendorId,
      statementPeriodKey: `${PERIOD_KEY}-b`,
      currency: 'USD',
    }))
    await addStatementLine(vendorEnv(world(), {
      statementId: statement.id,
      productCode: seeded.productCode,
      quantityUnits: 1,
      unitCostMinor: seeded.unitCostMinor,
    }))
    const received = await receiveStatement(vendorEnv(world(), { statementId: statement.id }))
    expect(received.status).toBe('RECEIVED')
    await reconcileStatement(vendorEnv(world(), { statementId: statement.id }))
  })
})
