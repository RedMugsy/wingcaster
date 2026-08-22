/**
 * Real-Postgres — empty parity tables keep the runner GREEN including R093–R095.
 */
import { expect, it } from 'vitest'
import { NOW } from '../testing/seed.js'
import { finPostgresSuite } from '../testing/suite.js'
import { CHECKS } from './checks.js'
import { runReconciliation } from './runner.js'

finPostgresSuite('reconciliation/runner-parity-green', {}, ({ pool }) => {
  it('R093–R095 and sibling checks stay GREEN with empty parity tables', async () => {
    const run = await runReconciliation(pool(), { now: NOW })
    const byCode = Object.fromEntries(run.results.map((r) => [r.check_code, r]))
    for (const check of CHECKS) {
      expect(byCode[check.check_code].result, check.check_code).toBe('GREEN')
    }
    expect(byCode.R093.result).toBe('GREEN')
    expect(byCode.R094.result).toBe('GREEN')
    expect(byCode.R095.result).toBe('GREEN')
  })
})
