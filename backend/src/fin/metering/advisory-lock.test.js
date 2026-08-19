import { randomUUID } from 'node:crypto'
import { expect, it } from 'vitest'
import { FIN_METERING } from '../foundation/advisory-locks.js'
import { ingestUsageEvent } from '../usage/ingest.js'
import { finPostgresSuite } from '../testing/suite.js'
import { meterPeriod } from './pipeline.js'
import { meterInput, seedMeter, usagePayload } from './test-support.js'

finPostgresSuite('metering advisory-lock', {}, ({ pool, world }) => {
  it('class 1013 — concurrent meterPeriod on the same (mv, holder, period): one wins, other is METERING_LOCK_HELD', async () => {
    expect(FIN_METERING).toBe(1013)
    const { meterVersionId } = await seedMeter(pool(), { code: `lock.${randomUUID()}` })
    await ingestUsageEvent(usagePayload(world()))
    const input = meterInput(world(), { meterVersionId })
    const key = `${meterVersionId}:${input.holderId}:${input.periodKey}`

    const holder = await pool().connect()
    try {
      const got = await holder.query(
        'SELECT pg_try_advisory_lock($1, hashtext($2::text)) AS ok',
        [FIN_METERING, key],
      )
      expect(got.rows[0].ok).toBe(true)

      const blocked = await meterPeriod(input)
      expect(blocked).toEqual({ ok: false, error_code: 'METERING_LOCK_HELD' })

      await holder.query(
        'SELECT pg_advisory_unlock($1, hashtext($2::text))',
        [FIN_METERING, key],
      )
      const won = await meterPeriod(input)
      expect(won.ok).toBe(true)
      expect(won.meteredUsageId).toBeTruthy()
    } finally {
      try {
        await holder.query('SELECT pg_advisory_unlock_all()')
      } catch { /* ignore */ }
      holder.release()
    }
  })
})
