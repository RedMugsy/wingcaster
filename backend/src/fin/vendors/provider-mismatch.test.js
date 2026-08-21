import { expect, it } from 'vitest'
import { insertApproval } from '../testing/seed.js'
import { finPostgresSuite } from '../testing/suite.js'
import { createStatement, addStatementLine, receiveStatement } from './statement-ingest.js'
import { finalizeStatement, reconcileStatement } from './reconciliation.js'
import { ingestVendorUsageEvent, upsertReportedUsage } from './usage-ingest.js'
import { seedVendorWorld, vendorEnv, PERIOD_KEY } from './test-support.js'

finPostgresSuite('fin.vendors provider-mismatch', {}, ({ pool, world }) => {
  it('detects provider-reported discrepancy and rejects FINALIZE without override', async () => {
    const seeded = await seedVendorWorld(world())
    await ingestVendorUsageEvent(vendorEnv(world(), {
      vendorId: seeded.vendorId,
      vendorProductCode: seeded.productCode,
      quantityUnits: 10,
      sourceEventId: 'prov-1',
    }))
    await upsertReportedUsage(vendorEnv(world(), {
      vendorId: seeded.vendorId,
      vendorProductCode: seeded.productCode,
      reportingPeriodKey: PERIOD_KEY,
      quantityUnits: 99,
      currency: 'USD',
    }))
    const statement = await createStatement(vendorEnv(world(), {
      vendorId: seeded.vendorId,
      statementPeriodKey: PERIOD_KEY,
      currency: 'USD',
    }))
    await addStatementLine(vendorEnv(world(), {
      statementId: statement.id,
      productCode: seeded.productCode,
      quantityUnits: 10,
      unitCostMinor: seeded.unitCostMinor,
    }))
    await receiveStatement(vendorEnv(world(), { statementId: statement.id }))
    const recon = await reconcileStatement(vendorEnv(world(), { statementId: statement.id }))
    const reasons = recon.variances.map((v) => v.reason)
    expect(reasons.length).toBeGreaterThan(0)
    expect(reasons.some((r) => ['drift', 'missing_source', 'rate_change'].includes(r))).toBe(true)

    await expect(finalizeStatement(vendorEnv(world(), {
      statementId: statement.id,
      actorType: 'USER',
    }))).rejects.toMatchObject({ code: 'VENDOR_STATEMENT_UNRESOLVED_VARIANCE' })

    const approvalId = await insertApproval(pool(), {
      tenantId: world().tenantA.tenantId,
      actionKind: 'VENDOR_VARIANCE_OVERRIDE',
    })
    const finalized = await finalizeStatement(vendorEnv(world(), {
      statementId: statement.id,
      actorType: 'USER',
      approvalRequestId: approvalId,
    }))
    expect(finalized.status).toBe('FINALIZED')
  })
})
