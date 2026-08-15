/**
 * Product-tier service — commercial.billing_product_tiers.
 *
 * Tiers are variants of a specific (product, product_version). Basic / Pro /
 * Enterprise-style breakdowns. Each tier carries its own quotas + features
 * + price. When present, tier.price_minor overrides the product's base price
 * for subscriptions bound to that tier.
 *
 * Lifecycle mirrors products: draft → active → deprecated → retired.
 * Tier codes are unique within (product, version).
 */

import { randomUUID } from 'crypto'
import { findAll, findOne, insert, update, query } from '../../db.js'

const COLLECTION = 'billing_product_tiers'

function normalizeCode(code) {
  const v = String(code || '').trim().toLowerCase()
  if (!/^[a-z0-9][a-z0-9._-]{0,79}$/.test(v)) {
    throw Object.assign(new Error('tier code must be kebab/snake case, 1..80 chars starting with alphanumeric'), { code: 'INVALID_CODE' })
  }
  return v
}

export async function listTiers({ productId, productVersion, includeAllStatuses = false } = {}) {
  return findAll(COLLECTION, (t) => {
    if (productId && t.product_id !== productId) return false
    if (productVersion != null && Number(t.product_version) !== Number(productVersion)) return false
    if (!includeAllStatuses && (t.status === 'retired' || t.status === 'deprecated')) return false
    return true
  })
}

export async function getTier(id) {
  return findOne(COLLECTION, (t) => t.id === id)
}

export async function findTierByCode(productId, productVersion, code) {
  const c = normalizeCode(code)
  return findOne(COLLECTION, (t) =>
    t.product_id === productId &&
    Number(t.product_version) === Number(productVersion) &&
    t.code === c,
  )
}

export async function createTier(input) {
  if (!input?.product_id) throw Object.assign(new Error('product_id is required'), { code: 'MISSING_FIELD' })
  if (input.product_version == null) throw Object.assign(new Error('product_version is required'), { code: 'MISSING_FIELD' })
  if (!input.name?.trim()) throw Object.assign(new Error('name is required'), { code: 'MISSING_FIELD' })

  const code = normalizeCode(input.code)
  const productVersion = Number(input.product_version)
  const priceMinor = input.price_minor != null ? Number(input.price_minor) : null
  if (priceMinor != null && (!Number.isFinite(priceMinor) || priceMinor < 0)) {
    throw Object.assign(new Error('price_minor must be non-negative when set'), { code: 'INVALID_PRICE' })
  }

  const dup = await findTierByCode(input.product_id, productVersion, code)
  if (dup) {
    throw Object.assign(new Error(`Tier code "${code}" already exists for this product version`), { code: 'DUPLICATE_CODE' })
  }

  const now = new Date().toISOString()
  const row = {
    id: randomUUID(),
    product_id: input.product_id,
    product_version: productVersion,
    code,
    name: String(input.name).trim(),
    description: input.description || null,
    sort_order: Number(input.sort_order || 0),
    price_minor: priceMinor != null ? Math.round(priceMinor) : null,
    currency: input.currency ? String(input.currency).toUpperCase() : null,
    quotas: normalizeQuotas(input.quotas),
    features: Array.isArray(input.features) ? input.features : [],
    is_public: input.is_public !== false,
    status: 'draft',
    metadata: input.metadata && typeof input.metadata === 'object' ? input.metadata : {},
    created_at: now,
    updated_at: now,
  }
  await insert(COLLECTION, row)
  return row
}

function normalizeQuotas(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {}
  const clean = {}
  for (const [key, value] of Object.entries(raw)) {
    const n = Number(value)
    if (!Number.isFinite(n) || n < 0) {
      throw Object.assign(new Error(`quota "${key}" must be a non-negative number`), { code: 'INVALID_QUOTA' })
    }
    clean[String(key)] = Math.round(n)
  }
  return clean
}

