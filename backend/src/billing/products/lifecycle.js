/**
 * Subscription lifecycle engine — the state machine for
 * commercial.billing_subscriptions.
 *
 * State model:
 *
 *                                       ┌─────────────────┐
 *                                       │  createSub      │
 *                                       │  (trial_days>0) │
 *                                       ├────► trialing ──┤
 *   createSub (no trial) ───► active ◄──┘                 │
 *                              ▲│    ▲                    │
 *                              ││    │                    │
 *              renewScanner ───┘│    │   trialExpiryScan  │
 *              (period rollover)│    └────────────────────┘
 *                               │
 *                     resume ───┼──► pauseSub ──► paused
 *                               │
 *                               ├──► markPastDue ──► past_due
 *                               │    (7e will auto-fire on failed renewal
 *                               │     payment; pre-7e admin-only)
 *                               │
 *                               ├──► resolvePastDue ──► active
 *                               │
 *                               ├──► cancelImmediately ──► cancelled
 *                               │
 *                               └──► cancelAtPeriodEnd (flag on active row)
 *                                    scanner flips to ──► expired at period end
 *
 * Every mutation writes a row to billing_subscription_history via
 * subscription-history.js. Period-boundary allowance grants are written
 * to commercial.ledger_entries via billing/ledger.js#grantAllowance.
 *
 * Never mutate commercial.billing_subscriptions directly from outside
 * this module — the state-machine invariants + audit trail + allowance
 * grants must stay in lock-step.
 */

import { randomUUID } from 'crypto'
import { findOne, insert, transaction, query } from '../../db.js'
import { grantAllowance, currentBillingPeriod } from '../ledger.js'
import { getProduct } from './products.js'
import { getTier } from './tiers.js'
import { recordEvent } from './subscription-history.js'

const SUBSCRIPTIONS = 'billing_subscriptions'

/* ------------------------------------------------------------------ */
/* Cadence / period math                                              */
/* ------------------------------------------------------------------ */

const CADENCE_DAYS = {
  monthly: 30,
  '90_days': 90,
  annual: 365,
}

/**
 * Compute the period end for a subscription starting at `startAt`,
 * cadence `cadence`, and optional trial length `trialDays`.
 *
 * trialDays > 0 → period end IS the trial end.
 * cadence 'one_off' → no scheduled end (returns null).
 * cadence 'custom' → uses metadata.custom_period_days.
 */
export function computePeriodEnd(startAt, cadence, { trialDays = 0, customPeriodDays = null } = {}) {
  if (trialDays > 0) {
    return addDays(startAt, trialDays)
  }
  if (cadence === 'one_off') return null
  if (cadence === 'custom') {
    if (!customPeriodDays || customPeriodDays <= 0) {
      throw Object.assign(new Error('cadence=custom requires custom_period_days > 0 in metadata'), { code: 'INVALID_CADENCE_CONFIG' })
    }
    return addDays(startAt, customPeriodDays)
  }
  if (cadence === 'monthly') return addMonths(startAt, 1)
  if (cadence === 'annual') return addMonths(startAt, 12)
  const days = CADENCE_DAYS[cadence]
  if (days) return addDays(startAt, days)
  throw Object.assign(new Error(`Unknown billing_cadence: ${cadence}`), { code: 'INVALID_CADENCE' })
}

/**
 * Compute the ledger billing_period key for a subscription cadence.
 *   monthly → YYYY-MM
 *   annual  → YYYY
 *   90_days / custom / one_off → YYYY-MM-DD (period start date)
 */
export function computeLedgerBillingPeriod(startAt, cadence) {
  const d = new Date(startAt)
  const y = d.getUTCFullYear()
  const m = String(d.getUTCMonth() + 1).padStart(2, '0')
  const day = String(d.getUTCDate()).padStart(2, '0')
  if (cadence === 'monthly') return `${y}-${m}`
  if (cadence === 'annual') return String(y)
  return `${y}-${m}-${day}`
}

function addDays(at, days) {
  const d = at instanceof Date ? new Date(at.getTime()) : new Date(at)
  d.setUTCDate(d.getUTCDate() + days)
  return d
}

