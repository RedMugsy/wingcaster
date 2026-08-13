/**
 * Instagram dispatcher for the Conversation Orchestrator.
 *
 * Instagram has two messaging surfaces we care about:
 *   1. Instagram DM (private) via Meta Messenger / Instagram Messaging API.
 *   2. Instagram comment (public) via the Instagram Graph API.
 *
 * For live sending you need:
 *   - A Facebook Page connected to an Instagram Business/Creator account.
 *   - Meta app with instagram_basic, instagram_manage_messages, pages_messaging (where applicable).
 *
 * Env:
 *   INSTAGRAM_PROVIDER=dev|meta_graph          (default: dev)
 *   INSTAGRAM_PAGE_ACCESS_TOKEN                (page-scoped token for DMs and comment replies)
 *   INSTAGRAM_BUSINESS_ACCOUNT_ID              (for Graph API comment actions)
 *   INSTAGRAM_DEV_ALWAYS_SUCCESS=true          (default: true)
 */

import { v4 as uuidv4 } from 'uuid'

const GRAPH_VERSION = process.env.META_GRAPH_VERSION || 'v21.0'
const GRAPH_BASE = `https://graph.facebook.com/${GRAPH_VERSION}`

function normalizeInstagramHandle(handle) {
  if (!handle) return ''
  return String(handle).replace(/^@/, '').trim().toLowerCase()
}

export function getInstagramConfig() {
  return {
    provider: process.env.INSTAGRAM_PROVIDER || 'dev',
    pageAccessToken: process.env.INSTAGRAM_PAGE_ACCESS_TOKEN || '',
    businessAccountId: process.env.INSTAGRAM_BUSINESS_ACCOUNT_ID || '',
    devAlwaysSuccess: process.env.INSTAGRAM_DEV_ALWAYS_SUCCESS !== 'false',
  }
}

export function isInstagramEnabled() {
  const cfg = getInstagramConfig()
  if (cfg.provider === 'dev') return true
  return Boolean(cfg.pageAccessToken)
}

/**
 * Send an Instagram DM reply (dev simulation or live Meta Graph API).
 */
export async function sendInstagramDM({ recipientId, text, attachmentUrl, accessToken }) {
  const cfg = getInstagramConfig()
  const token = accessToken || cfg.pageAccessToken
  if (!recipientId) throw Object.assign(new Error('recipientId is required for Instagram DM'), { code: 'MISSING_RECIPIENT' })
  if (!text?.trim() && !attachmentUrl) throw Object.assign(new Error('text or attachmentUrl is required'), { code: 'MISSING_CONTENT' })

  if (cfg.provider === 'dev' || !isInstagramEnabled()) {
    if (cfg.devAlwaysSuccess) {
      return {
        ok: true,
        provider: 'instagram_dev_simulator',
        provider_message_id: `instagram_dm_dev_${uuidv4().slice(0, 12)}`,
        recipient_id: recipientId,
        text: text || '',
        simulated: true,
      }
    }
    throw Object.assign(new Error('Instagram dev mode configured to fail'), { code: 'DEV_FAILURE' })
  }

  const payload = {
    recipient: { id: recipientId },
    messaging_type: 'RESPONSE',
  }
  if (attachmentUrl) {
    payload.message = { attachment: { type: 'image', payload: { url: attachmentUrl, is_reusable: false } } }
    if (text) payload.message.attachment.payload.caption = text
  } else {
    payload.message = { text: text.trim() }
  }

  const res = await fetch(`${GRAPH_BASE}/me/messages?access_token=${token}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  })

  const data = await res.json().catch(() => ({}))
  if (!res.ok) {
    const err = new Error(`Instagram DM error (${res.status}): ${data?.error?.message || JSON.stringify(data).slice(0, 200)}`)
    err.code = data?.error?.code || `INSTAGRAM_DM_${res.status}`
    err.details = data
    throw err
  }

  return {
    ok: true,
    provider: 'instagram_messenger_api',
    provider_message_id: data?.message_id || null,
    recipient_id: recipientId,
    text: text || '',
    simulated: false,
  }
}

/**
 * Reply to an Instagram comment (public). Public replies should never contain PII;
 * we encourage the user to move to DM.
 */
export async function replyToInstagramComment({ commentId, text, accessToken }) {
  const cfg = getInstagramConfig()
  const token = accessToken || cfg.pageAccessToken
  if (!commentId) throw Object.assign(new Error('commentId is required'), { code: 'MISSING_COMMENT_ID' })
  if (!text?.trim()) throw Object.assign(new Error('reply text is required'), { code: 'MISSING_CONTENT' })

  if (cfg.provider === 'dev' || !isInstagramEnabled()) {
    if (cfg.devAlwaysSuccess) {
      return {
        ok: true,
        provider: 'instagram_dev_simulator',
        provider_message_id: `instagram_comment_dev_${uuidv4().slice(0, 12)}`,
        comment_id: commentId,
        text: text.trim(),
        simulated: true,
      }
    }
    throw Object.assign(new Error('Instagram dev mode configured to fail'), { code: 'DEV_FAILURE' })
  }

  const res = await fetch(`${GRAPH_BASE}/${commentId}/replies?access_token=${token}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ message: text.trim() }),
  })

  const data = await res.json().catch(() => ({}))
  if (!res.ok) {
    const err = new Error(`Instagram comment reply error (${res.status}): ${data?.error?.message || JSON.stringify(data).slice(0, 200)}`)
    err.code = data?.error?.code || `INSTAGRAM_COMMENT_${res.status}`
    err.details = data
    throw err
  }

  return {
    ok: true,
    provider: 'instagram_graph_api',
    provider_message_id: data?.id || null,
    comment_id: commentId,
    text: text.trim(),
    simulated: false,
  }
}