export async function updateTier(id, patch = {}) {
  const existing = await getTier(id)
  if (!existing) throw Object.assign(new Error('Tier not found'), { code: 'NOT_FOUND' })
  if (existing.status === 'retired') {
    throw Object.assign(new Error('Cannot edit a retired tier'), { code: 'TIER_RETIRED' })
  }

  // Only draft tiers can have price / quotas / features edited in place.
  // Once active, admin must clone the parent product to a new version.
  if (existing.status !== 'draft') {
    const forbidden = ['code', 'product_id', 'product_version', 'price_minor', 'currency', 'quotas', 'features']
    for (const key of forbidden) {
      if (key in patch) {
        throw Object.assign(
          new Error(`Cannot edit ${key} on a ${existing.status} tier — clone the parent product to a new version`),
          { code: 'TIER_LOCKED' },
        )
      }
    }
  }

  const clean = {}
  if ('name' in patch) clean.name = String(patch.name).trim()
  if ('description' in patch) clean.description = patch.description ?? null
  if ('sort_order' in patch) clean.sort_order = Number(patch.sort_order || 0)
  if ('price_minor' in patch) {
    if (patch.price_minor == null) clean.price_minor = null
    else {
      const n = Number(patch.price_minor)
      if (!Number.isFinite(n) || n < 0) throw Object.assign(new Error('invalid price_minor'), { code: 'INVALID_PRICE' })
      clean.price_minor = Math.round(n)
    }
  }
  if ('currency' in patch) clean.currency = patch.currency ? String(patch.currency).toUpperCase() : null
  if ('quotas' in patch) clean.quotas = normalizeQuotas(patch.quotas)
  if ('features' in patch) clean.features = Array.isArray(patch.features) ? patch.features : []
  if ('is_public' in patch) clean.is_public = Boolean(patch.is_public)
  if ('metadata' in patch) clean.metadata = patch.metadata && typeof patch.metadata === 'object' ? patch.metadata : {}

  await update(COLLECTION, (t) => t.id === id, (t) => ({ ...t, ...clean }))
  return await getTier(id)
}

export async function activateTier(id) {
  const existing = await getTier(id)
  if (!existing) throw Object.assign(new Error('Tier not found'), { code: 'NOT_FOUND' })
  if (existing.status !== 'draft') {
    throw Object.assign(new Error(`Only draft tiers may be activated (current: ${existing.status})`), { code: 'INVALID_TRANSITION' })
  }
  await update(COLLECTION, (t) => t.id === id, (t) => ({ ...t, status: 'active' }))
  return await getTier(id)
}

export async function deprecateTier(id) {
  const existing = await getTier(id)
  if (!existing) throw Object.assign(new Error('Tier not found'), { code: 'NOT_FOUND' })
  if (existing.status !== 'active') {
    throw Object.assign(new Error(`Only active tiers may be deprecated (current: ${existing.status})`), { code: 'INVALID_TRANSITION' })
  }
  await update(COLLECTION, (t) => t.id === id, (t) => ({ ...t, status: 'deprecated' }))
  return await getTier(id)
}

export async function retireTier(id) {
  const existing = await getTier(id)
  if (!existing) throw Object.assign(new Error('Tier not found'), { code: 'NOT_FOUND' })
  if (existing.status !== 'deprecated') {
    throw Object.assign(new Error(`Only deprecated tiers may be retired (current: ${existing.status})`), { code: 'INVALID_TRANSITION' })
  }
  const subs = await query(
    `SELECT COUNT(*)::int AS n
       FROM commercial.billing_subscriptions
      WHERE tier_id = $1
        AND status IN ('trialing','active','past_due','paused')`,
    [id],
  )
  if (subs?.[0]?.n > 0) {
    throw Object.assign(
      new Error(`Cannot retire — ${subs[0].n} live subscription(s) still bound to this tier. Migrate them first.`),
      { code: 'RETIRE_HAS_ACTIVE_SUBS' },
    )
  }
  await update(COLLECTION, (t) => t.id === id, (t) => ({ ...t, status: 'retired' }))
  return await getTier(id)
}
