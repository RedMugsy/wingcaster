import { v4 as uuidv4 } from 'uuid'
import { findAll, findOne, insert, update, remove } from '../db.js'
import { sendWhatsAppText, sendWhatsAppImage, isWhatsAppConfigured } from '../whatsapp.js'
import { sendSMS, isSMSEnabled } from '../lib/notifications/sms.js'
import { sendEmail, isEmailEnabled } from '../lib/notifications/email.js'
import { sendInstagramDM, replyToInstagramComment, isInstagramEnabled } from '../lib/notifications/instagram.js'
import { replyToTikTokComment, sendTikTokDM, isTikTokEnabled } from '../lib/notifications/tiktok.js'
import { sendXDM, replyToXMention, isXEnabled } from '../lib/notifications/x.js'
import { sendFacebookMessengerDM, replyToFacebookComment, isFacebookEnabled } from '../lib/notifications/facebook.js'
import { replyToLinkedInComment, isLinkedInEnabled } from '../lib/notifications/linkedin.js'
import { resolveConnectionCredentials } from '../lib/credentials.js'
import { classifyByRules } from '../lib/comment-classifier.js'

// Public comment channels that get classified on ingest. DM channels
// (whatsapp, sms, email, *_dm) skip classification because they're
// already private conversations owned by a specific contact.
const CLASSIFIABLE_CHANNELS = new Set([
  'instagram_comment',
  'facebook_comment',
  'tiktok_comment',
  'x_mention',
  'linkedin_comment',
])

/**
 * Resolve the acting agent's per-platform credentials (enterprise targets +
 * OAuth tokens). Returns null if the agent has no connection for that platform;
 * the caller decides whether to fall back to env-only or fail.
 */
async function resolveAgentPlatformCreds(agentId, platform) {
  if (!agentId || !platform) return null
  const conn = await findOne(
    'marketplace_connections',
    (c) => c.agent_id === agentId && c.platform === platform,
  )
  if (!conn || conn.status !== 'connected') return null
  return resolveConnectionCredentials(conn)
}

function normalizePhone(phone) {
  return String(phone || '').replace(/\D/g, '')
}

function normalizeEmail(email) {
  return String(email || '').trim().toLowerCase()
}

export async function getOrCreateContact({ email, phone, name, assignedAgentId, agencyId, source, channel }) {
  const normalizedEmail = normalizeEmail(email)
  const normalizedPhone = normalizePhone(phone)

  const existing = await findOne('contacts', (c) => {
    if (normalizedEmail && normalizeEmail(c.email) === normalizedEmail) return true
    if (normalizedPhone && normalizePhone(c.phone) === normalizedPhone) return true
    return false
  })

  const now = new Date().toISOString()

  if (existing) {
    const next = {
      ...existing,
      name: name || existing.name || '',
      assigned_agent_id: assignedAgentId || existing.assigned_agent_id || null,
      agency_id: agencyId || existing.agency_id || null,
      last_activity_at: now,
      updated_at: now,
    }
    await update('contacts', (c) => c.id === existing.id, () => next)
    return { contact: await findOne('contacts', (c) => c.id === existing.id), created: false }
  }

  const contact = {
    id: uuidv4(),
    email: normalizedEmail,
    phone: normalizedPhone,
    name: name || '',
    assigned_agent_id: assignedAgentId || null,
    agency_id: agencyId || null,
    source: source || 'unknown',
    first_touch_channel: channel || source || 'unknown',
    first_touch_at: now,
    tags: [],
    status: 'lead',
    last_activity_at: now,
    created_at: now,
    updated_at: now,
  }
  await insert('contacts', contact)
  return { contact, created: true }
}

export async function updateContactActivity(contactId) {
  const contact = await findOne('contacts', (c) => c.id === contactId)
  if (!contact) return null
  const now = new Date().toISOString()
  await update('contacts', (c) => c.id === contactId, (c) => ({ ...c, last_activity_at: now, updated_at: now }))
  return await findOne('contacts', (c) => c.id === contactId)
}