/**
 * Parse a Meta webhook payload for Instagram Messenger DM events.
 * Instagram DMs and Facebook Messenger DMs share the same webhook format.
 */
export function parseIncomingInstagramDMWebhook(payload) {
  const events = []
  const entries = payload?.entry || []
  for (const entry of entries) {
    for (const messaging of entry?.messaging || []) {
      const sender = messaging?.sender
      const message = messaging?.message
      const isEcho = message?.is_echo === true
      if (isEcho) continue

      if (message && (message.text || message.attachments)) {
        const text = message.text || ''
        const attachmentUrl = message.attachments?.[0]?.payload?.url
        events.push({
          type: 'dm',
          provider: 'instagram_messenger_api',
          from: sender?.id,
          from_username: sender?.username || '',
          message_id: message.mid,
          text: text.trim(),
          attachment_url: attachmentUrl || null,
          timestamp: messaging?.timestamp ? String(Math.floor(Number(messaging.timestamp) / 1000)) : null,
        })
      }
    }
  }
  return events
}

/**
 * Fetch aggregate insights for a published Instagram media object.
 *
 * Docs: https://developers.facebook.com/docs/instagram-api/reference/ig-media/insights
 * The metric set varies by media_type; we ask for a superset and drop nulls.
 */
export async function fetchInstagramInsights({ mediaId, accessToken }) {
  const cfg = getInstagramConfig()
  const token = accessToken || cfg.pageAccessToken
  if (!mediaId) throw Object.assign(new Error('mediaId is required'), { code: 'MISSING_MEDIA_ID' })

  if (cfg.provider === 'dev' || !isInstagramEnabled() || !token) {
    return {
      impressions: 1200, reach: 890, likes: 74, comments: 6, shares: 3, saves: 12, clicks: null,
      source: 'instagram_dev_simulator', simulated: true, fetched_at: new Date().toISOString(),
    }
  }

  const metrics = 'impressions,reach,likes,comments,shares,saved'
  const res = await fetch(`${GRAPH_BASE}/${mediaId}/insights?metric=${metrics}&access_token=${token}`)
  const data = await res.json().catch(() => ({}))
  if (!res.ok) {
    throw Object.assign(
      new Error(`Instagram insights error (${res.status}): ${data?.error?.message || JSON.stringify(data).slice(0, 200)}`),
      { code: data?.error?.code || `INSTAGRAM_INSIGHTS_${res.status}`, details: data },
    )
  }
  const byName = {}
  for (const row of data.data || []) {
    byName[row.name] = row.values?.[0]?.value ?? null
  }
  return {
    impressions: byName.impressions ?? null,
    reach: byName.reach ?? null,
    likes: byName.likes ?? null,
    comments: byName.comments ?? null,
    shares: byName.shares ?? null,
    saves: byName.saved ?? null,
    clicks: null,
    source: 'instagram_graph_api',
    simulated: false,
    fetched_at: new Date().toISOString(),
  }
}

