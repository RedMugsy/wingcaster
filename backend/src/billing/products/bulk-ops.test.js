import { randomUUID } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import { closeDb, configure } from '../../db.js'
import { skipIfNoPostgres, withTestDb } from '../../testing/postgres.js'
import { createProduct, publishProduct } from './products.js'
import { activateTier, createTier } from './tiers.js'
import { createSubscription } from './lifecycle.js'
import {
  bulkCancel,
  bulkExpire,
  bulkIssueCredits,
  bulkMigrate,
  bulkPause,
  bulkResume,
} from './bulk-ops.js'
import { listNotes } from './credit-notes.js'

async function seedActivePlan() {
  const product = await createProduct({
    code: `bulk-${randomUUID().slice(0, 8)}`,
    name: 'Bulk Plan',
    version: 1,
    base_price_minor: 9900,
  })
  await publishProduct(product.id)
  const basic = await createTier({
    product_id: product.id, product_version: product.version, code: 'basic', name: 'Basic',
    price_minor: 5000, quotas: { outbound_whatsapp: 100 },
  })
  await activateTier(basic.id)
  const pro = await createTier({
    product_id: product.id, product_version: product.version, code: 'pro', name: 'Pro',
    price_minor: 9900, quotas: { outbound_whatsapp: 500 },
  })
  await activateTier(pro.id)
  return { product, basic, pro }
}

skipIfNoPostgres()('bulk-ops', () => {
  it('bulkCancel: mixed successes + one bad id, per-row results captured', async () => {
    await withTestDb(async (databaseUrl) => {
      configure({ databaseUrl, force: true })
      try {
        const { product, basic } = await seedActivePlan()
        const s1 = await createSubscription({ tenantId: randomUUID(), productId: product.id, tierId: basic.id })
        const s2 = await createSubscription({ tenantId: randomUUID(), productId: product.id, tierId: basic.id })
        const bad = randomUUID()

        const result = await bulkCancel({ subscriptionIds: [s1.id, bad, s2.id], reason: 'test', immediate: true })
        expect(result.total).toBe(3)
        expect(result.results).toHaveLength(3)
        const ok = result.results.filter((r) => r.ok)
        const failed = result.results.filter((r) => !r.ok)
        expect(ok).toHaveLength(2)
        expect(failed).toHaveLength(1)
        expect(failed[0].code).toBe('NOT_FOUND')
      } finally {
        await closeDb()
      }
    })
  })

  it('bulkMigrate: moves N subs to a new tier and returns their new tier_id', async () => {
    await withTestDb(async (databaseUrl) => {
      configure({ databaseUrl, force: true })
      try {
        const { product, basic, pro } = await seedActivePlan()
        const subs = await Promise.all([
          createSubscription({ tenantId: randomUUID(), productId: product.id, tierId: basic.id }),
          createSubscription({ tenantId: randomUUID(), productId: product.id, tierId: basic.id }),
          createSubscription({ tenantId: randomUUID(), productId: product.id, tierId: basic.id }),
        ])
        const result = await bulkMigrate({
          subscriptionIds: subs.map((s) => s.id),
          targetTierId: pro.id,
          prorate: false,
        })
        expect(result.results.every((r) => r.ok && r.tier_id === pro.id)).toBe(true)
      } finally {
        await closeDb()
      }
    })
  })

  it('bulkPause + bulkResume round trip', async () => {
    await withTestDb(async (databaseUrl) => {
      configure({ databaseUrl, force: true })
      try {
        const { product, basic } = await seedActivePlan()
        const subs = await Promise.all([
          createSubscription({ tenantId: randomUUID(), productId: product.id, tierId: basic.id }),
          createSubscription({ tenantId: randomUUID(), productId: product.id, tierId: basic.id }),
        ])
        const ids = subs.map((s) => s.id)

        const pauseResult = await bulkPause({ subscriptionIds: ids })
        expect(pauseResult.results.every((r) => r.ok && r.status === 'paused')).toBe(true)

        const resumeResult = await bulkResume({ subscriptionIds: ids })
        expect(resumeResult.results.every((r) => r.ok && r.status === 'active')).toBe(true)
      } finally {
        await closeDb()
      }
    })
  })

  it('bulkIssueCredits: writes N notes, per-tenant', async () => {
    await withTestDb(async (databaseUrl) => {
      configure({ databaseUrl, force: true })
      try {
        const tenants = [randomUUID(), randomUUID(), randomUUID()]
        const result = await bulkIssueCredits({
          entries: tenants.map((tenantId) => ({
            tenant_id: tenantId,
            type: 'courtesy',
            amount_minor: 500,
            currency: 'USD',
            reason: 'onboarding',
          })),
        })
        expect(result.total).toBe(3)
        expect(result.results.every((r) => r.ok)).toBe(true)

        for (const tenant of tenants) {
          const notes = await listNotes({ tenantId: tenant })
          expect(notes).toHaveLength(1)
          expect(notes[0].amount_minor).toBe(500)
        }
      } finally {
        await closeDb()
      }
    })
  })

  it('rejects empty / oversized arrays', async () => {
    await expect(bulkCancel({ subscriptionIds: [] })).rejects.toMatchObject({ code: 'INVALID_INPUT' })
    const big = Array.from({ length: 501 }, () => randomUUID())
    await expect(bulkCancel({ subscriptionIds: big })).rejects.toMatchObject({ code: 'BULK_LIMIT' })
    await expect(bulkIssueCredits({ entries: [] })).rejects.toMatchObject({ code: 'INVALID_INPUT' })
    await expect(bulkMigrate({ subscriptionIds: [randomUUID()], targetTierId: null })).rejects.toMatchObject({ code: 'MISSING_FIELD' })
  })
})
