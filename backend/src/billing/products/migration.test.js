import { randomUUID } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import { closeDb, configure, findOne, query } from '../../db.js'
import { skipIfNoPostgres, withTestDb } from '../../testing/postgres.js'
import { cloneAsNewVersion, createProduct, publishProduct } from './products.js'
import { activateTier, createTier } from './tiers.js'
import { createSubscription, migrateSubscription } from './lifecycle.js'
import { listNotes } from './credit-notes.js'
import { listEvents } from './subscription-history.js'

async function seedProductWithTiers({ code, cadence = 'monthly', basicPrice = 1000, proPrice = 3000 } = {}) {
  const product = await createProduct({
    code: code || `p-${randomUUID().slice(0, 8)}`,
    name: 'P', version: 1, billing_cadence: cadence, base_price_minor: basicPrice, currency: 'USD',
  })
  await publishProduct(product.id)

  const basic = await createTier({
    product_id: product.id, product_version: product.version,
    code: 'basic', name: 'Basic', price_minor: basicPrice,
    quotas: { outbound_whatsapp: 100 },
  })
  await activateTier(basic.id)

  const pro = await createTier({
    product_id: product.id, product_version: product.version,
    code: 'pro', name: 'Pro', price_minor: proPrice,
    quotas: { outbound_whatsapp: 1000, x_posts: 50 },
  })
  await activateTier(pro.id)

  return { product, basic, pro }
}

skipIfNoPostgres()('migration — grandfathering on publishProduct', () => {
  it('stamps grandfathered_at + eligible_for_migration on live subs when a new version publishes', async () => {
    await withTestDb(async (databaseUrl) => {
      configure({ databaseUrl, force: true })
      try {
        const { product, basic } = await seedProductWithTiers({ code: `gf-${randomUUID().slice(0, 8)}` })
        const tenantId = randomUUID()
        const sub = await createSubscription({ tenantId, productId: product.id, tierId: basic.id })
        expect(sub.grandfathered_at).toBeNull()
        expect(sub.eligible_for_migration).toBe(false)

        // Publish v2.
        const v2 = await cloneAsNewVersion(product.id)
        await publishProduct(v2.id)

        const after = await findOne('billing_subscriptions', (s) => s.id === sub.id)
        expect(after.grandfathered_at).not.toBeNull()
        expect(after.eligible_for_migration).toBe(true)

        const events = await listEvents(sub.id)
        expect(events.some((e) => e.event === 'grandfathered')).toBe(true)
      } finally {
        await closeDb()
      }
    })
  })

  it('does not re-stamp grandfathered_at on subs that already carry it', async () => {
    await withTestDb(async (databaseUrl) => {
      configure({ databaseUrl, force: true })
      try {
        const { product, basic } = await seedProductWithTiers({ code: `gf2-${randomUUID().slice(0, 8)}` })
        const sub = await createSubscription({ tenantId: randomUUID(), productId: product.id, tierId: basic.id })
        const v2 = await cloneAsNewVersion(product.id)
        await publishProduct(v2.id)
        const first = await findOne('billing_subscriptions', (s) => s.id === sub.id)
        const firstStamp = first.grandfathered_at

        const v3 = await cloneAsNewVersion(v2.id)
        await publishProduct(v3.id)
        const second = await findOne('billing_subscriptions', (s) => s.id === sub.id)
        expect(second.grandfathered_at).toBe(firstStamp)
      } finally {
        await closeDb()
      }
    })
  })
})

