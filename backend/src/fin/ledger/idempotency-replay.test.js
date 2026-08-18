import { randomUUID } from 'node:crypto'
import { expect, it } from 'vitest'
import { FinError } from '../errors.js'
import { commandEnv, NOW } from '../testing/seed.js'
import { finPostgresSuite } from '../testing/suite.js'
import { fundPurchase, manualAdjust } from './transactions.js'

finPostgresSuite('idempotency-replay C12', {}, ({ pool, world }) => {
  it('C12 — COMPLETED replay inserts 0 new txs', async () => {
    const env = commandEnv(world())
    const purchaseIntentId = randomUUID()
    const first = await fundPurchase({
      ...env, purchaseIntentId, paidUnits: 30, bonusUnits: 0, considerationMinor: 1,
    })
    const before = await pool().query('SELECT count(*)::int AS n FROM fin.ledger_transactions')
    const replay = await fundPurchase({
      ...env, purchaseIntentId, paidUnits: 30, bonusUnits: 0, considerationMinor: 1,
    })
    expect(replay.txId).toBe(first.txId)
    const after = await pool().query('SELECT count(*)::int AS n FROM fin.ledger_transactions')
    expect(after.rows[0].n).toBe(before.rows[0].n)
  })

  it('C12 — fingerprint conflict', async () => {
    const env = commandEnv(world())
    const purchaseIntentId = randomUUID()
    const key = `FUND:${purchaseIntentId}`
    await fundPurchase({
      ...env, purchaseIntentId, paidUnits: 10, bonusUnits: 0, considerationMinor: 1,
      idempotencyKey: key,
    })
    await expect(fundPurchase({
      ...env, purchaseIntentId, paidUnits: 99, bonusUnits: 0, considerationMinor: 1,
      idempotencyKey: key,
    })).rejects.toBeInstanceOf(FinError)
    await expect(fundPurchase({
      ...env, purchaseIntentId, paidUnits: 99, bonusUnits: 0, considerationMinor: 1,
      idempotencyKey: key,
    })).rejects.toMatchObject({ code: 'IDEMPOTENCY_FINGERPRINT_CONFLICT' })
  })

  it('C12 — expired key does not fund', async () => {
    const env = commandEnv(world())
    const purchaseIntentId = randomUUID()
    const key = `FUND:${purchaseIntentId}`
    await pool().query(
      `INSERT INTO fin.idempotency_keys (
         id, environment, tenant_id, key, request_fingerprint, status,
         expires_at, created_at, updated_at
       ) VALUES ($1, 'LIVE', $2, $3, 'deadbeef', 'IN_FLIGHT', $4, $5, $5)`,
      [randomUUID(), env.tenantId, key, '2020-01-01T00:00:00.000Z', NOW],
    )
    const before = await pool().query(
      `SELECT count(*)::int AS n FROM fin.ledger_transactions WHERE shape = 'FUNDING'`,
    )
    await expect(fundPurchase({
      ...env, purchaseIntentId, paidUnits: 12, bonusUnits: 0, considerationMinor: 1,
      idempotencyKey: key,
    })).rejects.toMatchObject({ code: 'IDEMPOTENCY_KEY_EXPIRED' })
    const after = await pool().query(
      `SELECT count(*)::int AS n FROM fin.ledger_transactions WHERE shape = 'FUNDING'`,
    )
    expect(after.rows[0].n).toBe(before.rows[0].n)
  })

  it('C12 — ADJUSTMENT replay is key-only (no unique source)', async () => {
    const env = commandEnv(world())
    const key = `ADJ:${randomUUID()}`
    const first = await manualAdjust({
      ...env, units: 3, direction: 'increase', idempotencyKey: key,
    })
    const replay = await manualAdjust({
      ...env, units: 3, direction: 'increase', idempotencyKey: key,
    })
    expect(replay.txId).toBe(first.txId)
  })
})
