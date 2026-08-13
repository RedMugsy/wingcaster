/**
 * Facebook dispatcher for the Conversation Orchestrator.
 *
 * Facebook has three surfaces we care about:
 *   1. Page post publishing (feed, photo, video) via Meta Graph API.
 *   2. Page comment replies via Meta Graph API.
 *   3. Facebook Messenger DMs via the Send API.
 *
 * For live sending you need:
 *   - A Facebook Page and a Meta developer app with pages_read_engagement,
 *     pages_manage_posts, pages_messaging, pages_manage_engagement scopes.
 *   - A page-scoped access token.
 *
 * Env:
 *   FACEBOOK_PROVIDER=dev|meta_graph      (default: dev)
 *   FACEBOOK_PAGE_ACCESS_TOKEN            (page-scoped token)
 *   FACEBOOK_PAGE_ID                      (default page for posts)
 *   FACEBOOK_DEV_ALWAYS_SUCCESS=true      (default: true)
 */

import { v4 as uuidv4 } from 'uuid'

const GRAPH_VERSION = process.env.META_GRAPH_VERSION || 'v21.0'
const GRAPH_BASE = `https://graph.facebook.com/${GRAPH_VERSION}`

export function getFacebookConfig() {
  return {
    provider: process.env.FACEBOOK_PROVIDER || 'dev',
    pageAccessToken: process.env.FACEBOOK_PAGE_ACCESS_TOKEN || '',
    pageId: process.env.FACEBOOK_PAGE_ID || '',
    devAlwaysSuccess: process.env.FACEBOOK_DEV_ALWAYS_SUCCESS !== 'false',
  }
}

export function isFacebookEnabled() {
  const cfg = getFacebookConfig()
  if (cfg.provider === 'dev') return true
  return Boolean(cfg.pageAccessToken && cfg.pageId)
}

/**
 * Publish a text / link post to a Facebook Page feed.
 *   POST /{page-id}/feed  {message, link?}
 */
export async function publishFacebookPagePost({ pageId, message, linkUrl, accessToken }) {
  const cfg = getFacebookConfig()
  const targetPage = pageId || cfg.pageId
  const token = accessToken || cfg.pageAccessToken
  const text = String(message || '').trim()
  if (!text && !linkUrl) {
    throw Object.assign(new Error('message or linkUrl is required'), { code: 'MISSING_CONTENT' })
  }

  if (cfg.provider === 'dev' || !isFacebookEnabled()) {
    if (cfg.devAlwaysSuccess) {
      const postId = `${targetPage || 'devpage'}_${uuidv4().slice(0, 12)}`
      return {
        ok: true,
        provider: 'facebook_dev_simulator',
        post_id: postId,
        external_url: `https://facebook.com/dev/posts/${postId}`,
        simulated: true,
      }
    }
    throw Object.assign(new Error('Facebook dev mode configured to fail'), { code: 'DEV_FAILURE' })
  }

  const body = new URLSearchParams()
  if (text) body.set('message', text)
  if (linkUrl) body.set('link', linkUrl)
  body.set('access_token', token)

  const res = await fetch(`${GRAPH_BASE}/${targetPage}/feed`, { method: 'POST', body })
  const payload = await res.json().catch(() => ({}))
  if (!res.ok || payload?.error) {
    throw Object.assign(new Error(payload?.error?.message || `Facebook feed post failed: ${res.status}`), {
      code: 'FACEBOOK_LIVE_ERROR',
      details: payload,
    })
  }
  return {
    ok: true,
    provider: 'facebook_graph',
    post_id: payload.id,
    external_url: payload.id ? `https://facebook.com/${payload.id}` : null,
    raw: payload,
  }
}

/**
 * Publish a photo to a Facebook Page.
 *   POST /{page-id}/photos  {url, caption?, published=true}
 */
export async function publishFacebookPagePhoto({ pageId, imageUrl, caption, accessToken }) {
  const cfg = getFacebookConfig()
  const targetPage = pageId || cfg.pageId
  const token = accessToken || cfg.pageAccessToken
  if (!imageUrl) throw Object.assign(new Error('imageUrl is required'), { code: 'MISSING_MEDIA' })

  if (cfg.provider === 'dev' || !isFacebookEnabled()) {
    if (cfg.devAlwaysSuccess) {
      const postId = `${targetPage || 'devpage'}_photo_${uuidv4().slice(0, 12)}`
      return {
        ok: true,
        provider: 'facebook_dev_simulator',
        post_id: postId,
        external_url: `https://facebook.com/dev/photos/${postId}`,
        simulated: true,
      }
    }
    throw Object.assign(new Error('Facebook dev mode configured to fail'), { code: 'DEV_FAILURE' })
  }

  const body = new URLSearchParams()
  body.set('url', imageUrl)
  if (caption) body.set('caption', caption)
  body.set('published', 'true')
  body.set('access_token', token)

  const res = await fetch(`${GRAPH_BASE}/${targetPage}/photos`, { method: 'POST', body })
  const payload = await res.json().catch(() => ({}))
  if (!res.ok || payload?.error) {
    throw Object.assign(new Error(payload?.error?.message || `Facebook photo publish failed: ${res.status}`), {
      code: 'FACEBOOK_LIVE_ERROR',
      details: payload,
    })
  }
  return {
    ok: true,
    provider: 'facebook_graph',
    post_id: payload.post_id || payload.id,
    external_url: payload.post_id ? `https://facebook.com/${payload.post_id}` : null,
    raw: payload,
  }
}

