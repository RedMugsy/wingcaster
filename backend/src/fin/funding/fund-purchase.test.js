import { expect, it } from 'vitest'
import { finPostgresSuite } from '../testing/suite.js'
import {
  confirmPurchasePayment, createPurchaseIntent,
} from './purchase-intents.js'
import { fundPurchaseFromIntent } from './paid-lots.js'
import { fundingEnv, seedProduct } from './test-support.js'
import { transaction } from '../../db.js'

finPostgresSuite('fund-purchase C §5.4 / DL-092', {}, ({ pool, world }) => {
  async function paidIntent() {
    const productId = await seedProduct(world(), { units: 400, bonus_units: 50, price_minor: 1200 })
    const created = await createPurchaseIntent({
      ...fundingEnv(world()),
      productId,
      provider: 'MANUAL',
    })
    const paid = await confirmPurchasePayment({
      ...fundingEnv(world(), { actorType: 'SYSTEM' }),
      intentId: created.id,
      provider: 'MANUAL',
    })
    return paid
  }

  it('paid+bonus = two lots in ONE FUNDING tx, four postings sum to zero', async () => {
    const paid = await paidIntent()
    expect(paid.lotIds).toHaveLength(2)

    const txs = await pool().query(
      `SELECT id, shape FROM fin.ledger_transactions
        WHERE economic_source_id = $1 AND shape = 'FUNDING'`,
      [paid.id],
    )
    expect(txs.rowCount).toBe(1)

    const lots = await pool().query(
      `SELECT source_kind, consideration_minor::text AS cons,
              granted_units::text AS granted, remaining_units::text AS remaining, status
         FROM fin.lots WHERE id = ANY($1::uuid[]) ORDER BY source_kind`,
      [paid.lotIds],
    )
    const purchased = lots.rows.find((r) => r.source_kind === 'PURCHASE')
    const bonus = lots.rows.find((r) => r.source_kind === 'PROMOTIONAL_GRANT')
    expect(purchased).toMatchObject({ cons: '1200', granted: '400', remaining: '400', status: 'ACTIVE' })
    expect(bonus).toMatchObject({ cons: '0', granted: '50', remaining: '50', status: 'ACTIVE' })

    const postings = await pool().query(
      `SELECT amount_units::text AS amt FROM fin.ledger_postings WHERE transaction_id = $1`,
      [paid.txId],
    )
    expect(postings.rowCount).toBe(4)
    const sum = postings.rows.reduce((acc, row) => acc + BigInt(row.amt), 0n)
    expect(sum).toBe(0n)

    const allocs = await pool().query(
      `SELECT count(*)::int AS n FROM fin.lot_allocations WHERE lot_id = ANY($1::uuid[])`,
      [paid.lotIds],
    )
    expect(allocs.rows[0].n).toBe(0)
  })

  it('replay by intentId returns the same tx and does not insert a second FUNDING', async () => {
    const paid = await paidIntent()
    const replay = await transaction(async (client) => fundPurchaseFromIntent(client, {
      intentId: paid.id,
      now: world().now,
      actorType: 'SYSTEM',
      actorId: null,
      reasonCode: 'TEST',
    }))
    expect(replay.txId).toBe(paid.txId)
    expect(replay.replayed).toBe(true)
    const again = await pool().query(
      `SELECT count(*)::int AS n FROM fin.ledger_transactions
        WHERE economic_source_id = $1 AND shape = 'FUNDING'`,
      [paid.id],
    )
    expect(again.rows[0].n).toBe(1)
  })
})