export async function getOrCreateConversation({ contactId, channel, visibility = 'private', assignedAgentId, subject }) {
  const contact = await findOne('contacts', (c) => c.id === contactId)
  if (!contact) throw new Error('Contact not found')

  const existing = await findOne('conversations', (c) => c.contact_id === contactId && c.source_channel === channel)
  const now = new Date().toISOString()

  if (existing) {
    return { conversation: existing, created: false }
  }

  const conversation = {
    id: uuidv4(),
    contact_id: contactId,
    contact_email: contact.email || '',
    contact_phone: contact.phone || '',
    contact_name: contact.name || '',
    assigned_agent_id: assignedAgentId || contact.assigned_agent_id || null,
    source_channel: channel,
    visibility,
    status: 'open',
    priority: 'normal',
    subject: subject || '',
    last_message_at: null,
    last_message_preview: '',
    unread_count: 0,
    is_unread_by_agent: false,
    created_at: now,
    updated_at: now,
  }
  await insert('conversations', conversation)
  return { conversation, created: true }
}

export async function ingestInboundMessage({ channel, provider, providerMessageId, from, to, content, contentType = 'text', rawPayload, name, assignedAgentId, agencyId, subject, visibility = 'private' }) {
  const normalizedPhone = normalizePhone(from)
  const normalizedEmail = normalizeEmail(from)

  const identifier = channel === 'email' ? normalizedEmail : normalizedPhone
  if (!identifier) throw new Error('Inbound message requires a from identifier')

  const { contact, created: contactCreated } = await getOrCreateContact({
    email: channel === 'email' ? from : '',
    phone: channel !== 'email' ? from : '',
    name,
    assignedAgentId,
    agencyId,
    source: channel,
    channel,
  })

  const { conversation, created: conversationCreated } = await getOrCreateConversation({
    contactId: contact.id,
    channel,
    assignedAgentId,
    subject,
    visibility,
  })

  // Classify public comment channels on ingest so downstream UX (filter
  // chips, roll-ups, process router) has data immediately without waiting
  // on the AI worker.
  let classification = null
  if (CLASSIFIABLE_CHANNELS.has(channel) && content) {
    classification = classifyByRules(content)
  }

  const message = {
    id: uuidv4(),
    conversation_id: conversation.id,
    direction: 'inbound',
    channel,
    provider,
    provider_message_id: providerMessageId || null,
    content: content || '',
    content_type: contentType,
    status: 'received',
    sent_at: null,
    delivered_at: null,
    read_at: null,
    failed_reason: null,
    metadata: { raw_payload: rawPayload, to },
    category: classification?.category || null,
    sentiment: classification?.sentiment || null,
    category_confidence: classification?.confidence ?? null,
    category_source: classification?.source || null,
    category_matched_rule: classification?.matched_rule || null,
    category_updated_at: classification ? new Date().toISOString() : null,
    created_by_agent_id: null,
    created_at: new Date().toISOString(),
  }
  await insert('conversation_messages', message)

  await update('conversations', (c) => c.id === conversation.id, (c) => ({
    ...c,
    last_message_at: message.created_at,
    last_message_preview: (content || '').slice(0, 200),
    unread_count: (c.unread_count || 0) + 1,
    is_unread_by_agent: true,
    updated_at: message.created_at,
  }))

  await updateContactActivity(contact.id)

  // Ensure a lightweight inquiry exists for inbound WhatsApp/SMS so it appears in the CRM.
  const existingInquiry = await findOne('inquiries', (i) => i.contact_id === contact.id && i.source === channel)
  if (!existingInquiry && channel !== 'email') {
    await insert('inquiries', {
      id: uuidv4(),
      property_id: null,
      property_title: 'General inquiry',
      agent_id: assignedAgentId || contact.assigned_agent_id || null,
      agency_id: agencyId || contact.agency_id || null,
      site_id: null,
      landing_page: null,
      name: contact.name || identifier,
      email: contact.email || '',
      phone: contact.phone || '',
      message: content || '',
      source: channel,
      channel,
      status: 'new',
      priority: 'normal',
      stage: 'new',
      assigned_to: assignedAgentId || contact.assigned_agent_id || null,
      first_response_at: null,
      next_follow_up_at: null,
      response_sla_minutes: 30,
      response_due_at: new Date(Date.now() + 30 * 60 * 1000).toISOString(),
      closed_at: null,
      lost_reason: '',
      contact_id: contact.id,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })
  }

  return { contact, contactCreated, conversation, conversationCreated, message }
}

