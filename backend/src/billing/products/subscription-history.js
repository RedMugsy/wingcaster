/**
 * Append-only subscription history — commercial.billing_subscription_history.
 *
 * Every subscription mutation writes exactly one row here. Never UPDATE this
 * table. Reads only. This module is the single writer for that constraint;
 * 7c/2's lifecycle engine calls recordEvent() for every state change.
 *
 * Event vocabulary (open — new event codes are fine, no CHECK constraint):
 *   created, trial_started, trial_ended, renewed, upgraded, downgraded,
 *   paused, resumed, cancelled_at_period_end, cancelled_immediately,
 *   expired, migrated, grandfathered, reactivated
 */

import { randomUUID } from 'crypto'
import { findAll, insert } from '../../db.js'

const COLLECTION = 'billing_subscription_history'

const VALID_ACTORS = new Set(['tenant', 'admin', 'system', 'api'])

export async function recordEvent({
  subscriptionId,
  event,
  fromState = null,
  toState = null,
  reason = null,
  actorId = null,
  actorType = null,
  metadata = null,
}) {
  if (!subscriptionId) throw Object.assign(new Error('subscriptionId is required'), { code: 'MISSING_FIELD' })
  if (!event) throw Object.assign(new Error('event is required'), { code: 'MISSING_FIELD' })
  if (actorType != null && !VALID_ACTORS.has(actorType)) {
    throw Object.assign(new Error(`actorType must be one of: ${[...VALID_ACTORS].join(', ')}`), { code: 'INVALID_ACTOR_TYPE' })
  }

  const row = {
    id: randomUUID(),
    subscription_id: subscriptionId,
    event: String(event).slice(0, 40),
    from_state: fromState,
    to_state: toState,
    reason: reason ? String(reason).slice(0, 2000) : null,
    actor_id: actorId,
    actor_type: actorType,
    metadata: metadata && typeof metadata === 'object' ? metadata : {},
    created_at: new Date().toISOString(),
  }
  await insert(COLLECTION, row)
  return row
}

export async function listEvents(subscriptionId, { limit = 200 } = {}) {
  const rows = await findAll(COLLECTION, (r) => r.subscription_id === subscriptionId)
  return rows
    .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())
    .slice(0, limit)
}