function addMonths(at, months) {
  const d = at instanceof Date ? new Date(at.getTime()) : new Date(at)
  const targetMonth = d.getUTCMonth() + months
  d.setUTCMonth(targetMonth)
  return d
}

/* ------------------------------------------------------------------ */
/* Snapshot helpers                                                   */
/* ------------------------------------------------------------------ */

function snapshot(sub) {
  if (!sub) return null
  return {
    status: sub.status,
    tier_id: sub.tier_id,
    product_id: sub.product_id,
    product_version: sub.product_version,
    billing_period_start: sub.billing_period_start,
    billing_period_end: sub.billing_period_end,
    trial_ends_at: sub.trial_ends_at,
    cancelled_at: sub.cancelled_at,
    grandfathered_at: sub.grandfathered_at,
    next_renewal_at: sub.next_renewal_at,
    auto_renew: sub.auto_renew,
    cancel_at_period_end: sub.cancel_at_period_end,
    paused_at: sub.metadata?.paused_at || null,
  }
}

async function getSubscription(id) {
  return findOne(SUBSCRIPTIONS, (s) => s.id === id)
}

/* ------------------------------------------------------------------ */
/* Allowance granting                                                 */
/* ------------------------------------------------------------------ */

async function grantTierAllowances({ subscription, tier, note = null }) {
  if (!tier?.quotas) return []
  const period = computeLedgerBillingPeriod(subscription.billing_period_start, subscription.metadata?.cadence || 'monthly')
  const entries = []
  for (const [quotaKey, amount] of Object.entries(tier.quotas)) {
    if (!(Number(amount) > 0)) continue
    const entry = await grantAllowance({
      tenantId: subscription.tenant_id,
      subscriptionId: subscription.id,
      billingPeriod: period,
      quotaKey,
      amount,
    })
    entries.push({ quotaKey, amount, entryId: entry?.id || null, note })
  }
  return entries
}

/* ------------------------------------------------------------------ */
/* State-machine actions                                              */
/* ------------------------------------------------------------------ */

/**
 * Create a subscription for a tenant on a specific (product, tier).
 *
 * @param {object} input
 * @param {string} input.tenantId
 * @param {string} input.productId
 * @param {string} input.tierId
 * @param {string} [input.territoryId]
 * @param {string} [input.zoneId]
 * @param {number} [input.trialDays=0]
 * @param {boolean} [input.autoRenew=true]
 * @param {number} [input.customPeriodDays] required when cadence='custom'
 * @param {object} [input.metadata]
 * @param {string} [input.actorId]
 * @param {'tenant'|'admin'|'system'|'api'} [input.actorType='tenant']
 */