export async function updateMessageStatus({ provider, providerMessageId, status, timestamp }) {
  const message = await findOne('conversation_messages', (m) =>
    m.provider === provider && m.provider_message_id === providerMessageId,
  )
  if (!message) return null

  const ts = timestamp || new Date().toISOString()
  const updatePayload = { status }
  if (status === 'delivered') updatePayload.delivered_at = ts
  if (status === 'read') updatePayload.read_at = ts
  if (status === 'sent') updatePayload.sent_at = ts

  await update('conversation_messages', (m) => m.id === message.id, (m) => ({ ...m, ...updatePayload }))
  return await findOne('conversation_messages', (m) => m.id === message.id)
}

export async function sendOutboundMessage({ conversationId, content, contentType = 'text', imageUrl, attachments, sentByAgentId, subject }) {
  const conversation = await findOne('conversations', (c) => c.id === conversationId)
  if (!conversation) throw new Error('Conversation not found')

  const contact = await findOne('contacts', (c) => c.id === conversation.contact_id)
  if (!contact) throw new Error('Contact not found')

  if (conversation.status === 'closed') {
    await update('conversations', (c) => c.id === conversation.id, (c) => ({ ...c, status: 'open', updated_at: new Date().toISOString() }))
  }

  const channel = conversation.source_channel
  const now = new Date().toISOString()

  let dispatch = { ok: false, status: 'pending', provider: null, provider_message_id: null, error: null }

  if (channel === 'whatsapp') {
    if (!isWhatsAppConfigured()) {
      dispatch = { ok: false, status: 'failed', provider: 'whatsapp', provider_message_id: null, error: 'WhatsApp is not configured' }
    } else if (!contact.phone) {
      dispatch = { ok: false, status: 'failed', provider: 'whatsapp', provider_message_id: null, error: 'Contact phone is missing' }
    } else {
      try {
        let response
        if (imageUrl && /^https?:\/\//i.test(imageUrl)) {
          response = await sendWhatsAppImage(contact.phone, { link: imageUrl, caption: content })
        } else {
          response = await sendWhatsAppText(contact.phone, content)
        }
        dispatch = {
          ok: true,
          status: 'sent',
          provider: 'whatsapp',
          provider_message_id: response?.messages?.[0]?.id || null,
          error: null,
        }
      } catch (err) {
        dispatch = { ok: false, status: 'failed', provider: 'whatsapp', provider_message_id: null, error: err.message || String(err) }
      }
    }
  } else if (channel === 'sms') {
    if (!isSMSEnabled()) {
      dispatch = { ok: false, status: 'failed', provider: 'sms', provider_message_id: null, error: 'SMS is not configured' }
    } else if (!contact.phone) {
      dispatch = { ok: false, status: 'failed', provider: 'sms', provider_message_id: null, error: 'Contact phone is missing' }
    } else {
      try {
        const response = await sendSMS({ to: contact.phone, body: content })
        dispatch = {
          ok: response.ok,
          status: response.ok ? 'sent' : 'failed',
          provider: response.provider || 'sms',
          provider_message_id: response.provider_message_id || null,
          error: null,
          simulated: response.simulated || false,
        }
      } catch (err) {
        dispatch = { ok: false, status: 'failed', provider: 'sms', provider_message_id: null, error: err.message || String(err) }
      }
    }
  } else if (channel === 'email') {
    if (!isEmailEnabled()) {
      dispatch = { ok: false, status: 'failed', provider: 'email', provider_message_id: null, error: 'Email is not configured' }
    } else if (!contact.email) {
      dispatch = { ok: false, status: 'failed', provider: 'email', provider_message_id: null, error: 'Contact email is missing' }
    } else {
      try {
        const response = await sendEmail({
          to: contact.email,
          subject: subject || conversation.subject || 'RE: Follow-up',
          body: content,
        })
        dispatch = {
          ok: response.ok,
          status: response.ok ? 'sent' : 'failed',
          provider: response.provider || 'email',
          provider_message_id: response.provider_message_id || null,
          error: null,
          simulated: response.simulated || false,
        }
      } catch (err) {
        dispatch = { ok: false, status: 'failed', provider: 'email', provider_message_id: null, error: err.message || String(err) }
      }
    }
  } else if (channel === 'instagram_dm') {
    if (!isInstagramEnabled()) {
      dispatch = { ok: false, status: 'failed', provider: 'instagram', provider_message_id: null, error: 'Instagram is not configured' }
    } else {
      const rows = await findAll('conversation_messages', (m) => m.conversation_id === conversation.id && m.direction === 'inbound')
      const lastInbound = rows.sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())[0]
      const recipientId = lastInbound?.metadata?.raw_payload?.from || lastInbound?.metadata?.from
      if (!recipientId) {
        dispatch = { ok: false, status: 'failed', provider: 'instagram', provider_message_id: null, error: 'No Instagram DM recipient found on this thread' }
      } else {
        try {
          const creds = await resolveAgentPlatformCreds(sentByAgentId, 'instagram')
          const response = await sendInstagramDM({
            recipientId,
            text: content,
            businessAccountId: creds?.ig_business_account_id || undefined,
            accessToken: creds?.ig_page_access_token_override || undefined,
          })
          dispatch = {
            ok: response.ok,
            status: response.ok ? 'sent' : 'failed',
            provider: response.provider || 'instagram',
            provider_message_id: response.provider_message_id || null,
            error: null,
            simulated: response.simulated || false,
          }
        } catch (err) {
          dispatch = { ok: false, status: 'failed', provider: 'instagram', provider_message_id: null, error: err.message || String(err) }
        }
      }
    }
  } else if (channel === 'instagram_comment') {
    if (!isInstagramEnabled()) {
      dispatch = { ok: false, status: 'failed', provider: 'instagram', provider_message_id: null, error: 'Instagram is not configured' }
    } else {
      const rows = await findAll('conversation_messages', (m) => m.conversation_id === conversation.id && m.direction === 'inbound')
      const lastInbound = rows.sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())[0]
      const commentId = lastInbound?.metadata?.raw_payload?.message_id || lastInbound?.metadata?.message_id
      if (!commentId) {
        dispatch = { ok: false, status: 'failed', provider: 'instagram', provider_message_id: null, error: 'No Instagram comment ID found on this thread' }
      } else {
        try {
          const creds = await resolveAgentPlatformCreds(sentByAgentId, 'instagram')
          const response = await replyToInstagramComment({
            commentId,
            text: content,
            accessToken: creds?.ig_page_access_token_override || undefined,
          })
          dispatch = {
            ok: response.ok,
            status: response.ok ? 'sent' : 'failed',
            provider: response.provider || 'instagram',
            provider_message_id: response.provider_message_id || null,
            error: null,
            simulated: response.simulated || false,
          }
        } catch (err) {
          dispatch = { ok: false, status: 'failed', provider: 'instagram', provider_message_id: null, error: err.message || String(err) }
        }
      }
    }
  } else if (channel === 'tiktok_comment') {
    if (!isTikTokEnabled()) {
      dispatch = { ok: false, status: 'failed', provider: 'tiktok', provider_message_id: null, error: 'TikTok is not configured' }
    } else {
      const rows = await findAll('conversation_messages', (m) => m.conversation_id === conversation.id && m.direction === 'inbound')
      const lastInbound = rows.sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())[0]
      const commentId = lastInbound?.metadata?.raw_payload?.message_id || lastInbound?.metadata?.message_id
      if (!commentId) {
        dispatch = { ok: false, status: 'failed', provider: 'tiktok', provider_message_id: null, error: 'No TikTok comment ID found on this thread' }
      } else {
        try {
          const creds = await resolveAgentPlatformCreds(sentByAgentId, 'tiktok')
          const response = await replyToTikTokComment({
            commentId,
            text: content,
            accessToken: creds?.oauth_access_token || undefined,
          })
          dispatch = {
            ok: response.ok,
            status: response.ok ? 'sent' : 'failed',
            provider: response.provider || 'tiktok',
            provider_message_id: response.provider_message_id || null,
            error: null,
            simulated: response.simulated || false,
          }
        } catch (err) {
          dispatch = { ok: false, status: 'failed', provider: 'tiktok', provider_message_id: null, error: err.message || String(err) }
        }
      }
    }
  } else if (channel === 'tiktok_dm') {
    if (!isTikTokEnabled()) {
      dispatch = { ok: false, status: 'failed', provider: 'tiktok', provider_message_id: null, error: 'TikTok is not configured' }
    } else {
      const rows = await findAll('conversation_messages', (m) => m.conversation_id === conversation.id && m.direction === 'inbound')
      const lastInbound = rows.sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())[0]
      const userId = lastInbound?.metadata?.raw_payload?.from || lastInbound?.metadata?.from
      if (!userId) {
        dispatch = { ok: false, status: 'failed', provider: 'tiktok', provider_message_id: null, error: 'No TikTok user ID found on this thread' }
      } else {
        try {
          const creds = await resolveAgentPlatformCreds(sentByAgentId, 'tiktok')
          const response = await sendTikTokDM({
            userId,
            text: content,
            accessToken: creds?.oauth_access_token || undefined,
          })
          dispatch = {
            ok: response.ok,
            status: response.ok ? 'sent' : 'failed',
            provider: response.provider || 'tiktok',
            provider_message_id: response.provider_message_id || null,
            error: null,
            simulated: response.simulated || false,
          }
        } catch (err) {
          dispatch = { ok: false, status: 'failed', provider: 'tiktok', provider_message_id: null, error: err.message || String(err) }
        }
      }
    }
  } else if (channel === 'x_dm') {
    if (!isXEnabled()) {
      dispatch = { ok: false, status: 'failed', provider: 'x', provider_message_id: null, error: 'X is not configured' }
    } else {
      const rows = await findAll('conversation_messages', (m) => m.conversation_id === conversation.id && m.direction === 'inbound')
      const lastInbound = rows.sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())[0]
      const participantId = lastInbound?.metadata?.raw_payload?.from || lastInbound?.metadata?.from
      if (!participantId) {
        dispatch = { ok: false, status: 'failed', provider: 'x', provider_message_id: null, error: 'No X participant ID found on this thread' }
      } else {
        try {
          const creds = await resolveAgentPlatformCreds(sentByAgentId, 'x')
          const response = await sendXDM({
            participantId,
            text: content,
            bearerToken: creds?.oauth_access_token || undefined,
          })
          dispatch = {
            ok: response.ok,
            status: response.ok ? 'sent' : 'failed',
            provider: response.provider || 'x',
            provider_message_id: response.provider_message_id || null,
            error: null,
            simulated: response.simulated || false,
          }
        } catch (err) {
          dispatch = { ok: false, status: 'failed', provider: 'x', provider_message_id: null, error: err.message || String(err) }
        }
      }
    }
  } else if (channel === 'x_mention') {
    if (!isXEnabled()) {
      dispatch = { ok: false, status: 'failed', provider: 'x', provider_message_id: null, error: 'X is not configured' }
    } else {
      const rows = await findAll('conversation_messages', (m) => m.conversation_id === conversation.id && m.direction === 'inbound')
      const lastInbound = rows.sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())[0]
      const tweetId = lastInbound?.metadata?.raw_payload?.message_id || lastInbound?.metadata?.message_id
      if (!tweetId) {
        dispatch = { ok: false, status: 'failed', provider: 'x', provider_message_id: null, error: 'No X tweet ID found on this thread' }
      } else {
        try {
          const creds = await resolveAgentPlatformCreds(sentByAgentId, 'x')
          const response = await replyToXMention({
            tweetId,
            text: content,
            bearerToken: creds?.oauth_access_token || undefined,
          })
          dispatch = {
            ok: response.ok,
            status: response.ok ? 'sent' : 'failed',
            provider: response.provider || 'x',
            provider_message_id: response.provider_message_id || null,
            error: null,
            simulated: response.simulated || false,
          }
        } catch (err) {
          dispatch = { ok: false, status: 'failed', provider: 'x', provider_message_id: null, error: err.message || String(err) }
        }
      }
    }
  } else if (channel === 'facebook_messenger') {
    if (!isFacebookEnabled()) {
      dispatch = { ok: false, status: 'failed', provider: 'facebook', provider_message_id: null, error: 'Facebook is not configured' }
    } else {
      const rows = await findAll('conversation_messages', (m) => m.conversation_id === conversation.id && m.direction === 'inbound')
      const lastInbound = rows.sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())[0]
      const recipientId = lastInbound?.metadata?.raw_payload?.from || lastInbound?.metadata?.from
      if (!recipientId) {
        dispatch = { ok: false, status: 'failed', provider: 'facebook', provider_message_id: null, error: 'No Facebook Messenger recipient found on this thread' }
      } else {
        try {
          const creds = await resolveAgentPlatformCreds(sentByAgentId, 'facebook')
          const response = await sendFacebookMessengerDM({
            recipientId,
            text: content,
            accessToken: creds?.fb_page_access_token_override || undefined,
          })
          dispatch = {
            ok: response.ok,
            status: response.ok ? 'sent' : 'failed',
            provider: response.provider || 'facebook',
            provider_message_id: response.provider_message_id || null,
            error: null,
            simulated: response.simulated || false,
          }
        } catch (err) {
          dispatch = { ok: false, status: 'failed', provider: 'facebook', provider_message_id: null, error: err.message || String(err) }
        }
      }
    }
  } else if (channel === 'facebook_comment') {
    if (!isFacebookEnabled()) {
      dispatch = { ok: false, status: 'failed', provider: 'facebook', provider_message_id: null, error: 'Facebook is not configured' }
    } else {
      const rows = await findAll('conversation_messages', (m) => m.conversation_id === conversation.id && m.direction === 'inbound')
      const lastInbound = rows.sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())[0]
      const commentId = lastInbound?.metadata?.raw_payload?.message_id || lastInbound?.metadata?.message_id
      if (!commentId) {
        dispatch = { ok: false, status: 'failed', provider: 'facebook', provider_message_id: null, error: 'No Facebook comment ID found on this thread' }
      } else {
        try {
          const creds = await resolveAgentPlatformCreds(sentByAgentId, 'facebook')
          const response = await replyToFacebookComment({
            commentId,
            text: content,
            accessToken: creds?.fb_page_access_token_override || undefined,
          })
          dispatch = {
            ok: response.ok,
            status: response.ok ? 'sent' : 'failed',
            provider: response.provider || 'facebook',
            provider_message_id: response.provider_message_id || null,
            error: null,
            simulated: response.simulated || false,
          }
        } catch (err) {
          dispatch = { ok: false, status: 'failed', provider: 'facebook', provider_message_id: null, error: err.message || String(err) }
        }
      }
    }
  } else if (channel === 'linkedin_comment') {
    if (!isLinkedInEnabled()) {
      dispatch = { ok: false, status: 'failed', provider: 'linkedin', provider_message_id: null, error: 'LinkedIn is not configured' }
    } else {
      const rows = await findAll('conversation_messages', (m) => m.conversation_id === conversation.id && m.direction === 'inbound')
      const lastInbound = rows.sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())[0]
      const postUrn = lastInbound?.metadata?.raw_payload?.post_urn || lastInbound?.metadata?.post_urn
      if (!postUrn) {
        dispatch = { ok: false, status: 'failed', provider: 'linkedin', provider_message_id: null, error: 'No LinkedIn post URN found on this thread' }
      } else {
        try {
          const creds = await resolveAgentPlatformCreds(sentByAgentId, 'linkedin')
          const response = await replyToLinkedInComment({
            postUrn,
            parentCommentUrn: lastInbound?.metadata?.raw_payload?.comment_urn || null,
            text: content,
            actorUrn: creds?.li_author_urn || undefined,
            accessToken: creds?.li_access_token_override || undefined,
          })
          dispatch = {
            ok: response.ok,
            status: response.ok ? 'sent' : 'failed',
            provider: response.provider || 'linkedin',
            provider_message_id: response.provider_message_id || null,
            error: null,
            simulated: response.simulated || false,
          }
        } catch (err) {
          dispatch = { ok: false, status: 'failed', provider: 'linkedin', provider_message_id: null, error: err.message || String(err) }
        }
      }
    }
  } else {
    dispatch = { ok: false, status: 'pending', provider: null, provider_message_id: null, error: `Outbound dispatch for ${channel} not yet implemented` }
  }

  const message = {
    id: uuidv4(),
    conversation_id: conversation.id,
    direction: 'outbound',
    channel,
    provider: dispatch.provider,
    provider_message_id: dispatch.provider_message_id,
    content: content || '',
    content_type: contentType,
    status: dispatch.status,
    sent_at: dispatch.ok ? now : null,
    delivered_at: null,
    read_at: null,
    failed_reason: dispatch.error,
    metadata: { attachments: attachments || [] },
    created_by_agent_id: sentByAgentId || null,
    created_at: now,
  }
  await insert('conversation_messages', message)

  await update('conversations', (c) => c.id === conversation.id, (c) => ({
    ...c,
    last_message_at: now,
    last_message_preview: (content || '').slice(0, 200),
    is_unread_by_agent: false,
    updated_at: now,
  }))

  await updateContactActivity(contact.id)

  return { message, dispatch }
}

