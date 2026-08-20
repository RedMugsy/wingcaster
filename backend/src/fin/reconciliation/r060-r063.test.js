import { expect, it } from 'vitest'
import { NOW } from '../testing/seed.js'
import { finPostgresSuite } from '../testing/suite.js'
import { runReconciliation } from './runner.js'
import {
  confirmPurchasePayment, createPurchaseIntent,
} from '../funding/purchase-intents.js'
import { fundingEnv, seedProduct } from '../funding/test-support.js'
import { captureFacility, reserveFacility } from '../postpaid/reservations.js'
import { futureExpiry, seedActiveFacility } from '../postpaid/test-support.js'
import { expireLot } from '../ledger/expire-lot.js'
import { commandEnv } from '../testing/seed.js'

finPostgresSuite('reconciliation R060–R063', {}, ({ pool, world }) => {
  it('R060–R063 are GREEN after deferred + postpaid + breakage activity', async () => {
    const productId = await seedProduct(world(), {
      units: 40, bonus_units: 0, price_minor: 400,
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

    const seeded = await seedActiveFacility(pool(), world(), { limitMinor: 5_000 })
    const reserved = await reserveFacility({
      ...seeded.env,
      facilityId: seeded.facilityId,
      reservedMinor: 250,
      expiresAt: futureExpiry(),
      holderId: world().tenantA.holderId,
    })
    await captureFacility({
      ...seeded.env,
      reservationId: reserved.reservationId,
      holderId: world().tenantA.holderId,
      bookId: world().tenantA.bookUsd.bookId,
    })

    const lot = await pool().query(
      `SELECT id FROM fin.lots
        WHERE purchase_intent_id = $1 AND source_kind = 'PURCHASE'`,
      [created.id],
    )
    await expireLot({
      ...commandEnv(world(), { reasonCode: 'LOT_TTL', actorType: 'WORKER' }),
      lotId: lot.rows[0].id,
      now: NOW,
    })

    const run = await runReconciliation(pool(), { now: NOW })
    const byCode = Object.fromEntries(run.results.map((r) => [r.check_code, r]))
    expect(byCode.R060.result).toBe('GREEN')
    expect(byCode.R061.result).toBe('GREEN')
    expect(byCode.R062.result).toBe('GREEN')
    expect(byCode.R063.result).toBe('GREEN')
  })
})