/**
 * Publish a single-image Instagram feed post.
 * Uses the Instagram Graph API content publishing flow.
 * Docs: https://developers.facebook.com/docs/instagram-api/guides/content-publishing
 */
export async function publishInstagramFeed({ imageUrl, caption, businessAccountId, accessToken }) {
  const cfg = getInstagramConfig()
  const igAccountId = businessAccountId || cfg.businessAccountId
  const token = accessToken || cfg.pageAccessToken
  if (!igAccountId) {
    return simulateInstagramPublish('feed_image', { imageUrl, caption })
  }

  const createUrl = `${GRAPH_BASE}/${igAccountId}/media?access_token=${token}`
  const createBody = new URLSearchParams({ image_url: imageUrl })
  if (caption) createBody.append('caption', caption)

  const createRes = await fetch(createUrl, { method: 'POST', body: createBody })
  const createData = await createRes.json().catch(() => ({}))
  if (!createRes.ok || !createData.id) {
    throw Object.assign(new Error(`Instagram feed creation failed (${createRes.status}): ${createData?.error?.message || JSON.stringify(createData).slice(0, 200)}`), { code: 'INSTAGRAM_FEED_CREATE_FAILED', details: createData })
  }

  const publishUrl = `${GRAPH_BASE}/${igAccountId}/media_publish?access_token=${token}`
  const publishBody = new URLSearchParams({ creation_id: createData.id })
  const publishRes = await fetch(publishUrl, { method: 'POST', body: publishBody })
  const publishData = await publishRes.json().catch(() => ({}))
  if (!publishRes.ok || !publishData.id) {
    throw Object.assign(new Error(`Instagram feed publish failed (${publishRes.status}): ${publishData?.error?.message || JSON.stringify(publishData).slice(0, 200)}`), { code: 'INSTAGRAM_FEED_PUBLISH_FAILED', details: publishData })
  }

  return {
    ok: true,
    provider: 'instagram_graph_api',
    provider_message_id: publishData.id,
    media_id: publishData.id,
    simulated: false,
  }
}

/**
 * Publish an Instagram carousel post.
 */