export async function assignConversation(conversationId, agentId) {
  const conversation = await findOne('conversations', (c) => c.id === conversationId)
  if (!conversation) return null
  const now = new Date().toISOString()
  await update('conversations', (c) => c.id === conversationId, (c) => ({ ...c, assigned_agent_id: agentId || null, updated_at: now }))
  await update('contacts', (c) => c.id === conversation.contact_id, (c) => ({ ...c, assigned_agent_id: agentId || c.assigned_agent_id, updated_at: now }))
  return await findOne('conversations', (c) => c.id === conversationId)
}

export async function closeConversation(conversationId, reason = '') {
  const conversation = await findOne('conversations', (c) => c.id === conversationId)
  if (!conversation) return null
  const now = new Date().toISOString()
  await update('conversations', (c) => c.id === conversationId, (c) => ({
    ...c,
    status: 'closed',
    closed_at: now,
    close_reason: reason,
    updated_at: now,
  }))
  return await findOne('conversations', (c) => c.id === conversationId)
}

export async function reopenConversation(conversationId) {
  const conversation = await findOne('conversations', (c) => c.id === conversationId)
  if (!conversation) return null
  if (conversation.status !== 'closed') return conversation
  const now = new Date().toISOString()
  await update('conversations', (c) => c.id === conversationId, (c) => ({ ...c, status: 'open', updated_at: now }))
  return await findOne('conversations', (c) => c.id === conversationId)
}

