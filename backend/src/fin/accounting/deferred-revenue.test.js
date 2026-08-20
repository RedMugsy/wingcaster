import { expect, it } from 'vitest'
import { NOW } from '../testing/seed.js'
import { finPostgresSuite } from '../testing/suite.js'
import {
  confirmPurchasePayment, createPurchaseIntent,
} from '../funding/purchase-intents.js'
import { fundingEnv, seedProduct } from '../funding/test-support.js'

finPostgresSuite('accounting deferred revenue', {}, ({ pool, world }) => {
  it('confirmPurchasePayment writes DEFERRED_REVENUE_CREATED = quoted_minor and a group', async () => {
    const productId = await seedProduct(world(), {
      units: 80, bonus_units: 20, price_minor: 800,
    })
    const created = await createPurchaseIntent({
      ...fundingEnv(world()),
      productId,
      provider: 'MANUAL',
    })
    const paid = await confirmPurchasePayment({
      ...fundingEnv(world(), { actorType: 'SYSTEM' }),
      intentId: created.id,
      provider: 'MANUAL',
      now: NOW,
    })
    expect(paid.status).toBe('PAID')

    const events = await pool().query(
      `SELECT event_kind, amount_minor, source_type, source_id
         FROM fin.accounting_events
        WHERE source_type = 'PURCHASE_INTENT' AND source_id = $1`,
      [created.id],
    )
    expect(events.rows).toHaveLength(1)
    expect(events.rows[0].event_kind).toBe('DEFERRED_REVENUE_CREATED')
    expect(String(events.rows[0].amount_minor)).toBe('800')

    const group = await pool().query(
      `SELECT amount_minor FROM fin.revenue_allocation_groups
        WHERE source_type = 'PURCHASE_INTENT' AND source_id = $1`,
      [created.id],
    )
    expect(group.rowCount).toBe(1)
    expect(String(group.rows[0].amount_minor)).toBe('800')
  })
})
