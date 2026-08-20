import { expect, it } from 'vitest'
import { commandEnv, NOW } from '../testing/seed.js'
import { finPostgresSuite } from '../testing/suite.js'
import { expireLot } from '../ledger/expire-lot.js'
import {
  confirmPurchasePayment, createPurchaseIntent,
} from '../funding/purchase-intents.js'
import { fundingEnv, seedProduct } from '../funding/test-support.js'

finPostgresSuite('accounting breakage', {}, ({ pool, world }) => {
  it('expireLot writes BREAKAGE_RECOGNIZED = remaining × unit value', async () => {
    const productId = await seedProduct(world(), {
      units: 50, bonus_units: 0, price_minor: 500,
    })
    const created = await createPurchaseIntent({
      ...fundingEnv(world()),
      productId,
      provider: 'MANUAL',
    })
    await confirmPurchasePayment({
      ...fundingEnv(world(), { actorType: 'SYSTEM' }),
      intentId: created.id,
      provider: 'MANUAL',
      now: NOW,
    })
    const lot = await pool().query(
      `SELECT * FROM fin.lots
        WHERE purchase_intent_id = $1 AND source_kind = 'PURCHASE'`,
      [created.id],
    )
    expect(lot.rowCount).toBe(1)
    const remaining = BigInt(lot.rows[0].remaining_units)
    const granted = BigInt(lot.rows[0].granted_units)
    const consideration = BigInt(lot.rows[0].consideration_minor)
    const expected = (consideration * remaining) / granted

    const expired = await expireLot({
      ...commandEnv(world(), { reasonCode: 'LOT_TTL', actorType: 'WORKER' }),
      lotId: lot.rows[0].id,
      now: NOW,
    })
    expect(expired.txId).toBeTruthy()

    const events = await pool().query(
      `SELECT amount_minor FROM fin.accounting_events
        WHERE event_kind = 'BREAKAGE_RECOGNIZED' AND source_id = $1`,
      [lot.rows[0].id],
    )
    expect(events.rowCount).toBe(1)
    expect(String(events.rows[0].amount_minor)).toBe(expected.toString())
  })
})
