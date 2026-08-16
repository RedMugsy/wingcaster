/**
 * Notification event kinds — the canonical vocabulary the dispatcher
 * accepts, and the vocabulary tenants opt in/out of.
 *
 * Never rename these strings after they ship. They land in the DB
 * (notification_events.event_kind and notification_preferences.event_kind)
 * so a rename would strand every existing row.
 */

export const EVENT_KINDS = {
  // Subscription lifecycle
  SUB_TRIAL_ENDING: 'subscription.trial_ending',
  SUB_TRIAL_ENDED: 'subscription.trial_ended',
  SUB_RENEWED: 'subscription.renewed',
  SUB_PAST_DUE: 'subscription.past_due',
  SUB_REACTIVATED: 'subscription.reactivated',
  SUB_CANCELLED_AT_PERIOD_END: 'subscription.cancelled_at_period_end',
  SUB_CANCELLED_IMMEDIATELY: 'subscription.cancelled_immediately',
  SUB_EXPIRED: 'subscription.expired',
  SUB_PAUSED: 'subscription.paused',
  SUB_RESUMED: 'subscription.resumed',
  SUB_UPGRADED: 'subscription.upgraded',
  SUB_DOWNGRADED: 'subscription.downgraded',
  SUB_MIGRATED_VERSION: 'subscription.migrated_version',
  SUB_GRANDFATHERED: 'subscription.grandfathered',

  // Credit notes
  CREDIT_NOTE_ISSUED: 'credit_note.issued',
}

export const ALL_EVENT_KINDS = Object.values(EVENT_KINDS)

/**
 * Which events map to which subscription-history event names emitted by
 * lifecycle.js#recordEvent. Used by the lifecycle wire-in to translate
 * a history-event string into an EVENT_KIND for the dispatcher.
 *
 * Returning null means "no notification for this history event" (e.g.
 * `created` — we could add welcome emails later but not now).
 */
export function eventKindForHistory(historyEvent) {
  switch (historyEvent) {
    case 'trial_ended': return EVENT_KINDS.SUB_TRIAL_ENDED
    case 'renewed': return EVENT_KINDS.SUB_RENEWED
    case 'past_due': return EVENT_KINDS.SUB_PAST_DUE
    case 'reactivated': return EVENT_KINDS.SUB_REACTIVATED
    case 'cancelled_at_period_end': return EVENT_KINDS.SUB_CANCELLED_AT_PERIOD_END
    case 'cancelled_immediately': return EVENT_KINDS.SUB_CANCELLED_IMMEDIATELY
    case 'expired': return EVENT_KINDS.SUB_EXPIRED
    case 'paused': return EVENT_KINDS.SUB_PAUSED
    case 'resumed': return EVENT_KINDS.SUB_RESUMED
    case 'upgraded': return EVENT_KINDS.SUB_UPGRADED
    case 'downgraded': return EVENT_KINDS.SUB_DOWNGRADED
    case 'migrated_version': return EVENT_KINDS.SUB_MIGRATED_VERSION
    case 'grandfathered': return EVENT_KINDS.SUB_GRANDFATHERED
    default: return null
  }
}
