import { randomUUID } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import { closeDb, configure, query } from '../../db.js'
import { skipIfNoPostgres, withTestDb } from '../../testing/postgres.js'
import { createProduct, publishProduct } from './products.js'
import { createTier } from './tiers.js'
import { createOverride, resolveEffectivePrice } from './pricing-overrides.js'

async function seedTerritory(code) {
  const id = randomUUID()
  // A territory is split across two tables: name/currency live on the public
  // row, and commercial.territories holds only the commercial fields with its
  // id referencing public.territories(id). The public row must exist first.
  await query(
    'INSERT INTO public.territories (id, code, name, currency) VALUES ($1, $2, $3, $4)',
    [id, code, `Territory ${code}`, 'USD'],
  )
  await query(
    `INSERT INTO commercial.territories (id, code, pricing_multiplier, launch_status, active)
     VALUES ($1, $2, 1.0, 'launched', true)`,
    [id, code],
  )
  return { id, code }
}

skipIfNoPostgres()('product catalog — pricing overrides', () => {
  it('resolveEffectivePrice: falls back to product base when no tier / no override', async () => {
    await withTestDb(async (databaseUrl) => {
      configure({ databaseUrl, force: true })
      try {
        const product = await createProduct({
          code: `p-base-${randomUUID().slice(0, 8)}`,
          name: 'Base', version: 1, base_price_minor: 5000, currency: 'USD',
        })
        const resolved = await resolveEffectivePrice({ product, tier: null, territoryId: null })
        expect(resolved).toEqual({ priceMinor: 5000, currency: 'USD', source: 'product_base' })
      } finally {
        await closeDb()
      }
    })
  })

  it('resolveEffectivePrice: uses tier.price_minor when set', async () => {
    await withTestDb(async (databaseUrl) => {
      configure({ databaseUrl, force: true })
      try {
        const product = await createProduct({ code: `p-t-${randomUUID().slice(0, 8)}`, name: 'P', version: 1, base_price_minor: 5000, currency: 'USD' })
        const tier = await createTier({ product_id: product.id, product_version: product.version, code: 'pro', name: 'Pro', price_minor: 9900 })
        const resolved = await resolveEffectivePrice({ product, tier, territoryId: null })
        expect(resolved).toEqual({ priceMinor: 9900, currency: 'USD', source: 'tier_base' })
      } finally {
        await closeDb()
      }
    })
  })

  it('resolveEffectivePrice: product-territory override wins over tier base', async () => {
    await withTestDb(async (databaseUrl) => {
      configure({ databaseUrl, force: true })
      try {
        const product = await createProduct({ code: `p-po-${randomUUID().slice(0, 8)}`, name: 'P', version: 1, base_price_minor: 5000, currency: 'USD' })
        const tier = await createTier({ product_id: product.id, product_version: product.version, code: 'pro', name: 'Pro', price_minor: 9900 })
        const territory = await seedTerritory(`t${randomUUID().slice(0, 6)}`)
        await createOverride({
          product_id: product.id, product_version: product.version,
          territory_id: territory.id, price_minor: 4200, currency: 'USD',
        })
        const resolved = await resolveEffectivePrice({ product, tier, territoryId: territory.id })
        expect(resolved).toEqual({ priceMinor: 4200, currency: 'USD', source: 'override_product_territory' })
      } finally {
        await closeDb()
      }
    })
  })

  it('resolveEffectivePrice: tier-territory override beats product-territory override', async () => {
    await withTestDb(async (databaseUrl) => {
      configure({ databaseUrl, force: true })
      try {
        const product = await createProduct({ code: `p-tt-${randomUUID().slice(0, 8)}`, name: 'P', version: 1, base_price_minor: 5000, currency: 'USD' })
        const tier = await createTier({ product_id: product.id, product_version: product.version, code: 'pro', name: 'Pro', price_minor: 9900 })
        const territory = await seedTerritory(`t${randomUUID().slice(0, 6)}`)
        await createOverride({
          product_id: product.id, product_version: product.version,
          territory_id: territory.id, price_minor: 4200, currency: 'USD',
        })
        await createOverride({
          product_id: product.id, product_version: product.version, tier_id: tier.id,
          territory_id: territory.id, price_minor: 7500, currency: 'USD',
        })
        const resolved = await resolveEffectivePrice({ product, tier, territoryId: territory.id })
        expect(resolved).toEqual({ priceMinor: 7500, currency: 'USD', source: 'override_tier_territory' })
      } finally {
        await closeDb()
      }
    })
  })

  it('resolveEffectivePrice: inactive overrides are ignored', async () => {
    await withTestDb(async (databaseUrl) => {
      configure({ databaseUrl, force: true })
      try {
        const product = await createProduct({ code: `p-inact-${randomUUID().slice(0, 8)}`, name: 'P', version: 1, base_price_minor: 5000, currency: 'USD' })
        const territory = await seedTerritory(`t${randomUUID().slice(0, 6)}`)
        const override = await createOverride({
          product_id: product.id, product_version: product.version,
          territory_id: territory.id, price_minor: 4200, currency: 'USD',
        })
        await query(
          `UPDATE commercial.billing_product_territory_pricing SET active = false WHERE id = $1`,
          [override.id],
        )
        const resolved = await resolveEffectivePrice({ product, tier: null, territoryId: territory.id })
        expect(resolved.source).toBe('product_base')
      } finally {
        await closeDb()
      }
    })
  })

  it('createOverride: rejects a duplicate (product, version, tier, territory)', async () => {
    await withTestDb(async (databaseUrl) => {
      configure({ databaseUrl, force: true })
      try {
        const product = await createProduct({ code: `p-dup-${randomUUID().slice(0, 8)}`, name: 'P', version: 1, base_price_minor: 1000 })
        const territory = await seedTerritory(`t${randomUUID().slice(0, 6)}`)
        await createOverride({
          product_id: product.id, product_version: product.version,
          territory_id: territory.id, price_minor: 500, currency: 'USD',
        })
        await expect(
          createOverride({
            product_id: product.id, product_version: product.version,
            territory_id: territory.id, price_minor: 700, currency: 'USD',
          }),
        ).rejects.toMatchObject({ code: 'DUPLICATE_OVERRIDE' })
      } finally {
        await closeDb()
      }
    })
  })
})
