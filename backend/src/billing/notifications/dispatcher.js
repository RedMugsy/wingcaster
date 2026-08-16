/**
 * Notification dispatcher — the single call-site the lifecycle
 * engine (and any other business flow) uses to fire a notification.
 *
 * Contract:
 *   dispatch({ eventKind, tenantId, subscriptionId?, context, actorId? })
 *   → writes notification_events row (always)
 *   → for each subscribed channel: writes notification_deliveries row,
 *     attempts send, records outcome
 *   → NEVER throws — a delivery failure logs + records but does not
 *     bubble to the caller. Business flows must not be gated on
 *     email deliverability.
 *
 * Currently ships email delivery only. SMS / WhatsApp / in-app slots
 * are reserved by the schema and preferences code but not wired.
 */

import { randomUUID } from 'crypto'
import logger from '../../lib/logger.js'
import { findOne, insert } from '../../db.js'
import { isEmailEnabled, sendEmail } from '../../lib/notifications/email.js'
import { renderTemplate } from './templates.js'
import { isEnabled as prefIsEnabled } from './preferences.js'
import { insertPendingDelivery, markFailed, markSent, markSkipped } from './deliveries.js'

const EVENTS = 'notification_events'
const CHANNELS = ['email']

function appUrl() {
  return process.env.PUBLIC_APP_URL || process.env.APP_URL || 'https://app.wingcaster.example'
}

/**
 * Lookup helper — resolve tenant email for a tenant_id. Tenants are
 * users; we key by users.id. Returns null if no user or no email.
 */
async function resolveTenantEmail(tenantId) {
  if (!tenantId) return null
  const user = await findOne('users', (u) => u.id === tenantId)
  if (!user) return null
  const email = user.email
  if (!email || typeof email !== 'string') return null
  return { email: email.trim(), name: user.name || null }
}

/**
 * Fire a notification for an event. Safe to await, always resolves.
 */
export async function dispatch({ eventKind, tenantId, subscriptionId = null, context = {}, actorId = null }) {
  const eventId = randomUUID()
  const now = new Date().toISOString()
  const enrichedContext = {
    app_url: appUrl(),
    ...context,
  }

  // Always write the event row FIRST so we have an audit even if downstream
  // fails.
  try {
    await insert(EVENTS, {
      id: eventId,
      event_kind: eventKind,
      tenant_id: tenantId,
      subscription_id: subscriptionId,
      subject: (enrichedContext.subject_override || null),
      context: enrichedContext,
      created_at: now,
      actor_id: actorId,
    })
  } catch (err) {
    logger.error({ err: err.message, eventKind, tenantId }, 'notification: failed to log event; not attempting delivery')
    return { eventId: null, deliveries: [] }
  }

  const deliveries = []
  for (const channel of CHANNELS) {
    try {
      const result = await dispatchToChannel({ eventId, eventKind, tenantId, channel, context: enrichedContext })
      deliveries.push(result)
    } catch (err) {
      logger.error({ err: err.message, eventKind, tenantId, channel }, 'notification: channel dispatch threw')
      deliveries.push({ channel, status: 'failed', error: err.message })
    }
  }
  return { eventId, deliveries }
}

async function dispatchToChannel({ eventId, eventKind, tenantId, channel, context }) {
  // Preferences check FIRST — if opted out, write a skipped delivery
  // and return; no PII lookup, no send attempt.
  const enabled = await prefIsEnabled({ tenantId, eventKind, channel })
  if (!enabled) {
    const pending = await insertPendingDelivery({ eventId, channel, destination: null })
    await markSkipped(pending.id, { reason: 'tenant_opted_out' })
    return { channel, status: 'skipped', reason: 'tenant_opted_out' }
  }

  if (channel === 'email') {
    return dispatchEmail({ eventId, eventKind, tenantId, context })
  }
  const pending = await insertPendingDelivery({ eventId, channel, destination: null })
  await markSkipped(pending.id, { reason: `channel_${channel}_not_implemented` })
  return { channel, status: 'skipped', reason: 'channel_not_implemented' }
}

async function dispatchEmail({ eventId, eventKind, tenantId, context }) {
  const target = await resolveTenantEmail(tenantId)
  if (!target) {
    const pending = await insertPendingDelivery({ eventId, channel: 'email', destination: null })
    await markSkipped(pending.id, { reason: 'no_tenant_email' })
    return { channel: 'email', status: 'skipped', reason: 'no_tenant_email' }
  }

  const enrichedContext = { ...context, tenant: { ...(context.tenant || {}), name: target.name || context.tenant?.name || 'there' } }
  const { subject, body, html } = renderTemplate(eventKind, enrichedContext)

  const pending = await insertPendingDelivery({
    eventId, channel: 'email', destination: target.email,
    metadata: { subject },
  })

  if (!isEmailEnabled()) {
    await markSkipped(pending.id, { reason: 'email_transport_not_configured' })
    return { channel: 'email', status: 'skipped', reason: 'email_transport_not_configured' }
  }

  try {
    const result = await sendEmail({ to: target.email, subject, body, html })
    await markSent(pending.id, { provider: result?.provider || null, providerMessageId: result?.provider_message_id || null })
    return { channel: 'email', status: 'sent', deliveryId: pending.id }
  } catch (err) {
    await markFailed(pending.id, {
      provider: err?.details?.provider || null,
      errorCode: err?.code || null,
      errorMessage: err?.message || String(err),
    })
    return { channel: 'email', status: 'failed', deliveryId: pending.id, error: err?.message }
  }
}
