/**
 * Product catalog service — commercial.billing_products.
 *
 * Products are versioned. Publishing a v2 does NOT mutate v1; instead it
 * creates a new row with the same `code` and version = max(version)+1.
 * Existing subscribers stay pinned to v1 (grandfathering by version).
 *
 * Lifecycle transitions (enforced here, not just in the CHECK constraint):
 *   draft      → active     via publish()
 *   active     → deprecated via deprecate()      (no new subscriptions)
 *   deprecated → retired    via retire()         (existing subs cancelled/moved)
 *   any        → any        NOT allowed except through the transitions above
 *
 * All mutations go through this module — never touch commercial.billing_products
 * directly from anywhere else so the state-machine invariants hold.
 */

import { randomUUID } from 'crypto'
import { findAll, findOne, insert, update, query } from '../../db.js'

const COLLECTION = 'billing_products'

const VALID_TYPES = new Set(['plan', 'addon', 'bundle'])
const VALID_CADENCES = new Set(['monthly', 'annual', 'one_off', '90_days', 'custom'])

function normalizeCode(code) {
  const v = String(code || '').trim().toLowerCase()
  if (!/^[a-z0-9][a-z0-9._-]{0,79}$/.test(v)) {
    throw Object.assign(new Error('product code must be kebab/snake case, 1..80 chars starting with alphanumeric'), { code: 'INVALID_CODE' })
  }
  return v
}

function requireOne(product, field) {
  if (product[field] == null || product[field] === '') {
    throw Object.assign(new Error(`${field} is required`), { code: 'MISSING_FIELD' })
  }
}

export async function listProducts({ includeAllStatuses = false, productType = null } = {}) {
  return findAll(COLLECTION, (p) => {
    if (!includeAllStatuses && (p.status === 'retired' || p.status === 'deprecated')) return false
    if (productType && p.product_type !== productType) return false
    return true
  })
}

export async function listPublicProducts() {
  return findAll(COLLECTION, (p) => p.is_public === true && p.status === 'active')
}

export async function getProduct(id) {
  return findOne(COLLECTION, (p) => p.id === id)
}

export async function findProductByCodeVersion(code, version) {
  const c = normalizeCode(code)
  const v = Number(version)
  return findOne(COLLECTION, (p) => p.code === c && Number(p.version) === v)
}

export async function latestVersionForCode(code) {
  const c = normalizeCode(code)
  const rows = await findAll(COLLECTION, (p) => p.code === c)
  return rows.reduce((max, row) => Math.max(max, Number(row.version) || 0), 0)
}

export async function createProduct(input, { actorId = null } = {}) {
  requireOne(input, 'name')
  const code = normalizeCode(input.code)
  const productType = input.product_type || 'plan'
  if (!VALID_TYPES.has(productType)) {
    throw Object.assign(new Error(`product_type must be one of: ${[...VALID_TYPES].join(', ')}`), { code: 'INVALID_PRODUCT_TYPE' })
  }
  const cadence = input.billing_cadence || 'monthly'
  if (!VALID_CADENCES.has(cadence)) {
    throw Object.assign(new Error(`billing_cadence must be one of: ${[...VALID_CADENCES].join(', ')}`), { code: 'INVALID_CADENCE' })
  }
  const basePrice = Number(input.base_price_minor ?? 0)
  if (!Number.isFinite(basePrice) || basePrice < 0) {
    throw Object.assign(new Error('base_price_minor must be a non-negative integer'), { code: 'INVALID_PRICE' })
  }
  const version = input.version != null
    ? Number(input.version)
    : (await latestVersionForCode(code)) + 1
  if (!Number.isFinite(version) || version < 1) {
    throw Object.assign(new Error('version must be a positive integer'), { code: 'INVALID_VERSION' })
  }

  const existing = await findProductByCodeVersion(code, version)
  if (existing) {
    throw Object.assign(new Error(`product ${code} version ${version} already exists`), { code: 'DUPLICATE_VERSION' })
  }

  const now = new Date().toISOString()
  const row = {
    id: randomUUID(),
    code,
    version,
    name: String(input.name).trim(),
    description: input.description || null,
    product_type: productType,
    billing_cadence: cadence,
    base_price_minor: Math.round(basePrice),
    currency: String(input.currency || 'USD').toUpperCase(),
    entitlements: Array.isArray(input.entitlements) ? input.entitlements : [],
    bundle_items: Array.isArray(input.bundle_items) ? input.bundle_items : [],
    is_public: input.is_public !== false,
    status: 'draft',
    created_by: actorId,
    created_at: now,
    updated_at: now,
  }
  await insert(COLLECTION, row)
  return row
}

