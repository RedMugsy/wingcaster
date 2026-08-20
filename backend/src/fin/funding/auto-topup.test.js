import { randomUUID } from 'node:crypto'
import { expect, it } from 'vitest'
import { finPostgresSuite } from '../testing/suite.js'
import { authorizeUsage } from '../auth/authorize.js'
import { captureUsage } from '../auth/capture.js'
import { fundPurchase } from '../ledger/transactions.js'
import { commandEnv, seedBook } from '../testing/seed.js'
import { seedIsolatedHolder } from '../rating/test-support.js'
import { runAutoTopupTick } from './auto-topup-worker.js'
import { insertAutoTopupPolicy, insertControls, seedProduct } from './test-support.js'

finPostgresSuite('auto-topup worker DL-094', {}, ({ pool, world }) => {
  async function wallet({ units = 80, thresholdUnits = 50, extraPolicy = {} }) {
    const { holderId, billingAccountId } = await seedIsolatedHolder(pool(), world(), {
      label: `at-${randomUUID().slice(0, 6)}`,
    })
    const book = await seedBook(pool(), {
      environment: 'LIVE',
      tenantId: world().tenantA.tenantId,
      billingAccountId,
    })
    await fundPurchase({
      ...commandEnv(world(), { holderId, bookId: book.bookId }),
      purchaseIntentId: randomUUID(),
      paidUnits: units,
      bonusUnits: 0,
      considerationMinor: 1,
    })
    const productId = await seedProduct(world(), { units: 100, bonus_units: 0, price_minor: 1000 })
    const policyId = await insertAutoTopupPolicy(pool(), {
      tenantId: world().tenantA.tenantId,
      billingAccountId,
      holderId,
      productId,
      thresholdUnits,
      cooldownSeconds: 3600,
      ...extraPolicy,
    })
    return { holderId, billingAccountId, bookId: book.bookId, productId, policyId }
  }

  it('the tx that trips the threshold does not call submitPurchasePayment', async () => {
    const seeded = await wallet({ units: 80, thresholdUnits: 50 })
    const authorized = await authorizeUsage({
      ...commandEnv(world(), { holderId: seeded.holderId, bookId: seeded.bookId }),
      unitsRequested: 40,
      idempotencyKey: `AUTH:${randomUUID()}`,
    })
    await captureUsage({
      holdId: authorized.holdId,
      now: world().now,
      reasonCode: 'TEST',
      actorType: 'SYSTEM',
    })
    const intents = await pool().query(
      `SELECT count(*)::int AS n FROM fin.purchase_intents WHERE holder_id = $1`,
      [seeded.holderId],
    )
    expect(intents.rows[0].n).toBe(0)

    const tick = await runAutoTopupTick({ pool: pool(), now: world().now })
    expect(tick.skipped).toBe(false)
    expect(tick.processed).toBeGreaterThanOrEqual(1)
    const created = await pool().query(
      `SELECT status, reason_code, created_by_actor_type
         FROM fin.purchase_intents WHERE holder_id = $1`,
      [seeded.holderId],
    )
    expect(created.rowCount).toBe(1)
    expect(created.rows[0]).toMatchObject({
      status: 'PAYMENT_PENDING',
      reason_code: 'AUTO_TOPUP',
      created_by_actor_type: 'WORKER',
    })
    const funding = await pool().query(
      `SELECT count(*)::int AS n FROM fin.ledger_transactions
        WHERE shape = 'FUNDING' AND economic_source_id = (
          SELECT id FROM fin.purchase_intents WHERE holder_id = $1
        )`,
      [seeded.holderId],
    )
    expect(funding.rows[0].n).toBe(0)
  })

  it('never charges twice: cooldown is visible to the next tick', async () => {
    const seeded = await wallet({ units: 10, thresholdUnits: 50 })
    const first = await runAutoTopupTick({ pool: pool(), now: world().now })
    expect(first.processed).toBeGreaterThanOrEqual(1)
    const second = await runAutoTopupTick({ pool: pool(), now: world().now })
    const forPolicy = second.results.filter((r) => r.policyId === seeded.policyId)
    expect(forPolicy.every((r) => r.skipped)).toBe(true)
    const intents = await pool().query(
      `SELECT count(*)::int AS n FROM fin.purchase_intents WHERE holder_id = $1`,
      [seeded.holderId],
    )
    expect(intents.rows[0].n).toBe(1)
  })

  it('daily cap is respected after cooldown expires', async () => {
    const seeded = await wallet({
      units: 10, thresholdUnits: 50,
      extraPolicy: { dailyCap: 1, cooldownSeconds: 0 },
    })
    await runAutoTopupTick({ pool: pool(), now: world().now })
    await pool().query(
      `UPDATE fin.purchase_intents SET status = 'CANCELED', updated_at = $2
        WHERE holder_id = $1 AND status = 'PAYMENT_PENDING'`,
      [seeded.holderId, world().now],
    )
    await pool().query(
      `UPDATE fin.auto_topup_policies SET cooldown_until = $2 WHERE id = $1`,
      [seeded.policyId, '2020-01-01T00:00:00.000Z'],
    )
    const again = await runAutoTopupTick({ pool: pool(), now: world().now })
    const mine = again.results.filter((r) => r.policyId === seeded.policyId)
    expect(mine.some((r) => r.reason === 'cap')).toBe(true)
  })

  it('suspends after N failures and emits notification.lifecycle', async () => {
    const seeded = await wallet({ units: 10, thresholdUnits: 50, extraPolicy: { failureThreshold: 2 } })
    await insertControls(pool(), {
      subjectType: 'HOLDER',
      subjectId: seeded.holderId,
      allowPurchases: false,
    })
    await runAutoTopupTick({ pool: pool(), now: world().now })
    await runAutoTopupTick({ pool: pool(), now: world().now })
    const policy = await pool().query(
      `SELECT auto_topup_suspended, failure_count::int AS n FROM fin.auto_topup_policies WHERE id = $1`,
      [seeded.policyId],
    )
    expect(policy.rows[0].auto_topup_suspended).toBe(true)
    expect(policy.rows[0].n).toBeGreaterThanOrEqual(2)
    const notify = await pool().query(
      `SELECT topic FROM fin.outbox_events WHERE dedupe_key = $1`,
      [`autotopup:${seeded.policyId}:suspended`],
    )
    expect(notify.rows[0].topic).toBe('notification.lifecycle')
  })

  it('loser of FIN_AUTO_TOPUP skips the tick', async () => {
    const lock = await pool().connect()
    try {
      await lock.query('SELECT pg_try_advisory_lock($1, $2)', [1010, 0])
      const tick = await runAutoTopupTick({ pool: pool(), now: world().now })
      expect(tick).toMatchObject({ skipped: true, reason: 'AUTO_TOPUP_LOCK_HELD' })
    } finally {
      await lock.query('SELECT pg_advisory_unlock($1, $2)', [1010, 0])
      lock.release()
    }
  })
})