export async function publishInstagramCarousel({ imageUrls, caption, businessAccountId, accessToken }) {
  const cfg = getInstagramConfig()
  const igAccountId = businessAccountId || cfg.businessAccountId
  const token = accessToken || cfg.pageAccessToken
  if (!imageUrls?.length) throw Object.assign(new Error('imageUrls is required for carousel'), { code: 'MISSING_CAROUSEL_IMAGES' })
  if (!igAccountId) {
    return simulateInstagramPublish('carousel', { imageUrls, caption })
  }

  const children = []
  for (const imageUrl of imageUrls) {
    const childUrl = `${GRAPH_BASE}/${igAccountId}/media?access_token=${token}`
    const childBody = new URLSearchParams({ is_carousel_item: 'true', image_url: imageUrl })
    const childRes = await fetch(childUrl, { method: 'POST', body: childBody })
    const childData = await childRes.json().catch(() => ({}))
    if (!childRes.ok || !childData.id) {
      throw Object.assign(new Error(`Instagram carousel child creation failed (${childRes.status}): ${childData?.error?.message || JSON.stringify(childData).slice(0, 200)}`), { code: 'INSTAGRAM_CAROUSEL_CHILD_FAILED', details: childData })
    }
    children.push(childData.id)
  }

  const createUrl = `${GRAPH_BASE}/${igAccountId}/media?access_token=${token}`
  const createBody = new URLSearchParams({ media_type: 'CAROUSEL', children: children.join(',') })
  if (caption) createBody.append('caption', caption)
  const createRes = await fetch(createUrl, { method: 'POST', body: createBody })
  const createData = await createRes.json().catch(() => ({}))
  if (!createRes.ok || !createData.id) {
    throw Object.assign(new Error(`Instagram carousel creation failed (${createRes.status}): ${createData?.error?.message || JSON.stringify(createData).slice(0, 200)}`), { code: 'INSTAGRAM_CAROUSEL_CREATE_FAILED', details: createData })
  }

  const publishUrl = `${GRAPH_BASE}/${igAccountId}/media_publish?access_token=${token}`
  const publishBody = new URLSearchParams({ creation_id: createData.id })
  const publishRes = await fetch(publishUrl, { method: 'POST', body: publishBody })
  const publishData = await publishRes.json().catch(() => ({}))
  if (!publishRes.ok || !publishData.id) {
    throw Object.assign(new Error(`Instagram carousel publish failed (${publishRes.status}): ${publishData?.error?.message || JSON.stringify(publishData).slice(0, 200)}`), { code: 'INSTAGRAM_CAROUSEL_PUBLISH_FAILED', details: publishData })
  }

  return {
    ok: true,
    provider: 'instagram_graph_api',
    provider_message_id: publishData.id,
    media_id: publishData.id,
    simulated: false,
  }
}

/**
 * Publish an Instagram Reel.
 * Note: Reels have strict requirements (duration, aspect ratio, codec). The caller
 * should provide a compliant video URL. We attempt the Graph API container flow.
 */
export async function publishInstagramReel({ videoUrl, caption, businessAccountId, accessToken }) {
  const cfg = getInstagramConfig()
  const igAccountId = businessAccountId || cfg.businessAccountId
  const token = accessToken || cfg.pageAccessToken
  if (!igAccountId) {
    return simulateInstagramPublish('reel', { videoUrl, caption })
  }

  const createUrl = `${GRAPH_BASE}/${igAccountId}/media?access_token=${token}`
  const createBody = new URLSearchParams({ media_type: 'REELS', video_url: videoUrl })
  if (caption) createBody.append('caption', caption)
  if (process.env.INSTAGRAM_SHARE_REEL_TO_FEED === 'true') createBody.append('share_to_feed', 'true')

  const createRes = await fetch(createUrl, { method: 'POST', body: createBody })
  const createData = await createRes.json().catch(() => ({}))
  if (!createRes.ok || !createData.id) {
    throw Object.assign(new Error(`Instagram reel creation failed (${createRes.status}): ${createData?.error?.message || JSON.stringify(createData).slice(0, 200)}`), { code: 'INSTAGRAM_REEL_CREATE_FAILED', details: createData })
  }

  // Reels may require polling for status before publish. We do a single immediate attempt.
  const publishUrl = `${GRAPH_BASE}/${igAccountId}/media_publish?access_token=${token}`
  const publishBody = new URLSearchParams({ creation_id: createData.id })
  const publishRes = await fetch(publishUrl, { method: 'POST', body: publishBody })
  const publishData = await publishRes.json().catch(() => ({}))
  if (!publishRes.ok || !publishData.id) {
    throw Object.assign(new Error(`Instagram reel publish failed (${publishRes.status}): ${publishData?.error?.message || JSON.stringify(publishData).slice(0, 200)}`), { code: 'INSTAGRAM_REEL_PUBLISH_FAILED', details: publishData })
  }

  return {
    ok: true,
    provider: 'instagram_graph_api',
    provider_message_id: publishData.id,
    media_id: publishData.id,
    simulated: false,
  }
}

