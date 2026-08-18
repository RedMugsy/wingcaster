import { expect, it } from 'vitest'
import { FIN_PARTITION_DDL } from '../foundation/advisory-locks.js'
import { finPostgresSuite } from '../testing/suite.js'
import { ensureUsagePartition } from './partitions.js'

finPostgresSuite('usage partition DDL lock D-T15', { seed: false }, ({ pool }) => {
  it('D-T15 — concurrent FIN_PARTITION_DDL: one winner; loser is PARTITION_DDL_IN_PROGRESS', async () => {
    expect(FIN_PARTITION_DDL).toBe(1011)
    const holder = await pool().connect()
    const challenger = await pool().connect()
    try {
      const first = await holder.query(
        'SELECT pg_try_advisory_lock($1, hashtext($2::text)) AS ok',
        [FIN_PARTITION_DDL, 'uae'],
      )
      expect(first.rows[0].ok).toBe(true)
      await expect(ensureUsagePartition(challenger, 'uae')).rejects.toMatchObject({
        code: 'PARTITION_DDL_IN_PROGRESS',
      })
      await holder.query(
        'SELECT pg_advisory_unlock($1, hashtext($2::text))',
        [FIN_PARTITION_DDL, 'uae'],
      )
      await ensureUsagePartition(challenger, 'uae')
      const created = await pool().query(
        `SELECT 1 FROM pg_class c
           JOIN pg_namespace n ON n.oid = c.relnamespace
          WHERE n.nspname = 'fin' AND c.relname = 'usage_events_uae'`,
      )
      expect(created.rowCount).toBe(1)
    } finally {
      try { await holder.query('SELECT pg_advisory_unlock_all()') } catch { /* ignore */ }
      holder.release()
      challenger.release()
    }
  })
})
