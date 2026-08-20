import { expect, it } from 'vitest'
import { FIN_DUNNING } from '../foundation/advisory-locks.js'
import { finPostgresSuite } from '../testing/suite.js'
import { runDunningTick } from './worker.js'

finPostgresSuite('dunning worker', {}, ({ pool }) => {
  it('skips the tick when the advisory lock is held', async () => {
    const client = await pool().connect()
    try {
      await client.query('SELECT pg_advisory_lock($1, 0)', [FIN_DUNNING])
      const tick = await runDunningTick({ pool: pool() })
      expect(tick.skipped).toBe(true)
    } finally {
      await client.query('SELECT pg_advisory_unlock($1, 0)', [FIN_DUNNING])
      client.release()
    }
  })
})
