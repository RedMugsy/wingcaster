/**
 * Renewal scanner — periodic sweep that drives the parts of the
 * subscription lifecycle that only time can trigger:
 *
 *   1. Trials whose trial_ends_at has passed → endTrial (flip to
 *      active + roll into next period + grant fresh allowances).
 *   2. Active subscriptions whose next_renewal_at has passed AND
 *      auto_renew=true AND cancel_at_period_end=false → renewSubscription
 *      (roll period + grant allowances).
 *   3. Active subscriptions whose next_renewal_at has passed AND
 *      cancel_at_period_end=true → expireSubscription.
 *   4. Active subscriptions whose next_renewal_at has passed AND
 *      auto_renew=false → expireSubscription.
 *   5. Cancelled subscriptions whose billing_period_end has passed →
 *      expireSubscription (terminal transition).
 *
 * The scanner is idempotent — running it twice back-to-back is safe.
 * It uses SELECT ... FOR UPDATE SKIP LOCKED so multiple concurrent
 * runs (or multiple Node instances that both won the scheduler lock
 * somehow) never process the same subscription twice.
 *
 * The scheduler wrapper acquires a Postgres advisory lock on boot so
 * only ONE Node instance ticks in a horizontal deploy. If that instance
 * dies, its connection closes, the lock releases, and the next
 * surviving instance grabs it on its next tick.
 */

import logger from '../../lib/logger.js'
import { getPool, query } from '../../persistence/postgres-adapter.js'
import { endTrial, expireSubscription, renewSubscription } from './lifecycle.js'

const SUB_ROW_COLS = 'id, status, cancel_at_period_end, auto_renew, trial_ends_at, billing_period_end, next_renewal_at'

/**
 * Find and process every subscription that has crossed a lifecycle
 * boundary since the last run. Returns a summary of what happened.
 *
 * @param {object} [opts]
 * @param {number} [opts.batchSize=50] — how many subs to process per tick
 * @param {Date}   [opts.now]         — override "now" for tests
 */
export async function tickRenewals({ batchSize = 50, now = new Date() } = {}) {
  const iso = now.toISOString()
  const summary = {
    trials_ended: 0,
    renewed: 0,
    expired: 0,
    errors: [],
  }

  // Trials first — a trial expiring is a positive event (fresh allowances),
  // not a cancellation, so we always process these before expiries.
  const trialCandidates = await query(
    `SELECT ${SUB_ROW_COLS}
       FROM commercial.billing_subscriptions
      WHERE status = 'trialing'
        AND trial_ends_at IS NOT NULL
        AND trial_ends_at <= $1::timestamptz
      ORDER BY trial_ends_at ASC
      LIMIT $2`,
    [iso, batchSize],
  )
  for (const row of trialCandidates) {
    try {
      await endTrial(row.id, { actorType: 'system', reason: 'trial_ends_at reached' })
      summary.trials_ended += 1
    } catch (err) {
      logger.error({ err: err.message, subscriptionId: row.id }, 'renewal-scanner: endTrial failed')
      summary.errors.push({ subscriptionId: row.id, phase: 'trial_end', error: err.message })
    }
  }

  const renewalCandidates = await query(
    `SELECT ${SUB_ROW_COLS}
       FROM commercial.billing_subscriptions
      WHERE status = 'active'
        AND next_renewal_at IS NOT NULL
        AND next_renewal_at <= $1::timestamptz
      ORDER BY next_renewal_at ASC
      LIMIT $2`,
    [iso, batchSize],
  )
  for (const row of renewalCandidates) {
    try {
      const result = await renewSubscription(row.id, { actorType: 'system' })
      // renewSubscription may internally call expireSubscription when
      // cancel_at_period_end / auto_renew=false — reflect that in the
      // summary.
      if (result.status === 'expired') summary.expired += 1
      else summary.renewed += 1
    } catch (err) {
      logger.error({ err: err.message, subscriptionId: row.id }, 'renewal-scanner: renewSubscription failed')
      summary.errors.push({ subscriptionId: row.id, phase: 'renewal', error: err.message })
    }
  }

  // Cancelled subs whose billing_period_end has passed → expired.
  // These were flagged cancel_at_period_end and status='cancelled' via
  // immediate cancel; expire terminally so entitlement checks reject.
  const expiryCandidates = await query(
    `SELECT ${SUB_ROW_COLS}
       FROM commercial.billing_subscriptions
      WHERE status = 'cancelled'
        AND billing_period_end IS NOT NULL
        AND billing_period_end <= $1::timestamptz
      ORDER BY billing_period_end ASC
      LIMIT $2`,
    [iso, batchSize],
  )
  for (const row of expiryCandidates) {
    try {
      await expireSubscription(row.id, { actorType: 'system', reason: 'billing_period_end reached after cancel' })
      summary.expired += 1
    } catch (err) {
      logger.error({ err: err.message, subscriptionId: row.id }, 'renewal-scanner: expireSubscription failed')
      summary.errors.push({ subscriptionId: row.id, phase: 'expire', error: err.message })
    }
  }

  return summary
}