export async function createSubscription(input) {
  const { tenantId, productId, tierId, actorId = null, actorType = 'tenant' } = input
  if (!tenantId) throw Object.assign(new Error('tenantId is required'), { code: 'MISSING_FIELD' })
  if (!productId) throw Object.assign(new Error('productId is required'), { code: 'MISSING_FIELD' })
  if (!tierId) throw Object.assign(new Error('tierId is required'), { code: 'MISSING_FIELD' })

  const product = await getProduct(productId)
  if (!product) throw Object.assign(new Error('Product not found'), { code: 'PRODUCT_NOT_FOUND' })
  if (product.status !== 'active') {
    throw Object.assign(new Error(`Cannot subscribe to a ${product.status} product`), { code: 'PRODUCT_NOT_SUBSCRIBABLE' })
  }
  const tier = await getTier(tierId)
  if (!tier) throw Object.assign(new Error('Tier not found'), { code: 'TIER_NOT_FOUND' })
  if (tier.product_id !== product.id || Number(tier.product_version) !== Number(product.version)) {
    throw Object.assign(new Error('Tier does not belong to this product version'), { code: 'TIER_PRODUCT_MISMATCH' })
  }
  if (tier.status !== 'active') {
    throw Object.assign(new Error(`Cannot subscribe to a ${tier.status} tier`), { code: 'TIER_NOT_SUBSCRIBABLE' })
  }
  if (tier.is_public === false && actorType === 'tenant') {
    throw Object.assign(new Error('This tier is not available for self-serve subscription'), { code: 'TIER_NOT_PUBLIC' })
  }

  // One active "plan" per tenant. Add-ons and bundles can co-exist.
  if (product.product_type === 'plan') {
    const existingPlan = await query(
      `SELECT id, product_id
         FROM commercial.billing_subscriptions
        WHERE tenant_id = $1
          AND status IN ('trialing','active','past_due','paused')
          AND product_id IN (
            SELECT id FROM commercial.billing_products WHERE product_type = 'plan'
          )
        LIMIT 1`,
      [tenantId],
    )
    if (existingPlan.length > 0) {
      throw Object.assign(
        new Error('Tenant already has an active plan subscription. Upgrade or cancel the existing one first.'),
        { code: 'PLAN_ALREADY_SUBSCRIBED' },
      )
    }
  }

  const now = new Date()
  const trialDays = Math.max(0, Number(input.trialDays || 0))
  const autoRenew = input.autoRenew !== false
  const customPeriodDays = input.customPeriodDays ?? input.metadata?.custom_period_days ?? null

  const periodEnd = computePeriodEnd(now, product.billing_cadence, { trialDays, customPeriodDays })
  const isTrial = trialDays > 0

  const created = await transaction(async () => {
    const row = {
      id: randomUUID(),
      tenant_id: tenantId,
      product_id: product.id,
      product_version: product.version,
      tier_id: tier.id,
      territory_id: input.territoryId || null,
      zone_id: input.zoneId || null,
      status: isTrial ? 'trialing' : 'active',
      billing_period_start: now.toISOString(),
      billing_period_end: periodEnd ? periodEnd.toISOString() : null,
      trial_ends_at: isTrial ? periodEnd.toISOString() : null,
      next_renewal_at: (autoRenew && periodEnd) ? periodEnd.toISOString() : null,
      auto_renew: autoRenew,
      cancel_at_period_end: false,
      metadata: {
        ...(input.metadata || {}),
        cadence: product.billing_cadence,
        ...(customPeriodDays ? { custom_period_days: customPeriodDays } : {}),
      },
    }
    await insert(SUBSCRIPTIONS, row)

    const allowances = await grantTierAllowances({ subscription: row, tier, note: 'initial' })

    await recordEvent({
      subscriptionId: row.id,
      event: 'created',
      toState: snapshot(row),
      actorId,
      actorType,
      metadata: { allowances_granted: allowances },
    })
    if (isTrial) {
      await recordEvent({
        subscriptionId: row.id,
        event: 'trial_started',
        toState: snapshot(row),
        actorId,
        actorType,
        metadata: { trial_days: trialDays, trial_ends_at: row.trial_ends_at },
      })
    }

    return row
  })

  return await getSubscription(created.id)
}

/**
 * End a trial: flip trialing → active AND roll into the next billing period
 * with a fresh allowance grant. Called by the scanner when trial_ends_at
 * is reached; also callable by admin to end a trial early.
 */
export async function endTrial(subscriptionId, { actorId = null, actorType = 'system', reason = 'trial_expired' } = {}) {
  const sub = await getSubscription(subscriptionId)
  if (!sub) throw Object.assign(new Error('Subscription not found'), { code: 'NOT_FOUND' })
  if (sub.status !== 'trialing') {
    throw Object.assign(new Error(`Can only end trial on a trialing subscription (current: ${sub.status})`), { code: 'INVALID_TRANSITION' })
  }

  const tier = await getTier(sub.tier_id)
  const cadence = sub.metadata?.cadence || 'monthly'
  const customPeriodDays = sub.metadata?.custom_period_days || null
  const now = new Date()
  const newPeriodEnd = computePeriodEnd(now, cadence, { customPeriodDays })

  const before = snapshot(sub)
  await transaction(async () => {
    await query(
      `UPDATE commercial.billing_subscriptions
          SET status = 'active',
              trial_ends_at = NULL,
              billing_period_start = $2::timestamptz,
              billing_period_end = $3::timestamptz,
              next_renewal_at = CASE WHEN auto_renew THEN $3::timestamptz ELSE NULL END,
              updated_at = CURRENT_TIMESTAMP
        WHERE id = $1`,
      [
        sub.id,
        now.toISOString(),
        newPeriodEnd ? newPeriodEnd.toISOString() : null,
      ],
    )
    const updated = await getSubscription(sub.id)
    const allowances = await grantTierAllowances({ subscription: updated, tier, note: 'trial_end_renewal' })

    await recordEvent({
      subscriptionId: sub.id,
      event: 'trial_ended',
      fromState: before,
      toState: snapshot(updated),
      actorId, actorType, reason,
      metadata: { allowances_granted: allowances },
    })
  })

  return await getSubscription(sub.id)
}

