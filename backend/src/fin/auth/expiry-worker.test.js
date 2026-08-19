import { randomUUID } from 'node:crypto'
import { expect, it } from 'vitest'
import { finPostgresSuite } from '../testing/suite.js'
import { authorizeUsage } from './authorize.js'
import { runHoldExpiryTick } from './expiry-worker.js'
import { authInput, postingSum, seedAuthHolder } from './test-support.js'

finPostgresSuite('hold expiry worker', {}, ({ pool, world }) => {
  it('past-due OPEN hold is expired and HELD→AVAILABLE fires', async () => {
    const seeded = await seedAuthHolder(pool(), world(), { label: 'exp-ok', units: 50 })
    const authorized = await authorizeUsage(authInput(world(), seeded, {
      unitsRequested: 11,
      expiresAt: '2026-08-17T00:00:00.000Z',
      idempotencyKey: `AUTH:${randomUUID()}`,
    }))
    const tick = await runHoldExpiryTick({ pool: pool(), now: world().now, limit: 20 })
    expect(tick.skipped).toBe(false)
    expect(tick.processed).toBeGreaterThanOrEqual(1)
    const hold = await pool().query(
      `SELECT status, release_tx_id FROM fin.holds WHERE id = $1`,
      [authorized.holdId],
    )
    expect(hold.rows[0].status).toBe('EXPIRED')
    expect(hold.rows[0].release_tx_id).toBeTruthy()
    expect(await postingSum(pool(), {
      transactionId: hold.rows[0].release_tx_id, accountType: 'AVAILABLE',
    })).toBe('11')
    const lot = await pool().query(
      `SELECT remaining_units::text AS rem FROM fin.lots WHERE id = $1`,
      [seeded.lotId],
    )
    expect(lot.rows[0].rem).toBe('50')
  })

  it('NOWAIT contention skips the hold; next tick expires it after the book lock drops', async () => {
    const seeded = await seedAuthHolder(pool(), world(), { label: 'exp-nowait', units: 50 })
    const authorized = await authorizeUsage(authInput(world(), seeded, {
      unitsRequested: 7,
      expiresAt: '2026-08-17T00:00:00.000Z',
      idempotencyKey: `AUTH:${randomUUID()}`,
    }))

    const blocker = await pool().connect()
    try {
      await blocker.query('BEGIN')
      await blocker.query(
        `SELECT id FROM fin.ledger_books WHERE id = $1 FOR UPDATE`,
        [seeded.bookId],
      )
      const blocked = await runHoldExpiryTick({ pool: pool(), now: world().now, limit: 20 })
      const mine = blocked.results.find((row) => row.holdId === authorized.holdId)
      expect(mine).toMatchObject({ skipped: true, reason: '55P03' })
      const stillOpen = await pool().query(
        `SELECT status FROM fin.holds WHERE id = $1`,
        [authorized.holdId],
      )
      expect(stillOpen.rows[0].status).toBe('OPEN')
      await blocker.query('ROLLBACK')
    } finally {
      blocker.release()
    }

    const tick = await runHoldExpiryTick({ pool: pool(), now: world().now, limit: 20 })
    expect(tick.processed).toBeGreaterThanOrEqual(1)
    const hold = await pool().query(
      `SELECT status FROM fin.holds WHERE id = $1`,
      [authorized.holdId],
    )
    expect(hold.rows[0].status).toBe('EXPIRED')
  })
})
