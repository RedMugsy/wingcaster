/**
 * Real-Postgres — DUAL tenant + historical backfill + R090–R092 GREEN.
 */
import { expect, it } from 'vitest'
import { NOW } from '../testing/seed.js'
import { finPostgresSuite } from '../testing/suite.js'
import { CHECKS } from './checks.js'
import { runReconciliation } from './runner.js'
import { runBackfill } from '../cutover/backfill/orchestrator.js'
import { USAGE_SOURCE } from '../cutover/backfill/usage-events.js'
import {
  allowlistDual, insertCutoffMarker, insertCommercialUsage, HISTORICAL,
} from '../cutover/backfill/test-support.js'

finPostgresSuite('reconciliation/runner-postbackfill-green', {}, ({ pool, world }) => {
  it('R090–R092 and sibling checks stay GREEN after historical backfill', async () => {
    await allowlistDual(pool(), world().tenantA.publicTenantId)
    await insertCutoffMarker(world())
    for (let i = 0; i < 5; i += 1) {
      await insertCommercialUsage(pool(), {
        tenantId: world().tenantA.publicTenantId,
        occurredAt: HISTORICAL,
      })
    }
    const backfill = await runBackfill({
      environment: 'LIVE', source: USAGE_SOURCE, now: NOW,
    })
    expect(backfill.ok).toBe(true)
    expect(backfill.rowsWritten).toBe(5)

    const run = await runReconciliation(pool(), { now: NOW })
    const byCode = Object.fromEntries(run.results.map((r) => [r.check_code, r]))
    for (const check of CHECKS) {
      expect(byCode[check.check_code].result, check.check_code).toBe('GREEN')
    }
    expect(byCode.R090.result).toBe('GREEN')
    expect(byCode.R091.result).toBe('GREEN')
    expect(byCode.R092.result).toBe('GREEN')
  })
})