/**
 * Renew an active subscription: roll to the next period + grant fresh
 * allowances. Called by the scanner when billing_period_end is reached
 * on an auto-renewing subscription.
 *
 * If cancel_at_period_end=true, calls expireSubscription instead.
 */
export async function renewSubscription(subscriptionId, { actorId = null, actorType = 'system' } = {}) {
  const sub = await getSubscription(subscriptionId)
  if (!sub) throw Object.assign(new Error('Subscription not found'), { code: 'NOT_FOUND' })
  if (sub.cancel_at_period_end) {
    return expireSubscription(sub.id, { actorId, actorType, reason: 'cancel_at_period_end reached' })
  }
  if (sub.status !== 'active') {
    throw Object.assign(new Error(`Can only renew an active subscription (current: ${sub.status})`), { code: 'INVALID_TRANSITION' })
  }
  if (!sub.auto_renew) {
    // auto_renew=false at period end → subscription simply expires.
    return expireSubscription(sub.id, { actorId, actorType, reason: 'auto_renew disabled' })
  }

  const tier = await getTier(sub.tier_id)
  const cadence = sub.metadata?.cadence || 'monthly'
  const customPeriodDays = sub.metadata?.custom_period_days || null
  const now = new Date()
  const newPeriodEnd = computePeriodEnd(now, cadence, { customPeriodDays })

  const before = snapshot(sub)
  await transaction(async () => {
    await query(
      `UPDATE commercial.billing_subscriptions
          SET billing_period_start = $2::timestamptz,
              billing_period_end = $3::timestamptz,
              next_renewal_at = $3::timestamptz,
              updated_at = CURRENT_TIMESTAMP
        WHERE id = $1`,
      [sub.id, now.toISOString(), newPeriodEnd ? newPeriodEnd.toISOString() : null],
    )
    const updated = await getSubscription(sub.id)
    const allowances = await grantTierAllowances({ subscription: updated, tier, note: 'renewal' })

    await recordEvent({
      subscriptionId: sub.id,
      event: 'renewed',
      fromState: before,
      toState: snapshot(updated),
      actorId, actorType,
      metadata: { allowances_granted: allowances },
    })
  })

  return await getSubscription(sub.id)
}

/**
 * Immediately cancel (status → cancelled). No new period, no more grants.
 * cancelled subscriptions become expired at their next scheduled period
 * end (or immediately if you pass immediate=true).
 */
