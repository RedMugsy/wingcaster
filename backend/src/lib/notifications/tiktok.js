/**
 * TikTok dispatcher for the Conversation Orchestrator.
 *
 * TikTok does not expose a public API for DMs or programmatic comment replies
 * for most third-party integrations. This module provides a dev simulator and
 * a live-path scaffold that can be wired once TikTok for Business or partner
 * API access is available.
 *
 * Env:
 *   TIKTOK_PROVIDER=dev|tiktok_for_business   (default: dev)
 *   TIKTOK_ACCESS_TOKEN
 *   TIKTOK_DEV_ALWAYS_SUCCESS=true            (default: true)
 */

import { v4 as uuidv4 } from 'uuid'

export function getTikTokConfig() {
  return {
    provider: process.env.TIKTOK_PROVIDER || 'dev',
    accessToken: process.env.TIKTOK_ACCESS_TOKEN || '',
    devAlwaysSuccess: process.env.TIKTOK_DEV_ALWAYS_SUCCESS !== 'false',
  }
}

export function isTikTokEnabled() {
  const cfg = getTikTokConfig()
  if (cfg.provider === 'dev') return true
  return Boolean(cfg.accessToken)
}

/**
 * Reply to a TikTok comment. Public replies must not contain PII.
 * Live path requires TikTok Research / Content API access which is restricted.
 */
export async function replyToTikTokComment({ commentId, text, accessToken }) {
  const cfg = getTikTokConfig()
  const token = accessToken || cfg.accessToken
  void token
  if (!commentId) throw Object.assign(new Error('commentId is required'), { code: 'MISSING_COMMENT_ID' })
  if (!text?.trim()) throw Object.assign(new Error('reply text is required'), { code: 'MISSING_CONTENT' })

  if (cfg.provider === 'dev' || !isTikTokEnabled()) {
    if (cfg.devAlwaysSuccess) {
      return {
        ok: true,
        provider: 'tiktok_dev_simulator',
        provider_message_id: `tiktok_comment_dev_${uuidv4().slice(0, 12)}`,
        comment_id: commentId,
        text: text.trim(),
        simulated: true,
      }
    }
    throw Object.assign(new Error('TikTok dev mode configured to fail'), { code: 'DEV_FAILURE' })
  }

  throw Object.assign(
    new Error('TikTok live comment replies require TikTok for Business / partner API access (not yet implemented)'),
    { code: 'TIKTOK_LIVE_NOT_IMPLEMENTED' },
  )
}

/**
 * Send a TikTok DM. Live path is not generally available to third-party apps.
 */
export async function sendTikTokDM({ userId, text, accessToken }) {
  const cfg = getTikTokConfig()
  const token = accessToken || cfg.accessToken
  void token
  if (!userId) throw Object.assign(new Error('userId is required'), { code: 'MISSING_RECIPIENT' })
  if (!text?.trim()) throw Object.assign(new Error('text is required'), { code: 'MISSING_CONTENT' })

  if (cfg.provider === 'dev' || !isTikTokEnabled()) {
    if (cfg.devAlwaysSuccess) {
      return {
        ok: true,
        provider: 'tiktok_dev_simulator',
        provider_message_id: `tiktok_dm_dev_${uuidv4().slice(0, 12)}`,
        user_id: userId,
        text: text.trim(),
        simulated: true,
      }
    }
    throw Object.assign(new Error('TikTok dev mode configured to fail'), { code: 'DEV_FAILURE' })
  }

  throw Object.assign(
    new Error('TikTok live DM sending requires TikTok partner API access (not yet implemented)'),
    { code: 'TIKTOK_LIVE_NOT_IMPLEMENTED' },
  )
}

/**
 * Publish a photo post to TikTok. Live path uses TikTok Content Posting API's
 * Direct Post (photo mode). Requires a TikTok for Business developer app with
 * `video.publish` scope (photo mode is enabled at app-review time).
 *
 * Live endpoint: POST https://open.tiktokapis.com/v2/post/publish/content/init/
 *   body: { post_info, source_info: { source: 'PULL_FROM_URL', photo_images: [...] } }
 */
export async function publishTikTokPhoto({ imageUrls, caption, accessToken }) {
  const cfg = getTikTokConfig()
  const token = accessToken || cfg.accessToken
  const urls = Array.isArray(imageUrls) ? imageUrls.filter(Boolean) : [imageUrls].filter(Boolean)
  if (!urls.length) throw Object.assign(new Error('imageUrls is required'), { code: 'MISSING_MEDIA' })

  requireTikTokPublishing(token)

  // Live path — POST /v2/post/publish/content/init/
  const res = await fetch('https://open.tiktokapis.com/v2/post/publish/content/init/', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json; charset=UTF-8',
    },
    body: JSON.stringify({
      post_info: {
        title: caption || '',
        privacy_level: 'PUBLIC_TO_EVERYONE',
        disable_comment: false,
      },
      source_info: {
        source: 'PULL_FROM_URL',
        photo_cover_index: 0,
        photo_images: urls,
      },
      post_mode: 'DIRECT_POST',
      media_type: 'PHOTO',
    }),
  })
  const body = await res.json().catch(() => ({}))
  if (!res.ok) {
    throw Object.assign(new Error(body?.error?.message || `TikTok photo publish failed: ${res.status}`), {
      code: 'TIKTOK_LIVE_ERROR',
      details: body,
    })
  }
  return {
    ok: true,
    provider: 'tiktok_content_api',
    publish_id: body?.data?.publish_id || null,
    raw: body,
  }
}

