import { randomUUID } from 'node:crypto'
import { expect, it } from 'vitest'
import { commandEnv } from '../testing/seed.js'
import { finPostgresSuite } from '../testing/suite.js'
import { fundPurchase } from './transactions.js'

finPostgresSuite('fund-purchase C05', {}, ({ pool, world }) => {
  it('C05 — paid + bonus is two lots, one FUNDING, bonus consideration 0', async () => {
    const env = commandEnv(world())
    const purchaseIntentId = randomUUID()
    const first = await fundPurchase({
      ...env,
      purchaseIntentId,
      paidUnits: 400,
      bonusUnits: 50,
      considerationMinor: 1200,
    })
    expect(first.lotIds).toHaveLength(2)
    expect(first.txId).toBeTruthy()

    const txs = await pool().query(
      `SELECT id, shape FROM fin.ledger_transactions
        WHERE economic_source_id = $1 AND shape = 'FUNDING'`,
      [purchaseIntentId],
    )
    expect(txs.rowCount).toBe(1)

    const lots = await pool().query(
      `SELECT source_kind, consideration_minor, granted_units, remaining_units
         FROM fin.lots WHERE id = ANY($1::uuid[]) ORDER BY source_kind`,
      [first.lotIds],
    )
    expect(lots.rowCount).toBe(2)
    const paid = lots.rows.find((r) => r.source_kind === 'PURCHASE')
    const bonus = lots.rows.find((r) => r.source_kind === 'PROMOTIONAL_GRANT')
    expect(Number(paid.consideration_minor)).toBe(1200)
    expect(Number(paid.granted_units)).toBe(400)
    expect(Number(paid.remaining_units)).toBe(400)
    expect(Number(bonus.consideration_minor)).toBe(0)
    expect(Number(bonus.granted_units)).toBe(50)
    expect(Number(bonus.remaining_units)).toBe(50)

    const issueAllocs = await pool().query(
      `SELECT count(*)::int AS n FROM fin.lot_allocations WHERE lot_id = ANY($1::uuid[])`,
      [first.lotIds],
    )
    expect(issueAllocs.rows[0].n).toBe(0)

    const postings = await pool().query(
      `SELECT count(*)::int AS n FROM fin.ledger_postings WHERE transaction_id = $1`,
      [first.txId],
    )
    expect(postings.rows[0].n).toBe(4)

    const replay = await fundPurchase({
      ...env,
      purchaseIntentId,
      paidUnits: 400,
      bonusUnits: 50,
      considerationMinor: 1200,
      idempotencyKey: `FUND:${purchaseIntentId}`,
    })
    expect(replay.txId).toBe(first.txId)
    const again = await pool().query(
      `SELECT count(*)::int AS n FROM fin.ledger_transactions
        WHERE economic_source_id = $1 AND shape = 'FUNDING'`,
      [purchaseIntentId],
    )
    expect(again.rows[0].n).toBe(1)
  })
})
