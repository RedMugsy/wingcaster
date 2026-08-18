import { expect, it } from 'vitest'
import { FIN_RECONCILIATION } from '../foundation/advisory-locks.js'
import { NOW } from '../testing/seed.js'
import { finPostgresSuite } from '../testing/suite.js'
import { runReconciliation } from './runner.js'

finPostgresSuite('reconciliation advisory-lock', { seed: false }, ({ pool }) => {
  it('class 1009 — a held lock skips the tick; exactly one runner completes', async () => {
    expect(FIN_RECONCILIATION).toBe(1009)
    const holder = await pool().connect()
    try {
      const got = await holder.query(
        'SELECT pg_try_advisory_lock($1, $2) AS ok',
        [FIN_RECONCILIATION, 0],
      )
      expect(got.rows[0].ok).toBe(true)
      const skipped = await runReconciliation(pool(), { now: NOW })
      expect(skipped).toEqual({ skipped: true, reason: 'RECON_LOCK_HELD' })
      const runs = await pool().query('SELECT count(*)::int AS n FROM fin.reconciliation_runs')
      expect(runs.rows[0].n).toBe(0)

      await holder.query('SELECT pg_advisory_unlock($1, $2)', [FIN_RECONCILIATION, 0])
      const ran = await runReconciliation(pool(), { now: NOW })
      expect(ran.skipped).toBe(false)
      expect(ran.status).toBe('COMPLETED')
    } finally {
      try {
        await holder.query('SELECT pg_advisory_unlock($1, $2)', [FIN_RECONCILIATION, 0])
      } catch { /* unlocked */ }
      holder.release()
    }
  })
})
