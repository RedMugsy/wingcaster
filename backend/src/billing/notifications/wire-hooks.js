/**
 * Wire-hooks: the glue between the subscription lifecycle engine
 * and the notification dispatcher.
 *
 * lifecycle.js calls notifyForHistoryEvent(subscription, historyEvent)
 * after committing every state change. This module:
 *   1. Translates the history-event string into an EVENT_KINDS enum
 *      value (or returns quietly for events we don't notify on).
 *   2. Enriches the notification context with product / tier /
 *      pricing info the templates need.
 *   3. Fires the dispatcher, catching every error so lifecycle flows
 *      never rot because of a notification hiccup.
 *
 * Also exposes the trial-ending scheduler sweep (fired from
 * renewal-scanner.js on each tick).
 */

import logger from '../../lib/logger.js'
import { query } from '../../db.js'
import { getProduct } from '../products/products.js'
import { getTier } from '../products/tiers.js'
import { dispatch } from './dispatcher.js'
import { EVENT_KINDS, eventKindForHistory } from './events.js'

const MS_PER_DAY = 24 * 60 * 60 * 1000

function shortDate(iso) {
  if (!iso) return ''
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  return d.toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' })
}

function priceDisplay(minor, currency) {
  if (minor == null) return ''
  const val = Number(minor) / 100
  const digits = Math.abs(val) < 1 ? 4 : 2
  return `${currency || 'USD'} ${val.toFixed(digits)}`
}

async function buildPlanContext(subscription) {
  if (!subscription) return {}
  const [product, tier] = await Promise.all([
    subscription.product_id ? getProduct(subscription.product_id) : Promise.resolve(null),
    subscription.tier_id ? getTier(subscription.tier_id) : Promise.resolve(null),
  ])
  return {
    plan: {
      name: tier?.name || product?.name || 'your plan',
      code: product?.code || '',
      version: product?.version || '',
      cadence: (product?.billing_cadence || 'month').replace('_', ' '),
      price_display: priceDisplay(subscription.resolved_plan_price_minor, subscription.resolved_plan_currency),
    },
  }
}

/**
 * Fire notification for a subscription history event. Never throws.
 */
export async function notifyForHistoryEvent(subscription, historyEvent, { actorId = null } = {}) {
  if (!subscription) return
  const eventKind = eventKindForHistory(historyEvent)
  if (!eventKind) return

  try {
    const planCtx = await buildPlanContext(subscription)
    const context = {
      ...planCtx,
      tenant: { id: subscription.tenant_id },
      trial_ends_at_short: shortDate(subscription.trial_ends_at),
      period_end_short: shortDate(subscription.billing_period_end),
      next_renewal_short: shortDate(subscription.next_renewal_at),
    }
    await dispatch({
      eventKind,
      tenantId: subscription.tenant_id,
      subscriptionId: subscription.id,
      context,
      actorId,
    })
  } catch (err) {
    logger.warn({ err: err.message, historyEvent, subscriptionId: subscription.id }, 'notify wire-hook failed')
  }
}

/**
 * Fire the credit-note-issued notification. Skipped for proration
 * types (they're a side effect of a migration event, which already
 * notifies).
 */
export async function notifyCreditNoteIssued(note, { subscription = null, actorId = null } = {}) {
  if (!note) return
  if (note.type === 'proration_credit' || note.type === 'proration_debit') return
  try {
    const planCtx = subscription ? await buildPlanContext(subscription) : {}
    const amountDisplay = priceDisplay(note.amount_minor, note.currency)
    const typeLabelMap = {
      refund: 'refund',
      courtesy: 'courtesy credit',
      promo: 'promo credit',
      manual_adjustment: 'account adjustment',
    }
    await dispatch({
      eventKind: EVENT_KINDS.CREDIT_NOTE_ISSUED,
      tenantId: note.tenant_id,
      subscriptionId: note.subscription_id || subscription?.id || null,
      context: {
        ...planCtx,
        tenant: { id: note.tenant_id },
        credit: {
          amount_display: amountDisplay,
          type_label: typeLabelMap[note.type] || note.type,
          reason_line: note.reason ? `Reason: ${note.reason}` : '',
        },
      },
      actorId,
    })
  } catch (err) {
    logger.warn({ err: err.message, noteId: note?.id }, 'notify credit note failed')
  }
}

/**
 * Sweep subscriptions whose trials end within N days and haven't
 * already been notified today. Called from the renewal-scanner tick.
 *
 * Fires SUB_TRIAL_ENDING with days_left context so the template can
 * personalize the wording ("in 7 days", "in 3 days", "in 1 day").
 * De-dupes on the notification_events log — same (tenant, event, day)
 * only fires once.
 */
export async function sweepTrialEndingNotifications({ now = new Date(), thresholds = [7, 3, 1] } = {}) {
  let notified = 0
  for (const days of thresholds) {
    const targetStart = new Date(now.getTime() + (days - 1) * MS_PER_DAY)
    const targetEnd = new Date(now.getTime() + days * MS_PER_DAY)
    const rows = await query(
      `SELECT id, tenant_id, product_id, tier_id, product_version, resolved_plan_price_minor,
              resolved_plan_currency, trial_ends_at, billing_period_end, next_renewal_at
         FROM commercial.billing_subscriptions
        WHERE status = 'trialing'
          AND trial_ends_at IS NOT NULL
          AND trial_ends_at > $1::timestamptz
          AND trial_ends_at <= $2::timestamptz`,
      [targetStart.toISOString(), targetEnd.toISOString()],
    )
    for (const sub of rows) {
      // De-dupe on the notification-event log for TODAY.
      const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate()).toISOString()
      const dupCheck = await query(
        `SELECT id
           FROM commercial.notification_events
          WHERE tenant_id = $1
            AND event_kind = $2
            AND subscription_id = $3
            AND created_at >= $4::timestamptz
            AND (context->>'days_left')::int = $5
          LIMIT 1`,
        [sub.tenant_id, EVENT_KINDS.SUB_TRIAL_ENDING, sub.id, todayStart, days],
      )
      if (dupCheck.length > 0) continue

      try {
        const planCtx = await buildPlanContext(sub)
        await dispatch({
          eventKind: EVENT_KINDS.SUB_TRIAL_ENDING,
          tenantId: sub.tenant_id,
          subscriptionId: sub.id,
          context: {
            ...planCtx,
            tenant: { id: sub.tenant_id },
            days_left: days,
            trial_ends_at_short: shortDate(sub.trial_ends_at),
          },
        })
        notified += 1
      } catch (err) {
        logger.warn({ err: err.message, subscriptionId: sub.id, days }, 'trial-ending sweep dispatch failed')
      }
    }
  }
  return { notified }
}