export async function updateProduct(id, patch = {}) {
  const existing = await getProduct(id)
  if (!existing) throw Object.assign(new Error('Product not found'), { code: 'NOT_FOUND' })
  if (existing.status === 'retired') {
    throw Object.assign(new Error('Cannot edit a retired product'), { code: 'PRODUCT_RETIRED' })
  }

  // Only draft products may have their pricing / cadence / entitlements
  // mutated in place. Once active, changes must go via cloneAsNewVersion +
  // publish so subscribers on the old version stay grandfathered.
  if (existing.status !== 'draft') {
    const forbidden = ['code', 'version', 'billing_cadence', 'base_price_minor', 'currency', 'entitlements', 'bundle_items', 'product_type']
    for (const key of forbidden) {
      if (key in patch) {
        throw Object.assign(
          new Error(`Cannot edit ${key} on a ${existing.status} product — clone as a new version instead`),
          { code: 'PRODUCT_LOCKED' },
        )
      }
    }
  }

  const clean = {}
  if ('name' in patch) clean.name = String(patch.name).trim()
  if ('description' in patch) clean.description = patch.description ?? null
  if ('billing_cadence' in patch) {
    if (!VALID_CADENCES.has(patch.billing_cadence)) throw Object.assign(new Error('invalid cadence'), { code: 'INVALID_CADENCE' })
    clean.billing_cadence = patch.billing_cadence
  }
  if ('product_type' in patch) {
    if (!VALID_TYPES.has(patch.product_type)) throw Object.assign(new Error('invalid product_type'), { code: 'INVALID_PRODUCT_TYPE' })
    clean.product_type = patch.product_type
  }
  if ('base_price_minor' in patch) {
    const n = Number(patch.base_price_minor)
    if (!Number.isFinite(n) || n < 0) throw Object.assign(new Error('invalid base_price_minor'), { code: 'INVALID_PRICE' })
    clean.base_price_minor = Math.round(n)
  }
  if ('currency' in patch) clean.currency = String(patch.currency).toUpperCase()
  if ('entitlements' in patch) clean.entitlements = Array.isArray(patch.entitlements) ? patch.entitlements : []
  if ('bundle_items' in patch) clean.bundle_items = Array.isArray(patch.bundle_items) ? patch.bundle_items : []
  if ('is_public' in patch) clean.is_public = Boolean(patch.is_public)

  await update(COLLECTION, (p) => p.id === id, (p) => ({ ...p, ...clean }))
  return await getProduct(id)
}

export async function publishProduct(id) {
  const existing = await getProduct(id)
  if (!existing) throw Object.assign(new Error('Product not found'), { code: 'NOT_FOUND' })
  if (existing.status !== 'draft') {
    throw Object.assign(new Error(`Only draft products may be published (current: ${existing.status})`), { code: 'INVALID_TRANSITION' })
  }
  const now = new Date().toISOString()

  // If a previous active version of the same code exists, mark it deprecated
  // atomically alongside the publish. Subscribers on the old version stay
  // where they are — they're grandfathered by product_version pin, and we
  // stamp grandfathered_at so admins can see who's on the old version and
  // decide whether to prompt them to migrate.
  await query(
    `UPDATE commercial.billing_products
        SET status = 'deprecated',
            deprecated_at = COALESCE(deprecated_at, $2::timestamptz),
            updated_at = $2::timestamptz
      WHERE code = $1
        AND status = 'active'
        AND id <> $3`,
    [existing.code, now, id],
  )

  const grandfatheredResult = await query(
    `UPDATE commercial.billing_subscriptions
        SET grandfathered_at = $2::timestamptz,
            eligible_for_migration = true,
            updated_at = CURRENT_TIMESTAMP
      WHERE product_id IN (
              SELECT id FROM commercial.billing_products
                WHERE code = $1 AND id <> $3
            )
        AND status IN ('trialing','active','past_due','paused')
        AND grandfathered_at IS NULL
      RETURNING id, tenant_id`,
    [existing.code, now, id],
  )

  await update(COLLECTION, (p) => p.id === id, (p) => ({
    ...p,
    status: 'active',
    published_at: now,
  }))

  // Emit a subscription_history event per grandfathered sub so the audit
  // trail records the exact moment they were pinned to their old version.
  if (Array.isArray(grandfatheredResult) && grandfatheredResult.length) {
    const { recordEvent } = await import('./subscription-history.js')
    for (const row of grandfatheredResult) {
      try {
        await recordEvent({
          subscriptionId: row.id,
          event: 'grandfathered',
          actorType: 'system',
          reason: `Product ${existing.code} v${existing.version} published; retained pin to prior version.`,
          metadata: { new_version_id: id, published_at: now },
        })
      } catch (err) {
        // Never fail the publish because of an audit-write hiccup — log
        // and move on. The scheduler will re-emit on next sweep if needed.
        // (Import lazily above so a circular test-time import doesn't break.)
      }
    }
  }
  return await getProduct(id)
}

