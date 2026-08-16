import { randomUUID } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import { closeDb, configure, query } from '../../db.js'
import { skipIfNoPostgres, withTestDb } from '../../testing/postgres.js'
import {
  churnRate,
  mrrByCurrency,
  mrrByTerritory,
  pendingCreditExposure,
  subscriptionsByStatusAndTier,
} from './metrics.js'

async function seedProduct({ code = null, cadence = 'monthly' } = {}) {
  const id = randomUUID()
  const c = code || `p-${id.slice(0, 8)}`
  await query(
    `INSERT INTO commercial.billing_products (id, code, version, name, product_type, billing_cadence, base_price_minor, currency, status, published_at)
     VALUES ($1, $2, 1, 'P', 'plan', $3, 9900, 'USD', 'active', CURRENT_TIMESTAMP)`,
    [id, c, cadence],
  )
  return id
}

async function seedTier(productId, { code = 'pro', priceMinor = 9900 } = {}) {
  const id = randomUUID()
  await query(
    `INSERT INTO commercial.billing_product_tiers (id, product_id, product_version, code, name, price_minor, currency, status, quotas, features)
     VALUES ($1, $2, 1, $3, $3, $4, 'USD', 'active', '{}'::jsonb, '[]'::jsonb)`,
    [id, productId, code, priceMinor],
  )
  return id
}

async function seedSubscription({
  productId, tierId, status = 'active', currency = 'USD', priceMinor = 9900,
  territoryId = null, cadence = 'monthly',
}) {
  const id = randomUUID()
  const tenantId = randomUUID()
  await query(
    `INSERT INTO commercial.billing_subscriptions
       (id, tenant_id, product_id, product_version, tier_id, status,
        territory_id, resolved_plan_price_minor, resolved_plan_currency,
        billing_period_start, billing_period_end, next_renewal_at, auto_renew,
        metadata)
     VALUES ($1, $2, $3, 1, $4, $5, $6, $7, $8,
        CURRENT_TIMESTAMP, CURRENT_TIMESTAMP + INTERVAL '30 days',
        CURRENT_TIMESTAMP + INTERVAL '30 days', true,
        jsonb_build_object('cadence', $9::text))`,
    [id, tenantId, productId, tierId, status, territoryId, priceMinor, currency, cadence],
  )
  return { id, tenantId }
}

skipIfNoPostgres()('reporting.metrics — mrrByCurrency', () => {
  it('sums active + trialing + past_due + paused into the correct buckets', async () => {
    await withTestDb(async (databaseUrl) => {
      configure({ databaseUrl, force: true })
      try {
        const productId = await seedProduct()
        const tierId = await seedTier(productId)

        await seedSubscription({ productId, tierId, status: 'active', priceMinor: 9900 })
        await seedSubscription({ productId, tierId, status: 'active', priceMinor: 9900 })
        await seedSubscription({ productId, tierId, status: 'trialing', priceMinor: 9900 })
        await seedSubscription({ productId, tierId, status: 'past_due', priceMinor: 9900 })
        await seedSubscription({ productId, tierId, status: 'paused', priceMinor: 9900 })
        await seedSubscription({ productId, tierId, status: 'expired', priceMinor: 9900 })

        const result = await mrrByCurrency()
        const usd = result.by_currency.find((b) => b.currency === 'USD')
        expect(usd?.subscribers).toBe(5)  // expired doesn't count
        expect(usd?.active_mrr_minor).toBe(9900 * 2)
        expect(usd?.trialing_mrr_minor).toBe(9900)
        expect(usd?.past_due_mrr_minor).toBe(9900)
        expect(usd?.paused_mrr_minor).toBe(9900)
        expect(usd?.total_committed_mrr_minor).toBe(9900 * 4) // active + trial + past_due
        expect(usd?.arr_minor).toBe(9900 * 2 * 12)
      } finally {
        await closeDb()
      }
    })
  })

  it('annual subscriptions normalize to monthly (÷12)', async () => {
    await withTestDb(async (databaseUrl) => {
      configure({ databaseUrl, force: true })
      try {
        const productId = await seedProduct({ cadence: 'annual' })
        const tierId = await seedTier(productId)
        await seedSubscription({ productId, tierId, status: 'active', priceMinor: 120000, cadence: 'annual' })
        const result = await mrrByCurrency()
        expect(result.by_currency[0].active_mrr_minor).toBe(10000)
      } finally {
        await closeDb()
      }
    })
  })
})