/**
 * Publish a vertical video to TikTok via the Content Posting API.
 * Live path requires the same `video.publish` scope on a TikTok for Business app.
 */
export async function publishTikTokVideo({ videoUrl, caption, accessToken }) {
  const cfg = getTikTokConfig()
  const token = accessToken || cfg.accessToken
  if (!videoUrl) throw Object.assign(new Error('videoUrl is required'), { code: 'MISSING_MEDIA' })

  requireTikTokPublishing(token)

  const res = await fetch('https://open.tiktokapis.com/v2/post/publish/video/init/', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json; charset=UTF-8',
    },
    body: JSON.stringify({
      post_info: {
        title: caption || '',
        privacy_level: 'PUBLIC_TO_EVERYONE',
        disable_comment: false,
      },
      source_info: {
        source: 'PULL_FROM_URL',
        video_url: videoUrl,
      },
    }),
  })
  const body = await res.json().catch(() => ({}))
  if (!res.ok) {
    throw Object.assign(new Error(body?.error?.message || `TikTok video publish failed: ${res.status}`), {
      code: 'TIKTOK_LIVE_ERROR',
      details: body,
    })
  }
  return {
    ok: true,
    provider: 'tiktok_content_api',
    publish_id: body?.data?.publish_id || null,
    raw: body,
  }
}

/**
 * Parse a TikTok webhook payload for comments and mentions.
 * This accepts a normalized JSON shape because TikTok webhooks vary by
 * integration partner. Expected shape:
 *   {
 *     comments: [{ id, user_id, username, text, video_id, created_at }],
 *     mentions: [{ id, user_id, username, text, video_id, created_at }]
 *   }
 */
/**
 * Fetch aggregate video insights.
 *
 * TikTok Research API (`/v2/research/video/query/`) is partner-gated. We
 * always simulate in dev mode; live mode is scaffolded so it can be flipped
 * on once TikTok for Business partner status is granted.
 */
export async function fetchTikTokInsights({ videoId, accessToken }) {
  const cfg = getTikTokConfig()
  const token = accessToken || cfg.accessToken
  if (!videoId) throw Object.assign(new Error('videoId is required'), { code: 'MISSING_VIDEO_ID' })

  if (cfg.provider === 'dev' || !isTikTokEnabled() || !token) {
    return {
      impressions: 8400, reach: null, likes: 312, comments: 24, shares: 41, saves: null, clicks: null,
      source: 'tiktok_dev_simulator', simulated: true, fetched_at: new Date().toISOString(),
    }
  }

  const res = await fetch('https://open.tiktokapis.com/v2/research/video/query/', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json; charset=UTF-8',
    },
    body: JSON.stringify({
      query: { and: [{ operation: 'IN', field_name: 'video_ids', field_values: [videoId] }] },
      fields: ['id', 'view_count', 'like_count', 'comment_count', 'share_count'],
      max_count: 1,
    }),
  })
  const data = await res.json().catch(() => ({}))
  if (!res.ok) {
    throw Object.assign(
      new Error(`TikTok insights error (${res.status}): ${data?.error?.message || JSON.stringify(data).slice(0, 200)}`),
      { code: `TIKTOK_INSIGHTS_${res.status}`, details: data },
    )
  }
  const v = data?.data?.videos?.[0] || {}
  return {
    impressions: v.view_count ?? null,
    reach: null,
    likes: v.like_count ?? null,
    comments: v.comment_count ?? null,
    shares: v.share_count ?? null,
    saves: null,
    clicks: null,
    source: 'tiktok_research_api',
    simulated: false,
    fetched_at: new Date().toISOString(),
  }
}

function requireTikTokPublishing(token) {
  if (!token) {
    throw Object.assign(
      new Error('tiktok publishing requires TIKTOK_ACCESS_TOKEN to be set'),
      { code: 'PUBLISH_CREDENTIALS_MISSING' },
    )
  }
}

export function parseIncomingTikTokWebhook(payload) {
  const events = []
  const comments = payload?.comments || payload?.comment || []
  const mentions = payload?.mentions || payload?.mention || []

  for (const item of Array.isArray(comments) ? comments : [comments]) {
    if (!item) continue
    events.push({
      type: 'comment',
      provider: 'tiktok',
      from: item.user_id || item.from_id || '',
      from_username: item.username || item.from_username || '',
      message_id: item.id || `tiktok_comment_${uuidv4().slice(0, 12)}`,
      video_id: item.video_id || null,
      text: String(item.text || item.message || '').trim(),
      timestamp: item.created_at ? String(item.created_at) : null,
    })
  }

  for (const item of Array.isArray(mentions) ? mentions : [mentions]) {
    if (!item) continue
    events.push({
      type: 'mention',
      provider: 'tiktok',
      from: item.user_id || item.from_id || '',
      from_username: item.username || item.from_username || '',
      message_id: item.id || `tiktok_mention_${uuidv4().slice(0, 12)}`,
      video_id: item.video_id || null,
      text: String(item.text || item.message || '').trim(),
      timestamp: item.created_at ? String(item.created_at) : null,
    })
  }

  return events
}