/**
 * Publish an Instagram Story (single image).
 */
export async function publishInstagramStory({ imageUrl, businessAccountId, accessToken }) {
  const cfg = getInstagramConfig()
  const igAccountId = businessAccountId || cfg.businessAccountId
  const token = accessToken || cfg.pageAccessToken
  if (!igAccountId) {
    return simulateInstagramPublish('story', { imageUrl })
  }

  const createUrl = `${GRAPH_BASE}/${igAccountId}/media?access_token=${token}`
  const createBody = new URLSearchParams({ media_type: 'STORIES', image_url: imageUrl })

  const createRes = await fetch(createUrl, { method: 'POST', body: createBody })
  const createData = await createRes.json().catch(() => ({}))
  if (!createRes.ok || !createData.id) {
    throw Object.assign(new Error(`Instagram story creation failed (${createRes.status}): ${createData?.error?.message || JSON.stringify(createData).slice(0, 200)}`), { code: 'INSTAGRAM_STORY_CREATE_FAILED', details: createData })
  }

  const publishUrl = `${GRAPH_BASE}/${igAccountId}/media_publish?access_token=${token}`
  const publishBody = new URLSearchParams({ creation_id: createData.id })
  const publishRes = await fetch(publishUrl, { method: 'POST', body: publishBody })
  const publishData = await publishRes.json().catch(() => ({}))
  if (!publishRes.ok || !publishData.id) {
    throw Object.assign(new Error(`Instagram story publish failed (${publishRes.status}): ${publishData?.error?.message || JSON.stringify(publishData).slice(0, 200)}`), { code: 'INSTAGRAM_STORY_PUBLISH_FAILED', details: publishData })
  }

  return {
    ok: true,
    provider: 'instagram_graph_api',
    provider_message_id: publishData.id,
    media_id: publishData.id,
    simulated: false,
  }
}

function simulateInstagramPublish(format, { imageUrl, videoUrl, caption }) {
  const cfg = getInstagramConfig()
  if (cfg.devAlwaysSuccess === false) {
    throw Object.assign(new Error('Instagram dev mode configured to fail'), { code: 'DEV_FAILURE' })
  }
  return {
    ok: true,
    provider: 'instagram_dev_simulator',
    provider_message_id: `instagram_${format}_dev_${uuidv4().slice(0, 12)}`,
    simulated: true,
    format,
    imageUrl,
    videoUrl,
    caption,
  }
}

/**
 * Parse Instagram Graph API comment webhooks.
 * Meta sends comment webhooks under the instagram field in entry.changes.
 */
export function parseIncomingInstagramCommentWebhook(payload) {
  const events = []
  const entries = payload?.entry || []
  for (const entry of entries) {
    for (const change of entry?.changes || []) {
      const value = change?.value || {}
      if (change?.field === 'mentions' || value?.field === 'mentions') {
        // Mention of the account in a caption or comment.
        events.push({
          type: 'comment',
          provider: 'instagram_graph_api',
          from: value?.comment_id ? `comment_${value.comment_id}` : value?.media_id,
          from_username: value?.username || '',
          message_id: value?.comment_id || `instagram_mention_${uuidv4().slice(0, 12)}`,
          media_id: value?.media_id || null,
          text: String(value?.text || value?.caption || '').trim(),
          timestamp: null,
        })
      } else if (value?.comment_id || value?.id) {
        events.push({
          type: 'comment',
          provider: 'instagram_graph_api',
          from: value?.from?.id || value?.from_id,
          from_username: value?.from?.username || value?.username || '',
          message_id: value?.comment_id || value?.id,
          media_id: value?.media_id || value?.entry?.[0]?.changes?.[0]?.value?.media_id || null,
          text: String(value?.text || value?.message || '').trim(),
          timestamp: value?.created_time ? String(value.created_time) : null,
        })
      }
    }
  }
  return events
}
