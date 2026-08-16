/**
 * Notification content templates.
 *
 * Each event kind has: subject, plaintext body, and optional html
 * body. Templates receive a `ctx` object with variables the caller
 * populates. Missing variables render as blank — templates are
 * defensive and don't throw on missing keys.
 *
 * Keep these editable-by-non-devs by keeping them declarative
 * (no logic beyond simple {{var}} substitution). Rich variants
 * (localized, per-territory) can layer on later without touching
 * the dispatcher.
 */

import { EVENT_KINDS } from './events.js'

function interpolate(template, ctx) {
  return String(template || '').replace(/{{\s*([\w.]+)\s*}}/g, (_, key) => {
    const parts = key.split('.')
    let cur = ctx
    for (const part of parts) {
      if (cur == null) return ''
      cur = cur[part]
    }
    return cur == null ? '' : String(cur)
  })
}

const TEMPLATES = {
  [EVENT_KINDS.SUB_TRIAL_ENDING]: {
    subject: 'Your Wingcaster trial ends in {{days_left}} day(s)',
    body:
`Hi {{tenant.name}},

Your {{plan.name}} trial ends on {{trial_ends_at_short}}.
After that, your subscription automatically starts at {{plan.price_display}} per {{plan.cadence}}.

If you'd rather not continue, cancel before the trial ends — no charge.
Manage your subscription: {{app_url}}/subscription

— Wingcaster`,
  },

  [EVENT_KINDS.SUB_TRIAL_ENDED]: {
    subject: 'Your Wingcaster trial has ended',
    body:
`Hi {{tenant.name}},

Your trial of {{plan.name}} has ended and your subscription is now active.
You'll be billed {{plan.price_display}} per {{plan.cadence}} starting today.

Manage your subscription: {{app_url}}/subscription

— Wingcaster`,
  },

  [EVENT_KINDS.SUB_RENEWED]: {
    subject: 'Your Wingcaster subscription has renewed',
    body:
`Hi {{tenant.name}},

Your subscription to {{plan.name}} has renewed for the next {{plan.cadence}}.
Next renewal: {{next_renewal_short}}

Manage your subscription: {{app_url}}/subscription

— Wingcaster`,
  },

  [EVENT_KINDS.SUB_PAST_DUE]: {
    subject: 'Action required: your Wingcaster subscription is past due',
    body:
`Hi {{tenant.name}},

Your Wingcaster subscription is now past due. Please update your payment method
to avoid interruption to your service.

Manage your subscription: {{app_url}}/subscription

If you need help, reply to this email.

— Wingcaster`,
  },

  [EVENT_KINDS.SUB_REACTIVATED]: {
    subject: 'Your Wingcaster subscription is active again',
    body:
`Hi {{tenant.name}},

Good news — your subscription is active again. Thanks for staying with Wingcaster.

Manage your subscription: {{app_url}}/subscription

— Wingcaster`,
  },

  [EVENT_KINDS.SUB_CANCELLED_AT_PERIOD_END]: {
    subject: 'Your Wingcaster subscription will end on {{period_end_short}}',
    body:
`Hi {{tenant.name}},

We've received your cancellation. Your subscription remains active until
{{period_end_short}}, then ends. You won't be charged again.

Change your mind? Reactivate any time before {{period_end_short}}:
{{app_url}}/subscription

— Wingcaster`,
  },

  [EVENT_KINDS.SUB_CANCELLED_IMMEDIATELY]: {
    subject: 'Your Wingcaster subscription has been cancelled',
    body:
`Hi {{tenant.name}},

Your subscription has been cancelled effective immediately. You'll no longer be
charged. If this wasn't what you intended, contact support.

— Wingcaster`,
  },

  [EVENT_KINDS.SUB_EXPIRED]: {
    subject: 'Your Wingcaster subscription has ended',
    body:
`Hi {{tenant.name}},

Your subscription has ended. Access to paid features is now paused.

Come back any time: {{app_url}}/pricing

— Wingcaster`,
  },

  [EVENT_KINDS.SUB_PAUSED]: {
    subject: 'Your Wingcaster subscription is paused',
    body:
`Hi {{tenant.name}},

Your subscription is now paused. You won't be charged until you resume.

Resume any time: {{app_url}}/subscription

— Wingcaster`,
  },

  [EVENT_KINDS.SUB_RESUMED]: {
    subject: 'Your Wingcaster subscription is active',
    body:
`Hi {{tenant.name}},

Your subscription has resumed. Welcome back.

Manage your subscription: {{app_url}}/subscription

— Wingcaster`,
  },

  [EVENT_KINDS.SUB_UPGRADED]: {
    subject: 'Your Wingcaster plan has been upgraded',
    body:
`Hi {{tenant.name}},

You've upgraded to {{plan.name}}. Any price difference for the rest of the
current period has been captured as a credit note that applies to your next
invoice.

Manage your subscription: {{app_url}}/subscription

— Wingcaster`,
  },

  [EVENT_KINDS.SUB_DOWNGRADED]: {
    subject: 'Your Wingcaster plan has been downgraded',
    body:
`Hi {{tenant.name}},

You've moved to {{plan.name}}. Unused value from your prior plan has been
credited to your account for the next invoice.

Manage your subscription: {{app_url}}/subscription

— Wingcaster`,
  },

  [EVENT_KINDS.SUB_MIGRATED_VERSION]: {
    subject: 'Your Wingcaster plan has been migrated to a new version',
    body:
`Hi {{tenant.name}},

Your subscription has moved to {{plan.name}}. Any price difference has been
captured as a credit note applied to your next invoice.

Manage your subscription: {{app_url}}/subscription

— Wingcaster`,
  },

  [EVENT_KINDS.SUB_GRANDFATHERED]: {
    subject: 'A newer version of your Wingcaster plan is available',
    body:
`Hi {{tenant.name}},

A new version of {{plan.name}} is now available. You've been kept on your current
version, so nothing changes for you unless you migrate.

Take a look: {{app_url}}/pricing

— Wingcaster`,
  },

  [EVENT_KINDS.CREDIT_NOTE_ISSUED]: {
    subject: 'A credit has been added to your Wingcaster account',
    body:
`Hi {{tenant.name}},

We've issued a credit of {{credit.amount_display}} ({{credit.type_label}}) to
your account.

{{credit.reason_line}}

See your credit notes: {{app_url}}/credit-notes

— Wingcaster`,
  },
}

/**
 * Look up + render subject / body for an event kind. Returns
 * { subject, body, html: null } — html rendering is a future extension.
 */
export function renderTemplate(eventKind, ctx = {}) {
  const template = TEMPLATES[eventKind]
  if (!template) return { subject: `[${eventKind}]`, body: `[${eventKind}]`, html: null }
  return {
    subject: interpolate(template.subject, ctx),
    body: interpolate(template.body, ctx),
    html: null,
  }
}

// Exported for test-time introspection.
export { TEMPLATES, interpolate }
