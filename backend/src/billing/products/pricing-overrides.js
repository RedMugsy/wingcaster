/**
 * Per-territory pricing overrides — commercial.billing_product_territory_pricing.
 *
 * Resolution rules (most-specific wins):
 *   1. (product, version, tier, territory)   — tier-specific price in a country
 *   2. (product, version, NULL, territory)   — product-wide price in a country
 *   3. tier.price_minor                      — tier's base price
 *   4. product.base_price_minor              — product's base price
 *
 * Only "active" overrides count. Set active=false to soft-delete.
 */

import { randomUUID } from 'crypto'
import { findAll, findOne, insert, update } from '../../db.js'

const COLLECTION = 'billing_product_territory_pricing'

export async function listOverrides({ productId, productVersion, tierId, territoryId } = {}) {
  return findAll(COLLECTION, (o) => {
    if (productId && o.product_id !== productId) return false
    if (productVersion != null && Number(o.product_version) !== Number(productVersion)) return false
    if (tierId !== undefined && (o.tier_id || null) !== (tierId || null)) return false
    if (territoryId && o.territory_id !== territoryId) return false
    return true
  })
}

export async function getOverride(id) {
  return findOne(COLLECTION, (o) => o.id === id)
}

export async function createOverride(input) {
  const { product_id, product_version, tier_id, territory_id } = input
  if (!product_id) throw Object.assign(new Error('product_id is required'), { code: 'MISSING_FIELD' })
  if (product_version == null) throw Object.assign(new Error('product_version is required'), { code: 'MISSING_FIELD' })
  if (!territory_id) throw Object.assign(new Error('territory_id is required'), { code: 'MISSING_FIELD' })

  const priceMinor = Number(input.price_minor)
  if (!Number.isFinite(priceMinor) || priceMinor < 0) {
    throw Object.assign(new Error('price_minor must be non-negative'), { code: 'INVALID_PRICE' })
  }
  const currency = String(input.currency || 'USD').toUpperCase()
  if (!/^[A-Z]{3}$/.test(currency)) {
    throw Object.assign(new Error('currency must be a 3-letter uppercase code'), { code: 'INVALID_CURRENCY' })
  }

  const dup = await findOne(COLLECTION, (o) =>
    o.product_id === product_id &&
    Number(o.product_version) === Number(product_version) &&
    (o.tier_id || null) === (tier_id || null) &&
    o.territory_id === territory_id,
  )
  if (dup) {
    throw Object.assign(
      new Error('An override already exists for this (product, version, tier, territory) combination'),
      { code: 'DUPLICATE_OVERRIDE' },
    )
  }

  const now = new Date().toISOString()
  const row = {
    id: randomUUID(),
    product_id,
    product_version: Number(product_version),
    tier_id: tier_id || null,
    territory_id,
    price_minor: Math.round(priceMinor),
    currency,
    active: input.active !== false,
    metadata: input.metadata && typeof input.metadata === 'object' ? input.metadata : {},
    created_at: now,
    updated_at: now,
  }
  await insert(COLLECTION, row)
  return row
}

export async function updateOverride(id, patch = {}) {
  const existing = await getOverride(id)
  if (!existing) throw Object.assign(new Error('Override not found'), { code: 'NOT_FOUND' })

  const clean = {}
  if ('price_minor' in patch) {
    const n = Number(patch.price_minor)
    if (!Number.isFinite(n) || n < 0) throw Object.assign(new Error('invalid price_minor'), { code: 'INVALID_PRICE' })
    clean.price_minor = Math.round(n)
  }
  if ('currency' in patch) {
    const c = String(patch.currency).toUpperCase()
    if (!/^[A-Z]{3}$/.test(c)) throw Object.assign(new Error('invalid currency'), { code: 'INVALID_CURRENCY' })
    clean.currency = c
  }
  if ('active' in patch) clean.active = Boolean(patch.active)
  if ('metadata' in patch) clean.metadata = patch.metadata && typeof patch.metadata === 'object' ? patch.metadata : {}

  await update(COLLECTION, (o) => o.id === id, (o) => ({ ...o, ...clean }))
  return await getOverride(id)
}

export async function deactivateOverride(id) {
  return updateOverride(id, { active: false })
}

/**
 * Resolve the effective price for a (product, version, tier, territory).
 * Falls back through the resolution order above. Returns { priceMinor,
 * currency, source: 'override_tier_territory' | 'override_product_territory'
 * | 'tier_base' | 'product_base' | null }.
 *
 * The tier + product are passed in (not looked up) so callers that already
 * have them don't pay for extra DAL round trips.
 */
export async function resolveEffectivePrice({ product, tier, territoryId }) {
  if (!product) return { priceMinor: null, currency: null, source: null }

  if (territoryId) {
    if (tier) {
      const tierOverride = await findOne(COLLECTION, (o) =>
        o.active !== false &&
        o.product_id === product.id &&
        Number(o.product_version) === Number(product.version) &&
        o.tier_id === tier.id &&
        o.territory_id === territoryId,
      )
      if (tierOverride) {
        return {
          priceMinor: Number(tierOverride.price_minor),
          currency: tierOverride.currency,
          source: 'override_tier_territory',
        }
      }
    }
    const productOverride = await findOne(COLLECTION, (o) =>
      o.active !== false &&
      o.product_id === product.id &&
      Number(o.product_version) === Number(product.version) &&
      !o.tier_id &&
      o.territory_id === territoryId,
    )
    if (productOverride) {
      return {
        priceMinor: Number(productOverride.price_minor),
        currency: productOverride.currency,
        source: 'override_product_territory',
      }
    }
  }

  if (tier && tier.price_minor != null) {
    return {
      priceMinor: Number(tier.price_minor),
      currency: tier.currency || product.currency,
      source: 'tier_base',
    }
  }

  return {
    priceMinor: Number(product.base_price_minor) || 0,
    currency: product.currency,
    source: 'product_base',
  }
}