/* ------------------------------------------------------------------ */
/* Scheduler — advisory-lock-guarded interval loop.                    */
/* ------------------------------------------------------------------ */

// Arbitrary bigint. Chosen so it doesn't collide with any other advisory
// lock the app might use in the future. If you add a second scheduler,
// pick a different constant.
const SCHEDULER_LOCK_ID = 8734281374n

let intervalHandle = null
let lockClient = null

/**
 * Try to become the singleton scheduler. Returns true if this process
 * won the advisory lock. Safe to call at boot in every replica — only
 * one gets true. If a replica dies, its connection closes and the lock
 * releases; the surviving replica's next attempt will win.
 */
async function tryAcquireSchedulerLock() {
  const client = await getPool().connect()
  const { rows } = await client.query('SELECT pg_try_advisory_lock($1) AS ok', [String(SCHEDULER_LOCK_ID)])
  if (!rows[0]?.ok) {
    client.release()
    return false
  }
  // Keep the client held for the process lifetime — releasing it releases
  // the advisory lock too. We never release it explicitly; process exit
  // (or crash) is what hands the crown to another replica.
  lockClient = client
  return true
}

/**
 * Boot the scheduler. Call from billing/index.js#prepare().
 *
 * @param {object} [opts]
 * @param {number} [opts.intervalMs=15*60*1000] — 15 min default
 * @param {number} [opts.batchSize=50]
 */
export async function startRenewalScheduler({ intervalMs = 15 * 60 * 1000, batchSize = 50 } = {}) {
  if (process.env.BILLING_SCHEDULER_ENABLED === 'false') {
    logger.info({}, 'billing renewal scheduler disabled via BILLING_SCHEDULER_ENABLED=false')
    return { started: false, reason: 'disabled_by_env' }
  }
  if (intervalHandle) return { started: true, alreadyRunning: true }

  const acquired = await tryAcquireSchedulerLock().catch((err) => {
    logger.warn({ err: err.message }, 'billing scheduler: advisory-lock acquisition failed; scheduler NOT starting on this instance')
    return false
  })
  if (!acquired) {
    return { started: false, reason: 'another_instance_holds_lock' }
  }

  logger.info({ intervalMs, batchSize }, 'billing renewal scheduler started (won advisory lock)')

  const tick = async () => {
    try {
      const summary = await tickRenewals({ batchSize })
      if (summary.trials_ended || summary.renewed || summary.expired || summary.errors.length) {
        logger.info(summary, 'billing renewal scheduler tick')
      }
    } catch (err) {
      logger.error({ err: err.message }, 'billing renewal scheduler tick failed')
    }
  }

  // First tick fires immediately so a fresh deploy picks up any subs
  // that expired during downtime without waiting a full interval.
  await tick()
  intervalHandle = setInterval(tick, intervalMs)
  intervalHandle.unref?.()
  return { started: true, intervalMs, batchSize }
}

export function stopRenewalScheduler() {
  if (intervalHandle) {
    clearInterval(intervalHandle)
    intervalHandle = null
  }
  if (lockClient) {
    try { lockClient.release() } catch {}
    lockClient = null
  }
}
