import { expect, it } from 'vitest'
import { ingestUsageEvent } from '../usage/ingest.js'
import { meterPeriod } from '../metering/pipeline.js'
import { FIN_RATING } from '../foundation/advisory-locks.js'
import { finPostgresSuite } from '../testing/suite.js'
import { meterInput, usagePayload } from '../metering/test-support.js'
import { rateMeteredUsage } from './engine.js'
import { runRatingTick } from './worker.js'
import {
  countUsageByEventType, rateInput, seedRatedCase,
} from './test-support.js'

finPostgresSuite('rating worker', {}, ({ pool, world }) => {
  it('class 1014 lock held → skip; no double-rate', async () => {
    expect(FIN_RATING).toBe(1014)
    const seeded = await seedRatedCase(pool(), world(), { label: 'wlock', eventCount: 2 })
    expect(await countUsageByEventType(pool(), seeded.eventType)).toBe(2)

    const holder = await pool().connect()
    try {
      const got = await holder.query(
        'SELECT pg_try_advisory_lock($1, $2) AS ok',
        [FIN_RATING, 0],
      )
      expect(got.rows[0].ok).toBe(true)
      const skipped = await runRatingTick({
        pool: pool(),
        now: world().now,
        meteredUsageIds: [seeded.meteredUsageId],
      })
      expect(skipped).toMatchObject({ skipped: true, processed: 0, reason: 'RATING_LOCK_HELD' })
      const count = await pool().query(
        `SELECT count(*)::int AS n FROM fin.rated_usage WHERE metered_usage_id = $1`,
        [seeded.meteredUsageId],
      )
      expect(count.rows[0].n).toBe(0)
    } finally {
      try {
        await holder.query('SELECT pg_advisory_unlock_all()')
      } catch { /* ignore */ }
      holder.release()
    }

    const ran = await runRatingTick({
      pool: pool(),
      now: world().now,
      meteredUsageIds: [seeded.meteredUsageId],
    })
    expect(ran.skipped).toBe(false)
    expect(ran.processed).toBe(1)
  })

  it('after a metered_usage is rated, worker will not re-rate it', async () => {
    const seeded = await seedRatedCase(pool(), world(), { label: 'norepeat', eventCount: 2 })
    const first = await rateMeteredUsage(rateInput(seeded))
    const tick = await runRatingTick({
      pool: pool(),
      now: world().now,
      meteredUsageIds: [seeded.meteredUsageId],
    })
    expect(tick.processed).toBe(0)
    const count = await pool().query(
      `SELECT count(*)::int AS n FROM fin.rated_usage WHERE metered_usage_id = $1`,
      [seeded.meteredUsageId],
    )
    expect(count.rows[0].n).toBe(1)
    expect(count.rows[0].n === 1 ? first.ratedUsageId : null).toBeTruthy()
  })

  it('after supersession the worker rates the new ACTIVE row and leaves the old rating intact', async () => {
    const seeded = await seedRatedCase(pool(), world(), { label: 'supersede', eventCount: 2 })
    const first = await rateMeteredUsage(rateInput(seeded))
    await ingestUsageEvent(usagePayload(world(), {
      eventType: seeded.eventType,
      holderId: seeded.holderId,
      quantityUnits: 1,
    }))
    expect(await countUsageByEventType(pool(), seeded.eventType)).toBe(3)
    const remetered = await meterPeriod(meterInput(world(), {
      meterVersionId: seeded.meterVersionId,
      extra: { holderId: seeded.holderId },
    }))
    expect(remetered.ok).toBe(true)
    expect(remetered.meteredUsageId).not.toBe(seeded.meteredUsageId)
    expect(remetered.superseded).toBe(seeded.meteredUsageId)

    const tick = await runRatingTick({
      pool: pool(),
      now: world().now,
      meteredUsageIds: [seeded.meteredUsageId, remetered.meteredUsageId],
    })
    expect(tick.processed).toBe(1)
    const old = await pool().query(
      `SELECT id FROM fin.rated_usage WHERE id = $1`,
      [first.ratedUsageId],
    )
    expect(old.rowCount).toBe(1)
    const neu = await pool().query(
      `SELECT id, metered_usage_id, adjustment_of_id
         FROM fin.rated_usage WHERE metered_usage_id = $1 AND adjustment_of_id IS NULL`,
      [remetered.meteredUsageId],
    )
    expect(neu.rowCount).toBe(1)
    expect(neu.rows[0].id).not.toBe(first.ratedUsageId)
  })
})
