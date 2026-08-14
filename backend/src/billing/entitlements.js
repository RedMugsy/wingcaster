/**
 * Entitlement evaluator — the three-type primitive from spec §4.
 *
 * Every gateable or chargeable thing is exactly one of:
 *   - feature  (boolean)
 *   - quota    (integer allowance per period)
 *   - metered  (rate per unit, may be zero — always emit)
 *
 * Do not add a fourth type.
 *
 * In Phase 7a there are no subscriptions yet, so every evaluator returns
 * a permissive default (rate 0 everywhere, features enabled, quotas
 * effectively unlimited). Subscriptions land in Phase 7c and start
 * gating real access.
 */

import { findOne } from '../db.js'

export const ENTITLEMENT_TYPES = ['feature', 'quota', 'metered']

// Registry of known entitlement keys — expanded per phase. Used for admin
// validation and pricing-page rendering; not authoritative for gating.
export const KNOWN_FEATURES = [
  'white_label',
  'routing_rules_editor',
  'api_access',
  'sso',
  'x_channel',
  'custom_domain',
  'ai_lead_summary',
  'command_center',
  'bannerbear_templates',
  'portal_syndication',
]

export const KNOWN_QUOTAS = [
  'active_listings',
  'outbound_whatsapp',
  'seats',
  'social_channels',
  'email_sends',
  'property_scores',
  'ai_descriptions',
  'ai_reply_drafts',
  'template_renders_premium',
]

/**
 * Resolve the tenant's active subscription. In Phase 7a returns null for
 * everyone (no subscriptions exist yet). Returns { subscription, product }
 * once 7c lands.
 */
export async function resolveActiveSubscription(tenantId) {
  const sub = await findOne(
    'subscriptions',
    (s) => s.tenant_id === tenantId && (s.status === 'active' || s.status === 'trialing'),
  ).catch(() => null)
  if (!sub) return null
  const product = await findOne('products', (p) => p.id === sub.product_id).catch(() => null)
  return { subscription: sub, product }
}

/**
 * Feature check. Returns true if the feature is enabled for the tenant.
 * Phase 7a default: everything is enabled (no gating yet).
 */
export async function hasFeature(tenantId, featureKey) {
  const active = await resolveActiveSubscription(tenantId)
  if (!active) return true // 7a: unrestricted while there are no subscriptions
  const ent = (active.product?.entitlements || []).find((e) => e.key === featureKey && e.type === 'feature')
  return ent ? Boolean(ent.value) : false
}

/**
 * Quota remaining check. Returns { limit, used, remaining, has_headroom }.
 * Phase 7a default: infinite headroom, zero used.
 */
export async function quotaState(tenantId, quotaKey) {
  const active = await resolveActiveSubscription(tenantId)
  if (!active) return { limit: Infinity, used: 0, remaining: Infinity, has_headroom: true }
  const ent = (active.product?.entitlements || []).find((e) => e.key === quotaKey && e.type === 'quota')
  const limit = ent?.value != null ? Number(ent.value) : Infinity
  // Real usage read from the ledger comes in Phase 7c.
  const used = 0
  const remaining = Math.max(0, limit - used)
  return { limit, used, remaining, has_headroom: remaining > 0 || limit === Infinity }
}

/**
 * Effective per-unit charge for a metered action, if the tenant is on a
 * plan that overrides the rate card. Returns null when the standard rate
 * card should apply (i.e. no override).
 */
export async function meteredRateOverride(tenantId, actionKey) {
  const active = await resolveActiveSubscription(tenantId)
  if (!active) return null
  const ent = (active.product?.entitlements || []).find((e) => e.key === actionKey && e.type === 'metered')
  return ent?.value != null ? Number(ent.value) : null
}