export async function cancelSubscription(subscriptionId, {
  reason = null,
  actorId = null,
  actorType = 'tenant',
  atPeriodEnd = true,
} = {}) {
  const sub = await getSubscription(subscriptionId)
  if (!sub) throw Object.assign(new Error('Subscription not found'), { code: 'NOT_FOUND' })
  if (['cancelled', 'expired'].includes(sub.status)) {
    throw Object.assign(new Error(`Subscription is already ${sub.status}`), { code: 'INVALID_TRANSITION' })
  }
  const before = snapshot(sub)
  const now = new Date().toISOString()

  if (atPeriodEnd && sub.billing_period_end) {
    await query(
      `UPDATE commercial.billing_subscriptions
          SET cancel_at_period_end = true,
              cancellation_reason = $2,
              auto_renew = false,
              updated_at = CURRENT_TIMESTAMP
        WHERE id = $1`,
      [sub.id, reason],
    )
    const updated = await getSubscription(sub.id)
    await recordEvent({
      subscriptionId: sub.id,
      event: 'cancelled_at_period_end',
      fromState: before,
      toState: snapshot(updated),
      reason, actorId, actorType,
    })
    return updated
  }

  await query(
    `UPDATE commercial.billing_subscriptions
        SET status = 'cancelled',
            cancelled_at = $2::timestamptz,
            cancel_at_period_end = false,
            auto_renew = false,
            cancellation_reason = $3,
            next_renewal_at = NULL,
            updated_at = CURRENT_TIMESTAMP
      WHERE id = $1`,
    [sub.id, now, reason],
  )
  const updated = await getSubscription(sub.id)
  await recordEvent({
    subscriptionId: sub.id,
    event: 'cancelled_immediately',
    fromState: before,
    toState: snapshot(updated),
    reason, actorId, actorType,
  })
  return updated
}

/**
 * Expire: terminal state for a cancelled or period-end-reached subscription.
 * Called by scanner or directly.
 */
export async function expireSubscription(subscriptionId, { reason = null, actorId = null, actorType = 'system' } = {}) {
  const sub = await getSubscription(subscriptionId)
  if (!sub) throw Object.assign(new Error('Subscription not found'), { code: 'NOT_FOUND' })
  if (sub.status === 'expired') return sub
  const before = snapshot(sub)
  const now = new Date().toISOString()
  await query(
    `UPDATE commercial.billing_subscriptions
        SET status = 'expired',
            cancelled_at = COALESCE(cancelled_at, $2::timestamptz),
            next_renewal_at = NULL,
            updated_at = CURRENT_TIMESTAMP
      WHERE id = $1`,
    [sub.id, now],
  )
  const updated = await getSubscription(sub.id)
  await recordEvent({
    subscriptionId: sub.id,
    event: 'expired',
    fromState: before,
    toState: snapshot(updated),
    reason, actorId, actorType,
  })
  return updated
}

export async function pauseSubscription(subscriptionId, { reason = null, actorId = null, actorType = 'tenant' } = {}) {
  const sub = await getSubscription(subscriptionId)
  if (!sub) throw Object.assign(new Error('Subscription not found'), { code: 'NOT_FOUND' })
  if (sub.status !== 'active') {
    throw Object.assign(new Error(`Can only pause an active subscription (current: ${sub.status})`), { code: 'INVALID_TRANSITION' })
  }
  const before = snapshot(sub)
  const now = new Date().toISOString()
  const newMeta = { ...(sub.metadata || {}), paused_at: now }
  await query(
    `UPDATE commercial.billing_subscriptions
        SET status = 'paused',
            next_renewal_at = NULL,
            metadata = $2::jsonb,
            updated_at = CURRENT_TIMESTAMP
      WHERE id = $1`,
    [sub.id, JSON.stringify(newMeta)],
  )
  const updated = await getSubscription(sub.id)
  await recordEvent({
    subscriptionId: sub.id,
    event: 'paused',
    fromState: before,
    toState: snapshot(updated),
    reason, actorId, actorType,
  })
  return updated
}