export async function markConversationReadByAgent(conversationId) {
  const conversation = await findOne('conversations', (c) => c.id === conversationId)
  if (!conversation) return null
  const now = new Date().toISOString()
  await update('conversations', (c) => c.id === conversationId, (c) => ({
    ...c,
    unread_count: 0,
    is_unread_by_agent: false,
    updated_at: now,
  }))
  return await findOne('conversations', (c) => c.id === conversationId)
}

export async function mergeContacts(sourceContactId, targetContactId) {
  const source = await findOne('contacts', (c) => c.id === sourceContactId)
  const target = await findOne('contacts', (c) => c.id === targetContactId)
  if (!source || !target) throw new Error('Source or target contact not found')

  const now = new Date().toISOString()

  // Move child records
  for (const collection of ['inquiries', 'viewings', 'conversation_messages']) {
    await update(collection, (r) => r.contact_id === target.id, (r) => ({ ...r, contact_id: source.id, updated_at: now }))
  }
  await update('conversations', (c) => c.contact_id === target.id, (c) => ({ ...c, contact_id: source.id, updated_at: now }))

  // Merge fields into source
  await update('contacts', (c) => c.id === source.id, (c) => ({
    ...c,
    email: c.email || target.email,
    phone: c.phone || target.phone,
    name: c.name || target.name,
    assigned_agent_id: c.assigned_agent_id || target.assigned_agent_id,
    agency_id: c.agency_id || target.agency_id,
    tags: Array.from(new Set([...(c.tags || []), ...(target.tags || [])])),
    status: c.status === 'client' ? 'client' : (target.status === 'client' ? 'client' : (c.status || target.status)),
    last_activity_at: now,
    updated_at: now,
  }))

  await remove('contacts', (c) => c.id === target.id)

  return await findOne('contacts', (c) => c.id === source.id)
}