skipIfNoPostgres()('migration — proration + credit notes', () => {
  it('upgrade mid-period: issues a proration_debit credit note with the correct minor amount', async () => {
    await withTestDb(async (databaseUrl) => {
      configure({ databaseUrl, force: true })
      try {
        const { product, basic, pro } = await seedProductWithTiers({ code: `up-${randomUUID().slice(0, 8)}`, basicPrice: 1000, proPrice: 3000 })
        const tenantId = randomUUID()
        const sub = await createSubscription({ tenantId, productId: product.id, tierId: basic.id })

        // Force the period into a known 30-day window centered on now so
        // proration ratio ≈ 0.5 (with a small drift from the real "now").
        await query(
          `UPDATE commercial.billing_subscriptions
              SET billing_period_start = CURRENT_TIMESTAMP - INTERVAL '15 days',
                  billing_period_end = CURRENT_TIMESTAMP + INTERVAL '15 days'
            WHERE id = $1`,
          [sub.id],
        )

        const migrated = await migrateSubscription(sub.id, {
          targetTierId: pro.id,
          prorate: true,
          reason: 'upgrade',
          actorType: 'tenant',
        })
        expect(migrated.tier_id).toBe(pro.id)
        expect(migrated.resolved_plan_price_minor).toBe(3000)

        const notes = await listNotes({ tenantId, subscriptionId: sub.id })
        expect(notes).toHaveLength(1)
        expect(notes[0].type).toBe('proration_debit')
        // ratio ~= 0.5 → old_refund ~= 500, new_charge ~= 1500, net ~= -1000.
        // Allow +/- 100 minor units for the CURRENT_TIMESTAMP drift within
        // the test.
        expect(notes[0].amount_minor).toBeLessThan(-800)
        expect(notes[0].amount_minor).toBeGreaterThan(-1200)

        const events = await listEvents(sub.id)
        expect(events.some((e) => e.event === 'upgraded')).toBe(true)
      } finally {
        await closeDb()
      }
    })
  })

  it('downgrade mid-period: issues a proration_credit', async () => {
    await withTestDb(async (databaseUrl) => {
      configure({ databaseUrl, force: true })
      try {
        const { product, basic, pro } = await seedProductWithTiers({ code: `dn-${randomUUID().slice(0, 8)}`, basicPrice: 1000, proPrice: 3000 })
        const tenantId = randomUUID()
        const sub = await createSubscription({ tenantId, productId: product.id, tierId: pro.id })
        await query(
          `UPDATE commercial.billing_subscriptions
              SET billing_period_start = CURRENT_TIMESTAMP - INTERVAL '15 days',
                  billing_period_end = CURRENT_TIMESTAMP + INTERVAL '15 days'
            WHERE id = $1`,
          [sub.id],
        )

        const migrated = await migrateSubscription(sub.id, {
          targetTierId: basic.id, prorate: true, actorType: 'tenant',
        })
        expect(migrated.tier_id).toBe(basic.id)

        const notes = await listNotes({ tenantId, subscriptionId: sub.id })
        expect(notes).toHaveLength(1)
        expect(notes[0].type).toBe('proration_credit')
        expect(notes[0].amount_minor).toBeGreaterThan(800)
        expect(notes[0].amount_minor).toBeLessThan(1200)

        const events = await listEvents(sub.id)
        expect(events.some((e) => e.event === 'downgraded')).toBe(true)
      } finally {
        await closeDb()
      }
    })
  })

  it('migration with prorate=false skips the credit note entirely', async () => {
    await withTestDb(async (databaseUrl) => {
      configure({ databaseUrl, force: true })
      try {
        const { product, basic, pro } = await seedProductWithTiers({ code: `np-${randomUUID().slice(0, 8)}` })
        const tenantId = randomUUID()
        const sub = await createSubscription({ tenantId, productId: product.id, tierId: basic.id })
        await migrateSubscription(sub.id, { targetTierId: pro.id, prorate: false })
        const notes = await listNotes({ tenantId, subscriptionId: sub.id })
        expect(notes).toHaveLength(0)
      } finally {
        await closeDb()
      }
    })
  })

  it('grandfathered → new version migration clears grandfathered_at and pins to new product_version', async () => {
    await withTestDb(async (databaseUrl) => {
      configure({ databaseUrl, force: true })
      try {
        const { product, basic } = await seedProductWithTiers({ code: `gfmig-${randomUUID().slice(0, 8)}` })
        const tenantId = randomUUID()
        const sub = await createSubscription({ tenantId, productId: product.id, tierId: basic.id })

        // Publish v2 with its own tiers.
        const v2 = await cloneAsNewVersion(product.id)
        await publishProduct(v2.id)
        const v2Basic = await createTier({
          product_id: v2.id, product_version: v2.version,
          code: 'basic', name: 'Basic v2', price_minor: 1200, quotas: { outbound_whatsapp: 120 },
        })
        await activateTier(v2Basic.id)

        // Migrate.
        const migrated = await migrateSubscription(sub.id, {
          targetProductId: v2.id, targetTierId: v2Basic.id, prorate: false, actorType: 'admin',
        })
        expect(migrated.product_id).toBe(v2.id)
        expect(migrated.product_version).toBe(2)
        expect(migrated.tier_id).toBe(v2Basic.id)
        expect(migrated.grandfathered_at).toBeNull()
        expect(migrated.eligible_for_migration).toBe(false)

        const events = await listEvents(sub.id)
        expect(events.some((e) => e.event === 'migrated_version')).toBe(true)
      } finally {
        await closeDb()
      }
    })
  })

  it('cadence-change migration (monthly → annual) rolls the period + grants fresh allowances', async () => {
    await withTestDb(async (databaseUrl) => {
      configure({ databaseUrl, force: true })
      try {
        const monthly = await seedProductWithTiers({ code: `m-${randomUUID().slice(0, 8)}`, cadence: 'monthly' })
        const annual = await seedProductWithTiers({ code: `a-${randomUUID().slice(0, 8)}`, cadence: 'annual', basicPrice: 10000 })
        // Force cross-product with different cadences.
        const tenantId = randomUUID()
        const sub = await createSubscription({ tenantId, productId: monthly.product.id, tierId: monthly.basic.id })
        const originalEnd = sub.billing_period_end

        // Note: cross-product migration + plan exclusivity — since both are
        // 'plan' type, this simulates the "cancel first" flow at the model
        // level. Here we're validating the cadence-roll code path directly
        // by bypassing the exclusivity check via query (admin surface will
        // do a cancel-then-migrate flow at the route layer).
        await query(
          `UPDATE commercial.billing_products SET product_type = 'addon' WHERE id = $1`,
          [annual.product.id],
        )

        const migrated = await migrateSubscription(sub.id, {
          targetProductId: annual.product.id, targetTierId: annual.basic.id, prorate: false, actorType: 'admin',
        })
        expect(new Date(migrated.billing_period_end).getTime()).toBeGreaterThan(new Date(originalEnd).getTime())

        // Two grants for the tenant's outbound_whatsapp quota: initial +
        // the cadence-roll grant.
        const grants = await query(
          `SELECT COUNT(*)::int AS n
             FROM commercial.ledger_entries
            WHERE tenant_id = $1 AND type = 'allowance_grant' AND quota_key = 'outbound_whatsapp'`,
          [tenantId],
        )
        expect(grants[0].n).toBe(2)
      } finally {
        await closeDb()
      }
    })
  })
})

