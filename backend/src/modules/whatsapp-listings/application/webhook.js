/**
 * WhatsApp Listing module webhook ingress handler.
 *
 * Responsibilities:
 *   - Verify Meta X-Hub-Signature-256 HMAC using META_APP_SECRET.
 *   - Deduplicate by WhatsApp message ID.
 *   - Route agent listing-intent messages into the module pipeline.
 *   - Return { handled: false } for non-agent / conversational messages so the
 *     platform conversation orchestrator can handle them.
 */

import { createHmac, timingSafeEqual, randomUUID } from 'crypto'
import { Collections, findOneModule, insertModule } from '../infrastructure/db.js'

export function createWebhookHandler({ adapter, entitlements, credits, pipeline, config, logger }) {
  function isListingIntent(event) {
    if (event.type !== 'message') return false
    if (!event.from) return false
    if (event.location) return true
    if (event.text && event.text.trim()) return true
    if (event.media?.length) return true
    return false
  }

  async function isAgentSender(from) {
    const agent = await adapter.getAgentByWhatsAppNumber(from)
    return Boolean(agent)
  }

  function verifySignature({ rawBody, signature }) {
    const appSecret = process.env.META_APP_SECRET || ''
    if (!appSecret) {
      // In development without an app secret, allow through with a warning.
      if (process.env.NODE_ENV !== 'production') return { ok: true, skipped: true }
      return { ok: false, error: 'META_APP_SECRET not configured' }
    }
    if (!signature) return { ok: false, error: 'Missing X-Hub-Signature-256 header' }

    const expected = `sha256=${createHmac('sha256', appSecret).update(rawBody).digest('hex')}`
    try {
      const ok = timingSafeEqual(Buffer.from(expected), Buffer.from(signature))
      return { ok, error: ok ? null : 'Invalid signature' }
    } catch (err) {
      return { ok: false, error: 'Signature verification failed' }
    }
  }

  async function isDuplicate(messageId) {
    return await findOneModule(Collections.PROCESSED_MESSAGES, (m) => m.message_id === messageId)
  }

  async function recordDedupe(messageId, from) {
    await insertModule(Collections.PROCESSED_MESSAGES, {
      id: randomUUID(),
      message_id: messageId,
      from,
      processed_at: new Date().toISOString(),
    })
  }

  async function handle({ rawBody, signature, payload }) {
    const verification = verifySignature({ rawBody, signature })
    if (!verification.ok) {
      logger.warn({ error: verification.error }, 'WhatsApp webhook signature verification failed')
      return { handled: false, error: verification.error, signature_ok: false }
    }

    const events = parseEvents(payload)
    const results = []

    for (const event of events) {
      if (!isListingIntent(event)) {
        results.push({ handled: false, reason: 'not_listing_intent', message_id: event.message_id })
        continue
      }

      if (await isDuplicate(event.message_id)) {
        results.push({ handled: true, reason: 'deduplicated', message_id: event.message_id })
        continue
      }

      const agent = await adapter.getAgentByWhatsAppNumber(event.from)
      if (!agent) {
        results.push({ handled: false, reason: 'not_agent_sender', message_id: event.message_id })
        continue
      }

      const agencyId = await adapter.getAgentAgencyId(agent.id)
      if (!entitlements.isEnabled({ agentId: agent.id, agencyId })) {
        // Feature disabled; send a polite reply and consider it handled so the
        // orchestrator doesn't create a duplicate conversation.
        try {
          const { sendWhatsAppText } = await import('../../whatsapp.js')
          await sendWhatsAppText(event.from, 'This feature is not included in your current plan. Upgrade to enable listing creation via WhatsApp.')
        } catch (err) {
          logger.warn({ err: err.message }, 'failed to send feature disabled reply')
        }
        await recordDedupe(event.message_id, event.from)
        results.push({ handled: true, reason: 'feature_disabled', message_id: event.message_id })
        continue
      }

      try {
        const result = await pipeline.ingest({
          from: event.from,
          messageId: event.message_id,
          text: event.text || '',
          interactiveId: event.interactive_id || null,
          mediaIds: event.media_ids || [],
          media: event.media || [],
          location: event.location || null,
          messageType: event.raw_type || 'text',
          rawPayload: payload,
        })
        await recordDedupe(event.message_id, event.from)
        results.push({ handled: true, ...result, message_id: event.message_id })
      } catch (err) {
        logger.error({ err: err.message || String(err), message_id: event.message_id }, 'pipeline ingest failed')
        await recordDedupe(event.message_id, event.from)
        results.push({ handled: true, error: err.message, message_id: event.message_id })
      }
    }

    const handledAny = results.some((r) => r.handled)
    return { handled: handledAny, results }
  }

  return { handle }
}

function parseEvents(payload) {
  const events = []
  const entries = payload?.entry || []
  for (const entry of entries) {
    for (const change of entry.changes || []) {
      const value = change.value || {}
      const contacts = value.contacts || []
      const contactName = contacts[0]?.profile?.name || ''
      for (const message of value.messages || []) {
        const media = []
        if (message.image?.id) media.push({ id: message.image.id, type: 'image', mimeType: message.image.mime_type || 'image/jpeg' })
        if (message.video?.id) media.push({ id: message.video.id, type: 'video', mimeType: message.video.mime_type || 'video/mp4' })
        if (message.audio?.id) media.push({ id: message.audio.id, type: 'audio', mimeType: message.audio.mime_type || 'audio/mpeg' })
        if (message.voice?.id) media.push({ id: message.voice.id, type: 'voice', mimeType: message.voice.mime_type || 'audio/ogg' })
        if (message.document?.id) media.push({ id: message.document.id, type: 'document', mimeType: message.document.mime_type || 'application/pdf' })

        const location = message.type === 'location' && message.location
          ? {
              latitude: Number(message.location.latitude),
              longitude: Number(message.location.longitude),
              name: message.location.name || null,
              address: message.location.address || null,
            }
          : null

        events.push({
          type: 'message',
          waba_id: entry.id,
          from: message.from,
          name: contactName,
          message_id: message.id,
          timestamp: message.timestamp,
          text: message.text?.body || message.button?.text || message.interactive?.button_reply?.title || message.interactive?.list_reply?.title || '',
          interactive_id: message.interactive?.button_reply?.id || message.interactive?.list_reply?.id || null,
          media,
          media_ids: media.map((m) => m.id),
          raw_type: message.type,
          location,
        })
      }
      for (const status of value.statuses || []) {
        events.push({
          type: 'status',
          waba_id: entry.id,
          message_id: status.id,
          status: status.status,
          recipient_id: status.recipient_id,
          timestamp: status.timestamp,
        })
      }
    }
  }
  return events
}