skipIfNoPostgres()('reporting.metrics — mrrByTerritory', () => {
  it('groups by territory code', async () => {
    await withTestDb(async (databaseUrl) => {
      configure({ databaseUrl, force: true })
      try {
        const productId = await seedProduct()
        const tierId = await seedTier(productId)

        // Insert two territories.
        const lb = randomUUID()
        const sa = randomUUID()
        await query(
          `INSERT INTO commercial.territories (id, code, name, currency, pricing_multiplier, launch_status, active)
           VALUES ($1, 'LB', 'Lebanon', 'USD', 0.4, 'launched', true),
                  ($2, 'SA', 'Saudi', 'USD', 2.5, 'launched', true)`,
          [lb, sa],
        )
        await seedSubscription({ productId, tierId, status: 'active', priceMinor: 4000, territoryId: lb })
        await seedSubscription({ productId, tierId, status: 'active', priceMinor: 25000, territoryId: sa })
        await seedSubscription({ productId, tierId, status: 'active', priceMinor: 25000, territoryId: sa })
        // Unassigned sub
        await seedSubscription({ productId, tierId, status: 'active', priceMinor: 10000, territoryId: null })

        const result = await mrrByTerritory()
        expect(result.by_territory).toHaveLength(3)
        const sortedByRevenue = result.by_territory
        expect(sortedByRevenue[0].territory_code).toBe('SA')
        expect(sortedByRevenue[0].active_mrr_minor).toBe(50000)
      } finally {
        await closeDb()
      }
    })
  })
})

skipIfNoPostgres()('reporting.metrics — churnRate', () => {
  it('opening / churned / churn_rate against the history log', async () => {
    await withTestDb(async (databaseUrl) => {
      configure({ databaseUrl, force: true })
      try {
        const productId = await seedProduct()
        const tierId = await seedTier(productId)

        // Two subs alive at window start.
        const s1 = await seedSubscription({ productId, tierId, status: 'active' })
        const s2 = await seedSubscription({ productId, tierId, status: 'active' })
        // Backdate their creation to before the window.
        await query(
          `UPDATE commercial.billing_subscriptions
              SET created_at = CURRENT_TIMESTAMP - INTERVAL '60 days'
            WHERE id = ANY($1::text[])`,
          [[s1.id, s2.id]],
        )
        // One of them churns inside the window.
        await query(
          `INSERT INTO commercial.billing_subscription_history (id, subscription_id, event, created_at)
           VALUES ($1, $2, 'cancelled_immediately', CURRENT_TIMESTAMP - INTERVAL '5 days')`,
          [randomUUID(), s1.id],
        )

        const result = await churnRate({ windowDays: 30 })
        expect(result.opening_subscribers).toBe(2)
        expect(result.churned).toBe(1)
        expect(result.churn_rate).toBeCloseTo(0.5, 4)
      } finally {
        await closeDb()
      }
    })
  })
})

skipIfNoPostgres()('reporting.metrics — pendingCreditExposure', () => {
  it('splits credit vs debit and computes net liability', async () => {
    await withTestDb(async (databaseUrl) => {
      configure({ databaseUrl, force: true })
      try {
        const tenantA = randomUUID()
        const tenantB = randomUUID()
        await query(
          `INSERT INTO commercial.billing_credit_notes (id, tenant_id, type, amount_minor, currency, status)
           VALUES ($1, $5, 'courtesy',           1000, 'USD', 'pending'),
                  ($2, $6, 'refund',              500, 'USD', 'pending'),
                  ($3, $5, 'proration_debit',   -800, 'USD', 'pending'),
                  ($4, $5, 'courtesy',          2000, 'USD', 'applied')`,
          [randomUUID(), randomUUID(), randomUUID(), randomUUID(), tenantA, tenantB],
        )
        const rows = await pendingCreditExposure()
        const usd = rows.find((r) => r.currency === 'USD')
        expect(usd?.credit_owed_minor).toBe(1500)
        expect(usd?.debit_owed_minor).toBe(800)
        expect(usd?.net_liability_minor).toBe(700)
        expect(usd?.pending_count).toBe(3) // 'applied' excluded
      } finally {
        await closeDb()
      }
    })
  })
})

skipIfNoPostgres()('reporting.metrics — subscriptionsByStatusAndTier', () => {
  it('groups by (status, product, tier, currency)', async () => {
    await withTestDb(async (databaseUrl) => {
      configure({ databaseUrl, force: true })
      try {
        const productId = await seedProduct()
        const basic = await seedTier(productId, { code: 'basic', priceMinor: 1000 })
        const pro = await seedTier(productId, { code: 'pro', priceMinor: 5000 })
        await seedSubscription({ productId, tierId: basic, status: 'active', priceMinor: 1000 })
        await seedSubscription({ productId, tierId: basic, status: 'active', priceMinor: 1000 })
        await seedSubscription({ productId, tierId: pro,   status: 'active', priceMinor: 5000 })
        await seedSubscription({ productId, tierId: pro,   status: 'trialing', priceMinor: 5000 })

        const rows = await subscriptionsByStatusAndTier()
        const basicActive = rows.find((r) => r.tier_code === 'basic' && r.status === 'active')
        const proActive = rows.find((r) => r.tier_code === 'pro' && r.status === 'active')
        const proTrial = rows.find((r) => r.tier_code === 'pro' && r.status === 'trialing')
        expect(basicActive?.subscribers).toBe(2)
        expect(basicActive?.total_price_minor).toBe(2000)
        expect(proActive?.subscribers).toBe(1)
        expect(proTrial?.subscribers).toBe(1)
      } finally {
        await closeDb()
      }
    })
  })
})
