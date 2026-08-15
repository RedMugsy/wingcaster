import { randomUUID } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import { closeDb, configure, query } from '../../db.js'
import { skipIfNoPostgres, withTestDb } from '../../testing/postgres.js'
import { createProduct, publishProduct } from './products.js'
import { activateTier, createTier, deprecateTier, retireTier, updateTier } from './tiers.js'

async function seedActiveProduct() {
  const p = await createProduct({ code: `prod-${randomUUID().slice(0, 8)}`, name: 'P', version: 1 })
  await publishProduct(p.id)
  return p
}

async function insertLiveSub(productId, tierId) {
  await query(
    `INSERT INTO commercial.billing_subscriptions (id, tenant_id, product_id, product_version, tier_id, status)
     VALUES ($1, $2, $3, 1, $4, 'active')`,
    [randomUUID(), randomUUID(), productId, tierId],
  )
}

skipIfNoPostgres()('product catalog — tiers.js', () => {
  it('createTier: happy path stores normalized quotas + defaults', async () => {
    await withTestDb(async (databaseUrl) => {
      configure({ databaseUrl, force: true })
      try {
        const product = await seedActiveProduct()
        const tier = await createTier({
          product_id: product.id,
          product_version: product.version,
          code: 'PRO',
          name: 'Pro',
          price_minor: 9900,
          currency: 'usd',
          quotas: { outbound_whatsapp: '500', x_posts: 100 },
          features: ['ai_staging'],
        })
        expect(tier.code).toBe('pro')
        expect(tier.currency).toBe('USD')
        expect(tier.quotas).toEqual({ outbound_whatsapp: 500, x_posts: 100 })
        expect(tier.status).toBe('draft')
      } finally {
        await closeDb()
      }
    })
  })

  it('createTier: rejects duplicate code within same (product, version)', async () => {
    await withTestDb(async (databaseUrl) => {
      configure({ databaseUrl, force: true })
      try {
        const product = await seedActiveProduct()
        await createTier({ product_id: product.id, product_version: product.version, code: 'basic', name: 'B' })
        await expect(
          createTier({ product_id: product.id, product_version: product.version, code: 'basic', name: 'B dup' }),
        ).rejects.toMatchObject({ code: 'DUPLICATE_CODE' })
      } finally {
        await closeDb()
      }
    })
  })

  it('createTier: rejects negative quotas', async () => {
    await withTestDb(async (databaseUrl) => {
      configure({ databaseUrl, force: true })
      try {
        const product = await seedActiveProduct()
        await expect(
          createTier({
            product_id: product.id, product_version: product.version,
            code: 'x', name: 'x',
            quotas: { outbound_whatsapp: -1 },
          }),
        ).rejects.toMatchObject({ code: 'INVALID_QUOTA' })
      } finally {
        await closeDb()
      }
    })
  })

  it('updateTier: draft accepts price/quota edits; active rejects them', async () => {
    await withTestDb(async (databaseUrl) => {
      configure({ databaseUrl, force: true })
      try {
        const product = await seedActiveProduct()
        const t = await createTier({
          product_id: product.id, product_version: product.version,
          code: 't', name: 'T', price_minor: 1000, quotas: { outbound_whatsapp: 100 },
        })
        const draftEdit = await updateTier(t.id, { price_minor: 2000, quotas: { outbound_whatsapp: 200 } })
        expect(draftEdit.price_minor).toBe(2000)
        expect(draftEdit.quotas).toEqual({ outbound_whatsapp: 200 })

        await activateTier(t.id)

        await expect(updateTier(t.id, { price_minor: 3000 })).rejects.toMatchObject({ code: 'TIER_LOCKED' })
        await expect(updateTier(t.id, { quotas: { x_posts: 5 } })).rejects.toMatchObject({ code: 'TIER_LOCKED' })
        // Name still editable on active tiers.
        const namePatch = await updateTier(t.id, { name: 'Renamed', sort_order: 5, is_public: false })
        expect(namePatch.name).toBe('Renamed')
        expect(namePatch.sort_order).toBe(5)
        expect(namePatch.is_public).toBe(false)
      } finally {
        await closeDb()
      }
    })
  })

  it('lifecycle: draft → active → deprecated → retired; retire blocked while live subs exist', async () => {
    await withTestDb(async (databaseUrl) => {
      configure({ databaseUrl, force: true })
      try {
        const product = await seedActiveProduct()
        const t = await createTier({ product_id: product.id, product_version: product.version, code: 'l', name: 'L' })

        await expect(deprecateTier(t.id)).rejects.toMatchObject({ code: 'INVALID_TRANSITION' })
        await activateTier(t.id)
        await deprecateTier(t.id)

        // Simulate a live sub bound to this tier.
        await insertLiveSub(product.id, t.id)
        await expect(retireTier(t.id)).rejects.toMatchObject({ code: 'RETIRE_HAS_ACTIVE_SUBS' })

        // Remove the sub, then retire succeeds.
        await query(`DELETE FROM commercial.billing_subscriptions WHERE tier_id = $1`, [t.id])
        const retired = await retireTier(t.id)
        expect(retired.status).toBe('retired')
      } finally {
        await closeDb()
      }
    })
  })
})