/**
 * Reply to a Facebook Page comment.
 *   POST /{comment-id}/comments  {message}
 */
export async function replyToFacebookComment({ commentId, text }) {
  const cfg = getFacebookConfig()
  if (!commentId) throw Object.assign(new Error('commentId is required'), { code: 'MISSING_COMMENT_ID' })
  if (!text?.trim()) throw Object.assign(new Error('reply text is required'), { code: 'MISSING_CONTENT' })

  if (cfg.provider === 'dev' || !isFacebookEnabled()) {
    if (cfg.devAlwaysSuccess) {
      return {
        ok: true,
        provider: 'facebook_dev_simulator',
        provider_message_id: `fb_comment_dev_${uuidv4().slice(0, 12)}`,
        comment_id: commentId,
        text: text.trim(),
        simulated: true,
      }
    }
    throw Object.assign(new Error('Facebook dev mode configured to fail'), { code: 'DEV_FAILURE' })
  }

  const body = new URLSearchParams()
  body.set('message', text.trim())
  body.set('access_token', cfg.pageAccessToken)

  const res = await fetch(`${GRAPH_BASE}/${commentId}/comments`, { method: 'POST', body })
  const payload = await res.json().catch(() => ({}))
  if (!res.ok || payload?.error) {
    throw Object.assign(new Error(payload?.error?.message || `Facebook comment reply failed: ${res.status}`), {
      code: 'FACEBOOK_LIVE_ERROR',
      details: payload,
    })
  }
  return {
    ok: true,
    provider: 'facebook_graph',
    provider_message_id: payload.id,
    raw: payload,
  }
}

/**
 * Send a Facebook Messenger DM to a page follower.
 *   POST /me/messages  {recipient: {id}, message: {text}}
 */
export async function sendFacebookMessengerDM({ recipientId, text }) {
  const cfg = getFacebookConfig()
  if (!recipientId) throw Object.assign(new Error('recipientId is required'), { code: 'MISSING_RECIPIENT' })
  if (!text?.trim()) throw Object.assign(new Error('text is required'), { code: 'MISSING_CONTENT' })

  if (cfg.provider === 'dev' || !isFacebookEnabled()) {
    if (cfg.devAlwaysSuccess) {
      return {
        ok: true,
        provider: 'facebook_dev_simulator',
        provider_message_id: `fb_dm_dev_${uuidv4().slice(0, 12)}`,
        recipient_id: recipientId,
        text: text.trim(),
        simulated: true,
      }
    }
    throw Object.assign(new Error('Facebook dev mode configured to fail'), { code: 'DEV_FAILURE' })
  }

  const res = await fetch(`${GRAPH_BASE}/me/messages?access_token=${cfg.pageAccessToken}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      recipient: { id: recipientId },
      message: { text: text.trim() },
      messaging_type: 'RESPONSE',
    }),
  })
  const payload = await res.json().catch(() => ({}))
  if (!res.ok || payload?.error) {
    throw Object.assign(new Error(payload?.error?.message || `Facebook DM failed: ${res.status}`), {
      code: 'FACEBOOK_LIVE_ERROR',
      details: payload,
    })
  }
  return {
    ok: true,
    provider: 'facebook_graph',
    provider_message_id: payload.message_id,
    raw: payload,
  }
}

/**
 * Parse a Facebook webhook payload (Page events).
 * Expected shape: { object: 'page', entry: [{ id, messaging?: [...], changes?: [...] }] }
 */
export function parseIncomingFacebookWebhook(payload) {
  const events = []
  const entries = Array.isArray(payload?.entry) ? payload.entry : []

  for (const entry of entries) {
    for (const msg of entry.messaging || []) {
      if (msg.message?.text) {
        events.push({
          type: 'dm',
          provider: 'facebook',
          from: msg.sender?.id || '',
          to: msg.recipient?.id || '',
          message_id: msg.message.mid || `fb_dm_${uuidv4().slice(0, 12)}`,
          text: String(msg.message.text).trim(),
          timestamp: msg.timestamp ? String(msg.timestamp) : null,
        })
      }
    }
    for (const change of entry.changes || []) {
      if (change.field === 'feed' && change.value?.item === 'comment') {
        events.push({
          type: 'comment',
          provider: 'facebook',
          from: change.value.from?.id || '',
          from_username: change.value.from?.name || '',
          message_id: change.value.comment_id || `fb_comment_${uuidv4().slice(0, 12)}`,
          post_id: change.value.post_id || null,
          text: String(change.value.message || '').trim(),
          timestamp: change.value.created_time ? String(change.value.created_time) : null,
        })
      }
    }
  }

  return events
}