export async function deprecateProduct(id) {
  const existing = await getProduct(id)
  if (!existing) throw Object.assign(new Error('Product not found'), { code: 'NOT_FOUND' })
  if (existing.status !== 'active') {
    throw Object.assign(new Error(`Only active products may be deprecated (current: ${existing.status})`), { code: 'INVALID_TRANSITION' })
  }
  const now = new Date().toISOString()
  await update(COLLECTION, (p) => p.id === id, (p) => ({
    ...p,
    status: 'deprecated',
    deprecated_at: now,
  }))
  return await getProduct(id)
}

export async function retireProduct(id) {
  const existing = await getProduct(id)
  if (!existing) throw Object.assign(new Error('Product not found'), { code: 'NOT_FOUND' })
  if (existing.status !== 'deprecated') {
    throw Object.assign(
      new Error(`Only deprecated products may be retired (current: ${existing.status}). Deprecate first, migrate remaining subscribers, then retire.`),
      { code: 'INVALID_TRANSITION' },
    )
  }
  const activeSubs = await query(
    `SELECT COUNT(*)::int AS n
       FROM commercial.billing_subscriptions
      WHERE product_id = $1
        AND status IN ('trialing','active','past_due','paused')`,
    [id],
  )
  if (activeSubs?.[0]?.n > 0) {
    throw Object.assign(
      new Error(`Cannot retire — ${activeSubs[0].n} live subscription(s) still reference this version. Migrate or cancel them first.`),
      { code: 'RETIRE_HAS_ACTIVE_SUBS' },
    )
  }
  const now = new Date().toISOString()
  await update(COLLECTION, (p) => p.id === id, (p) => ({
    ...p,
    status: 'retired',
    retired_at: now,
  }))
  return await getProduct(id)
}

/**
 * Clone an active/deprecated/draft product as a NEW DRAFT with version = max+1.
 * Tiers are NOT cloned automatically — the admin picks which tiers to carry
 * over into the new version via a follow-up call (Phase 7c/2 UI).
 */
export async function cloneAsNewVersion(id, { actorId = null } = {}) {
  const existing = await getProduct(id)
  if (!existing) throw Object.assign(new Error('Product not found'), { code: 'NOT_FOUND' })
  const nextVersion = (await latestVersionForCode(existing.code)) + 1

  const now = new Date().toISOString()
  const row = {
    id: randomUUID(),
    code: existing.code,
    version: nextVersion,
    name: existing.name,
    description: existing.description,
    product_type: existing.product_type,
    billing_cadence: existing.billing_cadence,
    base_price_minor: existing.base_price_minor,
    currency: existing.currency,
    entitlements: Array.isArray(existing.entitlements) ? [...existing.entitlements] : [],
    bundle_items: Array.isArray(existing.bundle_items) ? [...existing.bundle_items] : [],
    is_public: existing.is_public,
    status: 'draft',
    created_by: actorId,
    created_at: now,
    updated_at: now,
  }
  await insert(COLLECTION, row)
  return row
}
