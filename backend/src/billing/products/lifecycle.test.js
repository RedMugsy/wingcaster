import { randomUUID } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import { closeDb, configure, findAll, query } from '../../db.js'
import { skipIfNoPostgres, withTestDb } from '../../testing/postgres.js'
import { grantAllowance, quotaBalance } from '../ledger.js'
import { createProduct, publishProduct } from './products.js'
import { activateTier, createTier } from './tiers.js'
import {
  cancelSubscription, computeLedgerBillingPeriod, computePeriodEnd,
  createSubscription, endTrial, expireSubscription, markPastDue,
  pauseSubscription, renewSubscription, resolvePastDue, resumeSubscription,
} from './lifecycle.js'
import { listEvents } from './subscription-history.js'

async function seedActivePlan({ cadence = 'monthly', trialTierPrice = null, quotas = { outbound_whatsapp: 500, x_posts: 100 } } = {}) {
  const product = await createProduct({
    code: `plan-${randomUUID().slice(0, 8)}`,
    name: 'Plan',
    version: 1,
    product_type: 'plan',
    billing_cadence: cadence,
    base_price_minor: 5000,
    currency: 'USD',
  })
  await publishProduct(product.id)
  const tier = await createTier({
    product_id: product.id,
    product_version: product.version,
    code: 'pro',
    name: 'Pro',
    price_minor: trialTierPrice ?? 9900,
    quotas,
  })
  await activateTier(tier.id)
  return { product, tier }
}

skipIfNoPostgres()('lifecycle — createSubscription', () => {
  it('starts trialing when trialDays > 0 and grants tier allowances', async () => {
    await withTestDb(async (databaseUrl) => {
      configure({ databaseUrl, force: true })
      try {
        const { product, tier } = await seedActivePlan()
        const tenantId = randomUUID()
        const sub = await createSubscription({ tenantId, productId: product.id, tierId: tier.id, trialDays: 14 })
        expect(sub.status).toBe('trialing')
        expect(sub.trial_ends_at).not.toBeNull()

        const period = computeLedgerBillingPeriod(sub.billing_period_start, 'monthly')
        expect(await quotaBalance({ tenantId, quotaKey: 'outbound_whatsapp', billingPeriod: period })).toBe(500)
        expect(await quotaBalance({ tenantId, quotaKey: 'x_posts', billingPeriod: period })).toBe(100)
      } finally {
        await closeDb()
      }
    })
  })

  it('starts active when no trial, writes history rows', async () => {
    await withTestDb(async (databaseUrl) => {
      configure({ databaseUrl, force: true })
      try {
        const { product, tier } = await seedActivePlan()
        const sub = await createSubscription({ tenantId: randomUUID(), productId: product.id, tierId: tier.id })
        expect(sub.status).toBe('active')
        expect(sub.trial_ends_at).toBeNull()
        const events = await listEvents(sub.id)
        expect(events.some((e) => e.event === 'created')).toBe(true)
      } finally {
        await closeDb()
      }
    })
  })

  it('rejects a second plan subscription while one is live', async () => {
    await withTestDb(async (databaseUrl) => {
      configure({ databaseUrl, force: true })
      try {
        const { product, tier } = await seedActivePlan()
        const tenantId = randomUUID()
        await createSubscription({ tenantId, productId: product.id, tierId: tier.id })
        await expect(
          createSubscription({ tenantId, productId: product.id, tierId: tier.id }),
        ).rejects.toMatchObject({ code: 'PLAN_ALREADY_SUBSCRIBED' })
      } finally {
        await closeDb()
      }
    })
  })

  it('rejects subscribing to an inactive product/tier or a private tier as tenant', async () => {
    await withTestDb(async (databaseUrl) => {
      configure({ databaseUrl, force: true })
      try {
        const product = await createProduct({ code: `p-${randomUUID().slice(0, 8)}`, name: 'p', version: 1 })
        // Still in draft — subscribe should reject.
        const tier = await createTier({ product_id: product.id, product_version: product.version, code: 'pro', name: 'Pro' })
        await activateTier(tier.id)
        await expect(
          createSubscription({ tenantId: randomUUID(), productId: product.id, tierId: tier.id }),
        ).rejects.toMatchObject({ code: 'PRODUCT_NOT_SUBSCRIBABLE' })

        await publishProduct(product.id)
        // Non-public tier + tenant actor → 403 territory.
        await query(`UPDATE commercial.billing_product_tiers SET is_public = false WHERE id = $1`, [tier.id])
        await expect(
          createSubscription({ tenantId: randomUUID(), productId: product.id, tierId: tier.id, actorType: 'tenant' }),
        ).rejects.toMatchObject({ code: 'TIER_NOT_PUBLIC' })
        // Admin can still subscribe a tenant to a non-public tier.
        const forced = await createSubscription({
          tenantId: randomUUID(), productId: product.id, tierId: tier.id, actorType: 'admin',
        })
        expect(forced.status).toBe('active')
      } finally {
        await closeDb()
      }
    })
  })
})

