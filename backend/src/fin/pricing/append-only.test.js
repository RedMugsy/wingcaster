import { expect, it } from 'vitest'
import { asRole, NOW } from '../testing/seed.js'
import { finPostgresSuite } from '../testing/suite.js'
import { createPrice, draftPriceVersion, activatePriceVersion } from './prices.js'

function env(world, extra = {}) {
  return {
    environment: 'LIVE',
    reasonCode: 'TEST',
    actorType: 'SYSTEM',
    now: world.now,
    ...extra,
  }
}

finPostgresSuite('fin.pricing append-only grants', {}, ({ pool, world }) => {
  it('fin_app_role cannot UPDATE model; can flip ACTIVE→SUPERSEDED; cannot ACTIVE→DRAFT; cannot UPDATE tiers', async () => {
    const created = await createPrice(env(world(), { code: 'ao.price', currency: 'USD' }))
    const drafted = await draftPriceVersion(env(world(), {
      priceId: created.id,
      model: 'PER_UNIT',
      unit_rate_minor: 10,
      effective_from: NOW,
    }))
    await activatePriceVersion(env(world(), {
      priceId: created.id,
      priceVersionId: drafted.id,
    }))

    const gucs = { 'fin.environment': 'LIVE' }
    const client = await pool().connect()
    try {
      await expect(asRole(client, 'fin_app_role', gucs, (c) => c.query(
        `UPDATE fin.price_versions SET model = 'FLAT' WHERE id = $1`,
        [drafted.id],
      ))).rejects.toThrow(/permission denied|insufficient privilege/i)

      await expect(asRole(client, 'fin_app_role', gucs, (c) => c.query(
        `UPDATE fin.price_versions SET status = 'DRAFT' WHERE id = $1`,
        [drafted.id],
      ))).rejects.toThrow(/illegal price_version status transition|append-only/i)

      await asRole(client, 'fin_app_role', gucs, (c) => c.query(
        `UPDATE fin.price_versions SET status = 'SUPERSEDED' WHERE id = $1`,
        [drafted.id],
      ))

      const v2 = await draftPriceVersion(env(world(), {
        priceId: created.id,
        model: 'GRADUATED_TIER',
        effective_from: '2027-01-01T00:00:00.000Z',
        tiers: [{ upto_units: 5, rate_minor: 1 }],
      }))
      const inserted = await pool().query(
        `SELECT id FROM fin.price_tiers WHERE price_version_id = $1`,
        [v2.id],
      )
      expect(inserted.rowCount).toBe(1)
      await expect(asRole(client, 'fin_app_role', gucs, (c) => c.query(
        `UPDATE fin.price_tiers SET rate_minor = 1 WHERE id = $1`,
        [inserted.rows[0].id],
      ))).rejects.toThrow(/permission denied|insufficient privilege/i)
    } finally {
      client.release()
    }
  })
})
