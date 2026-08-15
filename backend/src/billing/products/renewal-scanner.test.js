import { randomUUID } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import { closeDb, configure, query } from '../../db.js'
import { skipIfNoPostgres, withTestDb } from '../../testing/postgres.js'
import { createProduct, publishProduct } from './products.js'
import { activateTier, createTier } from './tiers.js'
import { cancelSubscription, createSubscription } from './lifecycle.js'
import { tickRenewals } from './renewal-scanner.js'

async function seedActivePlan() {
  const product = await createProduct({
    code: `plan-${randomUUID().slice(0, 8)}`,
    name: 'P', version: 1, base_price_minor: 5000,
  })
  await publishProduct(product.id)
  const tier = await createTier({
    product_id: product.id, product_version: product.version,
    code: 'pro', name: 'Pro', price_minor: 5000, quotas: { outbound_whatsapp: 100 },
  })
  await activateTier(tier.id)
  return { product, tier }
}

skipIfNoPostgres()('renewal scanner — tickRenewals', () => {
  it('flips trialing → active for subscriptions past their trial_ends_at', async () => {
    await withTestDb(async (databaseUrl) => {
      configure({ databaseUrl, force: true })
      try {
        const { product, tier } = await seedActivePlan()
        const tenantId = randomUUID()
        const sub = await createSubscription({ tenantId, productId: product.id, tierId: tier.id, trialDays: 7 })

        // Force trial_ends_at into the past.
        await query(
          `UPDATE commercial.billing_subscriptions
              SET trial_ends_at = CURRENT_TIMESTAMP - INTERVAL '1 minute'
            WHERE id = $1`,
          [sub.id],
        )

        const summary = await tickRenewals()
        expect(summary.trials_ended).toBeGreaterThanOrEqual(1)

        const [after] = await query(
          `SELECT status, trial_ends_at FROM commercial.billing_subscriptions WHERE id = $1`,
          [sub.id],
        )
        expect(after.status).toBe('active')
        expect(after.trial_ends_at).toBeNull()
      } finally {
        await closeDb()
      }
    })
  })

  it('renews active subscriptions whose next_renewal_at has passed', async () => {
    await withTestDb(async (databaseUrl) => {
      configure({ databaseUrl, force: true })
      try {
        const { product, tier } = await seedActivePlan()
        const sub = await createSubscription({ tenantId: randomUUID(), productId: product.id, tierId: tier.id })
        const originalStart = sub.billing_period_start
        await query(
          `UPDATE commercial.billing_subscriptions
              SET next_renewal_at = CURRENT_TIMESTAMP - INTERVAL '1 minute',
                  billing_period_end = CURRENT_TIMESTAMP - INTERVAL '1 minute'
            WHERE id = $1`,
          [sub.id],
        )

        const summary = await tickRenewals()
        expect(summary.renewed).toBeGreaterThanOrEqual(1)

        const [after] = await query(
          `SELECT status, billing_period_start FROM commercial.billing_subscriptions WHERE id = $1`,
          [sub.id],
        )
        expect(after.status).toBe('active')
        expect(new Date(after.billing_period_start).getTime()).toBeGreaterThan(new Date(originalStart).getTime())
      } finally {
        await closeDb()
      }
    })
  })

  it('expires subscriptions flagged cancel_at_period_end when the period ends', async () => {
    await withTestDb(async (databaseUrl) => {
      configure({ databaseUrl, force: true })
      try {
        const { product, tier } = await seedActivePlan()
        const sub = await createSubscription({ tenantId: randomUUID(), productId: product.id, tierId: tier.id })
        await cancelSubscription(sub.id, { atPeriodEnd: true, reason: 'testing' })
        await query(
          `UPDATE commercial.billing_subscriptions
              SET next_renewal_at = CURRENT_TIMESTAMP - INTERVAL '1 minute',
                  billing_period_end = CURRENT_TIMESTAMP - INTERVAL '1 minute'
            WHERE id = $1`,
          [sub.id],
        )

        const summary = await tickRenewals()
        expect(summary.expired).toBeGreaterThanOrEqual(1)

        const [after] = await query(
          `SELECT status FROM commercial.billing_subscriptions WHERE id = $1`,
          [sub.id],
        )
        expect(after.status).toBe('expired')
      } finally {
        await closeDb()
      }
    })
  })

  it('is idempotent — a second tick with nothing new does nothing', async () => {
    await withTestDb(async (databaseUrl) => {
      configure({ databaseUrl, force: true })
      try {
        const { product, tier } = await seedActivePlan()
        const sub = await createSubscription({ tenantId: randomUUID(), productId: product.id, tierId: tier.id, trialDays: 7 })
        await query(
          `UPDATE commercial.billing_subscriptions
              SET trial_ends_at = CURRENT_TIMESTAMP - INTERVAL '1 minute'
            WHERE id = $1`,
          [sub.id],
        )
        const first = await tickRenewals()
        expect(first.trials_ended).toBe(1)
        const second = await tickRenewals()
        expect(second.trials_ended).toBe(0)
        expect(second.renewed).toBe(0)
        expect(second.expired).toBe(0)
      } finally {
        await closeDb()
      }
    })
  })

  it('skips paused subscriptions even if their next_renewal_at somehow lingered', async () => {
    await withTestDb(async (databaseUrl) => {
      configure({ databaseUrl, force: true })
      try {
        const { product, tier } = await seedActivePlan()
        const sub = await createSubscription({ tenantId: randomUUID(), productId: product.id, tierId: tier.id })
        // Manually set paused + a stale next_renewal_at — scanner should ignore.
        await query(
          `UPDATE commercial.billing_subscriptions
              SET status = 'paused',
                  next_renewal_at = CURRENT_TIMESTAMP - INTERVAL '1 minute'
            WHERE id = $1`,
          [sub.id],
        )
        const summary = await tickRenewals()
        expect(summary.renewed).toBe(0)
      } finally {
        await closeDb()
      }
    })
  })
})
