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
 *   FACEBOOK_PAGE_ACCESS_TOKEN            (page-scoped token)
 *   FACEBOOK_PAGE_ID                      (default page for posts)
 */

import { v4 as uuidv4 } from 'uuid'

const GRAPH_VERSION = process.env.META_GRAPH_VERSION || 'v21.0'
const GRAPH_BASE = `https://graph.facebook.com/${GRAPH_VERSION}`

export function getFacebookConfig() {
  return {
    pageAccessToken: process.env.FACEBOOK_PAGE_ACCESS_TOKEN || '',
    pageId: process.env.FACEBOOK_PAGE_ID || '',
  }
}

export function isFacebookEnabled() {
  const cfg = getFacebookConfig()
  return Boolean(cfg.pageAccessToken && cfg.pageId)
}

function requireFacebookCreds(token, feature) {
  if (!token) {
    const err = new Error(`Facebook ${feature} requires FACEBOOK_PAGE_ACCESS_TOKEN to be set`)
    err.code = 'FACEBOOK_UNCONFIGURED'
    throw err
  }
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

  requireFacebookPublishing(targetPage, token)

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

  requireFacebookPublishing(targetPage, token)

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
export async function replyToFacebookComment({ commentId, text, accessToken }) {
  const cfg = getFacebookConfig()
  const token = accessToken || cfg.pageAccessToken
  if (!commentId) throw Object.assign(new Error('commentId is required'), { code: 'MISSING_COMMENT_ID' })
  if (!text?.trim()) throw Object.assign(new Error('reply text is required'), { code: 'MISSING_CONTENT' })
  requireFacebookCreds(token, 'comment replies')

  const body = new URLSearchParams()
  body.set('message', text.trim())
  body.set('access_token', token)

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
export async function sendFacebookMessengerDM({ recipientId, text, accessToken }) {
  const cfg = getFacebookConfig()
  const token = accessToken || cfg.pageAccessToken
  if (!recipientId) throw Object.assign(new Error('recipientId is required'), { code: 'MISSING_RECIPIENT' })
  if (!text?.trim()) throw Object.assign(new Error('text is required'), { code: 'MISSING_CONTENT' })
  requireFacebookCreds(token, 'Messenger DMs')

  const res = await fetch(`${GRAPH_BASE}/me/messages?access_token=${token}`, {
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
/**
 * Fetch aggregate insights for a published Facebook Page post.
 *
 * Docs: https://developers.facebook.com/docs/graph-api/reference/v21.0/insights
 * We ask for impressions + reactions + comments + shares as a starting set.
 */
export async function fetchFacebookInsights({ postId, accessToken }) {
  const cfg = getFacebookConfig()
  const token = accessToken || cfg.pageAccessToken
  if (!postId) throw Object.assign(new Error('postId is required'), { code: 'MISSING_POST_ID' })
  requireFacebookCreds(token, 'insights')

  const metrics = 'post_impressions,post_impressions_unique,post_reactions_like_total,post_reactions_by_type_total,post_clicks'
  const res = await fetch(`${GRAPH_BASE}/${postId}/insights?metric=${metrics}&access_token=${token}`)
  const data = await res.json().catch(() => ({}))
  if (!res.ok) {
    throw Object.assign(
      new Error(`Facebook insights error (${res.status}): ${data?.error?.message || JSON.stringify(data).slice(0, 200)}`),
      { code: data?.error?.code || `FACEBOOK_INSIGHTS_${res.status}`, details: data },
    )
  }
  const byName = {}
  for (const row of data.data || []) byName[row.name] = row.values?.[0]?.value ?? null
  const reactionsMap = byName.post_reactions_by_type_total || {}
  const totalReactions = Object.values(reactionsMap).reduce((s, n) => s + (Number(n) || 0), 0)

  // Fetch comment + share count in one extra call (fb doesn't expose these in insights uniformly).
  let commentCount = null, shareCount = null
  try {
    const extra = await fetch(`${GRAPH_BASE}/${postId}?fields=shares,comments.summary(true)&access_token=${token}`)
    const extraData = await extra.json().catch(() => ({}))
    commentCount = extraData?.comments?.summary?.total_count ?? null
    shareCount = extraData?.shares?.count ?? null
  } catch { /* keep nulls */ }

  return {
    impressions: byName.post_impressions ?? null,
    reach: byName.post_impressions_unique ?? null,
    likes: totalReactions || byName.post_reactions_like_total || null,
    comments: commentCount,
    shares: shareCount,
    saves: null,
    clicks: byName.post_clicks ?? null,
    source: 'facebook_graph_api',
    fetched_at: new Date().toISOString(),
  }
}

function requireFacebookPublishing(pageId, token) {
  const missing = []
  if (!pageId) missing.push('FACEBOOK_PAGE_ID')
  if (!token) missing.push('FACEBOOK_PAGE_ACCESS_TOKEN')
  if (missing.length) {
    throw Object.assign(
      new Error(`facebook publishing requires ${missing.join(' and ')} to be set`),
      { code: 'PUBLISH_CREDENTIALS_MISSING' },
    )
  }
}

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
