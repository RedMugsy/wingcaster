import { randomUUID } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import { closeDb, configure, query } from '../../db.js'
import { skipIfNoPostgres, withTestDb } from '../../testing/postgres.js'
import {
  createProduct,
  cloneAsNewVersion,
  deprecateProduct,
  publishProduct,
  retireProduct,
  updateProduct,
  latestVersionForCode,
} from './products.js'

async function insertMinimalSubscription(productId, tenantId = randomUUID()) {
  await query(
    `INSERT INTO commercial.billing_subscriptions (id, tenant_id, product_id, product_version, status)
     VALUES ($1, $2, $3, 1, 'active')`,
    [randomUUID(), tenantId, productId],
  )
}

skipIfNoPostgres()('product catalog — products.js', () => {
  it('createProduct assigns version 1 on first call and increments on next', async () => {
    await withTestDb(async (databaseUrl) => {
      configure({ databaseUrl, force: true })
      try {
        const code = `test-plan-${randomUUID().slice(0, 8)}`
        const first = await createProduct({ code, name: 'Test Plan' })
        expect(first.version).toBe(1)
        expect(first.status).toBe('draft')
        expect(first.product_type).toBe('plan')

        const secondVersion = (await latestVersionForCode(code)) + 1
        const second = await createProduct({ code, name: 'Test Plan v2', version: secondVersion })
        expect(second.version).toBe(2)
      } finally {
        await closeDb()
      }
    })
  })

  it('createProduct rejects duplicate (code, version)', async () => {
    await withTestDb(async (databaseUrl) => {
      configure({ databaseUrl, force: true })
      try {
        const code = `dup-plan-${randomUUID().slice(0, 8)}`
        await createProduct({ code, name: 'A', version: 1 })
        await expect(createProduct({ code, name: 'A dup', version: 1 })).rejects.toMatchObject({
          code: 'DUPLICATE_VERSION',
        })
      } finally {
        await closeDb()
      }
    })
  })

  it('createProduct rejects invalid code / cadence / price / type', async () => {
    await withTestDb(async (databaseUrl) => {
      configure({ databaseUrl, force: true })
      try {
        await expect(createProduct({ code: 'BAD CODE', name: 'x' })).rejects.toMatchObject({ code: 'INVALID_CODE' })
        await expect(createProduct({ code: 'ok-code', name: 'x', billing_cadence: 'weekly' })).rejects.toMatchObject({ code: 'INVALID_CADENCE' })
        await expect(createProduct({ code: 'ok-code-2', name: 'x', base_price_minor: -1 })).rejects.toMatchObject({ code: 'INVALID_PRICE' })
        await expect(createProduct({ code: 'ok-code-3', name: 'x', product_type: 'bogus' })).rejects.toMatchObject({ code: 'INVALID_PRODUCT_TYPE' })
      } finally {
        await closeDb()
      }
    })
  })

  it('publishProduct: draft → active succeeds; deprecates any prior active version of the same code', async () => {
    await withTestDb(async (databaseUrl) => {
      configure({ databaseUrl, force: true })
      try {
        const code = `pub-plan-${randomUUID().slice(0, 8)}`
        const v1 = await createProduct({ code, name: 'v1', version: 1 })
        await publishProduct(v1.id)

        const [after] = await query(
          `SELECT status FROM commercial.billing_products WHERE id = $1`,
          [v1.id],
        )
        expect(after.status).toBe('active')

        const v2 = await createProduct({ code, name: 'v2', version: 2 })
        await publishProduct(v2.id)

        const [v1Now] = await query(
          `SELECT status, deprecated_at FROM commercial.billing_products WHERE id = $1`,
          [v1.id],
        )
        expect(v1Now.status).toBe('deprecated')
        expect(v1Now.deprecated_at).not.toBeNull()

        const [v2Now] = await query(
          `SELECT status, published_at FROM commercial.billing_products WHERE id = $1`,
          [v2.id],
        )
        expect(v2Now.status).toBe('active')
        expect(v2Now.published_at).not.toBeNull()
      } finally {
        await closeDb()
      }
    })
  })

  it('publishProduct: rejects non-draft product', async () => {
    await withTestDb(async (databaseUrl) => {
      configure({ databaseUrl, force: true })
      try {
        const p = await createProduct({ code: `once-${randomUUID().slice(0, 8)}`, name: 'p', version: 1 })
        await publishProduct(p.id)
        await expect(publishProduct(p.id)).rejects.toMatchObject({ code: 'INVALID_TRANSITION' })
      } finally {
        await closeDb()
      }
    })
  })

  it('updateProduct: draft accepts any field; active rejects pricing / cadence / code / version / type / entitlements', async () => {
    await withTestDb(async (databaseUrl) => {
      configure({ databaseUrl, force: true })
      try {
        const p = await createProduct({ code: `edit-${randomUUID().slice(0, 8)}`, name: 'p', version: 1, base_price_minor: 100 })
        // Draft — free to edit.
        const edited = await updateProduct(p.id, { base_price_minor: 200, name: 'renamed' })
        expect(edited.base_price_minor).toBe(200)
        expect(edited.name).toBe('renamed')

        await publishProduct(p.id)

        // Active — pricing / cadence / code / version / type / entitlements locked.
        await expect(updateProduct(p.id, { base_price_minor: 300 })).rejects.toMatchObject({ code: 'PRODUCT_LOCKED' })
        await expect(updateProduct(p.id, { billing_cadence: 'annual' })).rejects.toMatchObject({ code: 'PRODUCT_LOCKED' })
        await expect(updateProduct(p.id, { entitlements: ['x'] })).rejects.toMatchObject({ code: 'PRODUCT_LOCKED' })
        // Name + description + is_public still editable on active products.
        const patched = await updateProduct(p.id, { name: 'new display name', is_public: false })
        expect(patched.name).toBe('new display name')
        expect(patched.is_public).toBe(false)
      } finally {
        await closeDb()
      }
    })
  })

  it('lifecycle full path: draft → active → deprecated → retired (only when no live subs)', async () => {
    await withTestDb(async (databaseUrl) => {
      configure({ databaseUrl, force: true })
      try {
        const p = await createProduct({ code: `full-${randomUUID().slice(0, 8)}`, name: 'p', version: 1 })
        await publishProduct(p.id)
        await deprecateProduct(p.id)
        const retired = await retireProduct(p.id)
        expect(retired.status).toBe('retired')
      } finally {
        await closeDb()
      }
    })
  })

  it('retireProduct: blocks when live subscriptions still bound', async () => {
    await withTestDb(async (databaseUrl) => {
      configure({ databaseUrl, force: true })
      try {
        const p = await createProduct({ code: `busy-${randomUUID().slice(0, 8)}`, name: 'p', version: 1 })
        await publishProduct(p.id)
        await deprecateProduct(p.id)
        await insertMinimalSubscription(p.id)
        await expect(retireProduct(p.id)).rejects.toMatchObject({ code: 'RETIRE_HAS_ACTIVE_SUBS' })
      } finally {
        await closeDb()
      }
    })
  })

  it('cloneAsNewVersion: creates a draft with version = max+1, carrying entitlements/bundle_items', async () => {
    await withTestDb(async (databaseUrl) => {
      configure({ databaseUrl, force: true })
      try {
        const code = `clone-${randomUUID().slice(0, 8)}`
        const v1 = await createProduct({
          code, name: 'v1', version: 1, base_price_minor: 100,
          entitlements: [{ key: 'ai_staging', type: 'feature' }],
          bundle_items: [],
        })
        await publishProduct(v1.id)
        const v2 = await cloneAsNewVersion(v1.id)
        expect(v2.version).toBe(2)
        expect(v2.status).toBe('draft')
        expect(v2.base_price_minor).toBe(100)
        expect(v2.entitlements).toEqual([{ key: 'ai_staging', type: 'feature' }])
      } finally {
        await closeDb()
      }
    })
  })
})