skipIfNoPostgres()('migration — guards', () => {
  it('rejects no-op migration (same tier + product + version)', async () => {
    await withTestDb(async (databaseUrl) => {
      configure({ databaseUrl, force: true })
      try {
        const { product, basic } = await seedProductWithTiers({ code: `noop-${randomUUID().slice(0, 8)}` })
        const sub = await createSubscription({ tenantId: randomUUID(), productId: product.id, tierId: basic.id })
        await expect(migrateSubscription(sub.id, { targetTierId: basic.id })).rejects.toMatchObject({ code: 'NOOP_MIGRATION' })
      } finally {
        await closeDb()
      }
    })
  })

  it('rejects tenant migration to a private tier but admin can force', async () => {
    await withTestDb(async (databaseUrl) => {
      configure({ databaseUrl, force: true })
      try {
        const { product, basic, pro } = await seedProductWithTiers({ code: `priv-${randomUUID().slice(0, 8)}` })
        await query(`UPDATE commercial.billing_product_tiers SET is_public = false WHERE id = $1`, [pro.id])
        const sub = await createSubscription({ tenantId: randomUUID(), productId: product.id, tierId: basic.id })

        await expect(
          migrateSubscription(sub.id, { targetTierId: pro.id, actorType: 'tenant' }),
        ).rejects.toMatchObject({ code: 'TIER_NOT_PUBLIC' })

        const migrated = await migrateSubscription(sub.id, { targetTierId: pro.id, actorType: 'admin', prorate: false })
        expect(migrated.tier_id).toBe(pro.id)
      } finally {
        await closeDb()
      }
    })
  })

  it('rejects migration on cancelled / expired subscriptions', async () => {
    await withTestDb(async (databaseUrl) => {
      configure({ databaseUrl, force: true })
      try {
        const { product, basic, pro } = await seedProductWithTiers({ code: `ded-${randomUUID().slice(0, 8)}` })
        const sub = await createSubscription({ tenantId: randomUUID(), productId: product.id, tierId: basic.id })
        await query(`UPDATE commercial.billing_subscriptions SET status = 'expired' WHERE id = $1`, [sub.id])
        await expect(
          migrateSubscription(sub.id, { targetTierId: pro.id }),
        ).rejects.toMatchObject({ code: 'INVALID_TRANSITION' })
      } finally {
        await closeDb()
      }
    })
  })
})