export async function resumeSubscription(subscriptionId, { actorId = null, actorType = 'tenant' } = {}) {
  const sub = await getSubscription(subscriptionId)
  if (!sub) throw Object.assign(new Error('Subscription not found'), { code: 'NOT_FOUND' })
  if (sub.status !== 'paused') {
    throw Object.assign(new Error(`Can only resume a paused subscription (current: ${sub.status})`), { code: 'INVALID_TRANSITION' })
  }

  const before = snapshot(sub)
  const now = new Date()
  const cadence = sub.metadata?.cadence || 'monthly'
  const customPeriodDays = sub.metadata?.custom_period_days || null

  // If billing_period_end is already past when we resume, treat it as an
  // implicit renewal event so the tenant starts a fresh period from now.
  const periodEndAt = sub.billing_period_end ? new Date(sub.billing_period_end) : null
  let newPeriodStart = sub.billing_period_start
  let newPeriodEnd = periodEndAt ? periodEndAt.toISOString() : null
  let didRoll = false
  if (!periodEndAt || periodEndAt <= now) {
    const rolledEnd = computePeriodEnd(now, cadence, { customPeriodDays })
    newPeriodStart = now.toISOString()
    newPeriodEnd = rolledEnd ? rolledEnd.toISOString() : null
    didRoll = true
  }

  const newMeta = { ...(sub.metadata || {}) }
  delete newMeta.paused_at

  await transaction(async () => {
    await query(
      `UPDATE commercial.billing_subscriptions
          SET status = 'active',
              billing_period_start = $2::timestamptz,
              billing_period_end = $3::timestamptz,
              next_renewal_at = CASE WHEN auto_renew THEN $3::timestamptz ELSE NULL END,
              metadata = $4::jsonb,
              updated_at = CURRENT_TIMESTAMP
        WHERE id = $1`,
      [sub.id, newPeriodStart, newPeriodEnd, JSON.stringify(newMeta)],
    )
    const updated = await getSubscription(sub.id)
    let allowances = []
    if (didRoll) {
      const tier = await getTier(updated.tier_id)
      allowances = await grantTierAllowances({ subscription: updated, tier, note: 'resume_rollover' })
    }
    await recordEvent({
      subscriptionId: sub.id,
      event: 'resumed',
      fromState: before,
      toState: snapshot(updated),
      actorId, actorType,
      metadata: { rolled_period_forward: didRoll, allowances_granted: allowances },
    })
  })
  return await getSubscription(sub.id)
}

/**
 * Admin-only until Phase 7e wires the payment gateway. Marks a live
 * subscription as past_due (renewal payment failed / trial ended without
 * payment / manual admin flag).
 */
export async function markPastDue(subscriptionId, { reason = null, actorId = null, actorType = 'admin' } = {}) {
  const sub = await getSubscription(subscriptionId)
  if (!sub) throw Object.assign(new Error('Subscription not found'), { code: 'NOT_FOUND' })
  if (!['active', 'trialing'].includes(sub.status)) {
    throw Object.assign(new Error(`Can only mark past_due from active or trialing (current: ${sub.status})`), { code: 'INVALID_TRANSITION' })
  }
  const before = snapshot(sub)
  await query(
    `UPDATE commercial.billing_subscriptions
        SET status = 'past_due',
            updated_at = CURRENT_TIMESTAMP
      WHERE id = $1`,
    [sub.id],
  )
  const updated = await getSubscription(sub.id)
  await recordEvent({
    subscriptionId: sub.id,
    event: 'past_due',
    fromState: before,
    toState: snapshot(updated),
    reason, actorId, actorType,
  })
  return updated
}

/**
 * Move a past_due subscription back to active (payment resolved, or
 * admin correction).
 */
export async function resolvePastDue(subscriptionId, { reason = null, actorId = null, actorType = 'admin' } = {}) {
  const sub = await getSubscription(subscriptionId)
  if (!sub) throw Object.assign(new Error('Subscription not found'), { code: 'NOT_FOUND' })
  if (sub.status !== 'past_due') {
    throw Object.assign(new Error(`Can only resolve past_due from past_due (current: ${sub.status})`), { code: 'INVALID_TRANSITION' })
  }
  const before = snapshot(sub)
  await query(
    `UPDATE commercial.billing_subscriptions
        SET status = 'active',
            updated_at = CURRENT_TIMESTAMP
      WHERE id = $1`,
    [sub.id],
  )
  const updated = await getSubscription(sub.id)
  await recordEvent({
    subscriptionId: sub.id,
    event: 'reactivated',
    fromState: before,
    toState: snapshot(updated),
    reason, actorId, actorType,
  })
  return updated
}

/**
 * Restore the getter for external callers that want to inspect a
 * subscription without importing the DAL.
 */
export { getSubscription }