skipIfNoPostgres()('lifecycle — trial + renewal + expiry transitions', () => {
  it('endTrial: rolls into a new active period and grants fresh allowances', async () => {
    await withTestDb(async (databaseUrl) => {
      configure({ databaseUrl, force: true })
      try {
        const { product, tier } = await seedActivePlan({ quotas: { outbound_whatsapp: 300 } })
        const tenantId = randomUUID()
        const sub = await createSubscription({ tenantId, productId: product.id, tierId: tier.id, trialDays: 7 })
        expect(sub.status).toBe('trialing')
        const ended = await endTrial(sub.id)
        expect(ended.status).toBe('active')
        expect(ended.trial_ends_at).toBeNull()
        // Two grant entries now: one for the trial period, one for the
        // post-trial rollover.
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

  it('renewSubscription: rolls the period + grants; refuses if not active', async () => {
    await withTestDb(async (databaseUrl) => {
      configure({ databaseUrl, force: true })
      try {
        const { product, tier } = await seedActivePlan()
        const tenantId = randomUUID()
        const sub = await createSubscription({ tenantId, productId: product.id, tierId: tier.id })
        const renewed = await renewSubscription(sub.id)
        expect(renewed.status).toBe('active')
        expect(new Date(renewed.billing_period_start).getTime()).toBeGreaterThan(new Date(sub.billing_period_start).getTime())

        // Paused subscriptions can't be renewed directly — must resume first.
        await pauseSubscription(renewed.id)
        await expect(renewSubscription(renewed.id)).rejects.toMatchObject({ code: 'INVALID_TRANSITION' })
      } finally {
        await closeDb()
      }
    })
  })

  it('renewSubscription: cancel_at_period_end=true → expires instead of renewing', async () => {
    await withTestDb(async (databaseUrl) => {
      configure({ databaseUrl, force: true })
      try {
        const { product, tier } = await seedActivePlan()
        const sub = await createSubscription({ tenantId: randomUUID(), productId: product.id, tierId: tier.id })
        await cancelSubscription(sub.id, { atPeriodEnd: true, reason: 'not using' })
        const rolled = await renewSubscription(sub.id)
        expect(rolled.status).toBe('expired')
      } finally {
        await closeDb()
      }
    })
  })

  it('renewSubscription: auto_renew=false → expires instead of renewing', async () => {
    await withTestDb(async (databaseUrl) => {
      configure({ databaseUrl, force: true })
      try {
        const { product, tier } = await seedActivePlan()
        const sub = await createSubscription({
          tenantId: randomUUID(), productId: product.id, tierId: tier.id, autoRenew: false,
        })
        const rolled = await renewSubscription(sub.id)
        expect(rolled.status).toBe('expired')
      } finally {
        await closeDb()
      }
    })
  })
})

skipIfNoPostgres()('lifecycle — cancel / pause / resume', () => {
  it('cancel with atPeriodEnd=true stays active + sets flag; second call transitions to cancelled immediately', async () => {
    await withTestDb(async (databaseUrl) => {
      configure({ databaseUrl, force: true })
      try {
        const { product, tier } = await seedActivePlan()
        const sub = await createSubscription({ tenantId: randomUUID(), productId: product.id, tierId: tier.id })
        const graced = await cancelSubscription(sub.id, { atPeriodEnd: true, reason: 'testing' })
        expect(graced.status).toBe('active')
        expect(graced.cancel_at_period_end).toBe(true)

        const immediate = await cancelSubscription(sub.id, { atPeriodEnd: false, reason: 'now' })
        expect(immediate.status).toBe('cancelled')
        expect(immediate.cancelled_at).not.toBeNull()

        // Cancelled subscriptions can't be cancelled again.
        await expect(cancelSubscription(sub.id)).rejects.toMatchObject({ code: 'INVALID_TRANSITION' })
      } finally {
        await closeDb()
      }
    })
  })

  it('pause → resume: no rollover when period_end still in future', async () => {
    await withTestDb(async (databaseUrl) => {
      configure({ databaseUrl, force: true })
      try {
        const { product, tier } = await seedActivePlan()
        const tenantId = randomUUID()
        const sub = await createSubscription({ tenantId, productId: product.id, tierId: tier.id })
        const paused = await pauseSubscription(sub.id, { reason: 'holiday' })
        expect(paused.status).toBe('paused')
        expect(paused.next_renewal_at).toBeNull()

        const resumed = await resumeSubscription(sub.id)
        expect(resumed.status).toBe('active')
        expect(resumed.next_renewal_at).not.toBeNull()

        // Same period — no extra grant.
        const grants = await query(
          `SELECT COUNT(*)::int AS n
             FROM commercial.ledger_entries
            WHERE tenant_id = $1 AND type = 'allowance_grant' AND quota_key = 'outbound_whatsapp'`,
          [tenantId],
        )
        expect(grants[0].n).toBe(1)
      } finally {
        await closeDb()
      }
    })
  })

  it('pause → resume: period_end already past → rolls forward with fresh allowance', async () => {
    await withTestDb(async (databaseUrl) => {
      configure({ databaseUrl, force: true })
      try {
        const { product, tier } = await seedActivePlan({ quotas: { outbound_whatsapp: 200 } })
        const tenantId = randomUUID()
        const sub = await createSubscription({ tenantId, productId: product.id, tierId: tier.id })
        await pauseSubscription(sub.id)
        // Fast-forward the row's billing_period_end into the past.
        await query(
          `UPDATE commercial.billing_subscriptions
              SET billing_period_end = CURRENT_TIMESTAMP - INTERVAL '1 day'
            WHERE id = $1`,
          [sub.id],
        )
        const resumed = await resumeSubscription(sub.id)
        expect(resumed.status).toBe('active')
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

skipIfNoPostgres()('lifecycle — past_due', () => {
  it('mark → resolve round trip', async () => {
    await withTestDb(async (databaseUrl) => {
      configure({ databaseUrl, force: true })
      try {
        const { product, tier } = await seedActivePlan()
        const sub = await createSubscription({ tenantId: randomUUID(), productId: product.id, tierId: tier.id })
        const flagged = await markPastDue(sub.id, { reason: 'card declined' })
        expect(flagged.status).toBe('past_due')
        const back = await resolvePastDue(sub.id, { reason: 'card updated' })
        expect(back.status).toBe('active')
      } finally {
        await closeDb()
      }
    })
  })
})

describe('lifecycle — pure helpers', () => {
  it('computePeriodEnd: monthly + annual + 90-day + custom + one-off', () => {
    const start = new Date('2026-03-15T00:00:00Z')
    expect(computePeriodEnd(start, 'monthly').toISOString()).toBe('2026-04-15T00:00:00.000Z')
    expect(computePeriodEnd(start, 'annual').toISOString()).toBe('2027-03-15T00:00:00.000Z')
    expect(computePeriodEnd(start, '90_days').toISOString()).toBe('2026-06-13T00:00:00.000Z')
    expect(computePeriodEnd(start, 'custom', { customPeriodDays: 45 }).toISOString()).toBe('2026-04-29T00:00:00.000Z')
    expect(computePeriodEnd(start, 'one_off')).toBeNull()
  })

  it('computePeriodEnd: trialDays > 0 wins over cadence', () => {
    const start = new Date('2026-03-15T00:00:00Z')
    expect(computePeriodEnd(start, 'monthly', { trialDays: 7 }).toISOString()).toBe('2026-03-22T00:00:00.000Z')
  })

  it('computePeriodEnd: custom cadence without custom_period_days throws', () => {
    expect(() => computePeriodEnd(new Date(), 'custom')).toThrow(/custom_period_days/)
  })

  it('computeLedgerBillingPeriod: monthly / annual / 90-day', () => {
    const d = new Date('2026-08-16T00:00:00Z')
    expect(computeLedgerBillingPeriod(d, 'monthly')).toBe('2026-08')
    expect(computeLedgerBillingPeriod(d, 'annual')).toBe('2026')
    expect(computeLedgerBillingPeriod(d, '90_days')).toBe('2026-08-16')
  })
})
