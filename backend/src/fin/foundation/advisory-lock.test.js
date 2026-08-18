import { expect, it } from 'vitest'
import { FIN_CONTRACT_RENEWAL } from './advisory-locks.js'
import { finPostgresSuite } from '../testing/suite.js'

finPostgresSuite('advisory-lock D-T2', { seed: false }, ({ pool }) => {
  it('D-T2 — pg_try_advisory_lock(1001, 0): one winner; loser retries after release', async () => {
    expect(FIN_CONTRACT_RENEWAL).toBe(1001)
    const winner = await pool().connect()
    const loser = await pool().connect()
    try {
      const first = await winner.query(
        'SELECT pg_try_advisory_lock($1, $2) AS ok',
        [FIN_CONTRACT_RENEWAL, 0],
      )
      const second = await loser.query(
        'SELECT pg_try_advisory_lock($1, $2) AS ok',
        [FIN_CONTRACT_RENEWAL, 0],
      )
      expect(first.rows[0].ok).toBe(true)
      expect(second.rows[0].ok).toBe(false)

      await winner.query('SELECT pg_advisory_unlock($1, $2)', [FIN_CONTRACT_RENEWAL, 0])
      winner.release()

      const retry = await loser.query(
        'SELECT pg_try_advisory_lock($1, $2) AS ok',
        [FIN_CONTRACT_RENEWAL, 0],
      )
      expect(retry.rows[0].ok).toBe(true)
      await loser.query('SELECT pg_advisory_unlock($1, $2)', [FIN_CONTRACT_RENEWAL, 0])
    } finally {
      try { winner.release() } catch { /* already released */ }
      loser.release()
    }
  })
})
