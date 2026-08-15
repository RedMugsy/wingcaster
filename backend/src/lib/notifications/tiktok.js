/**
 * TikTok dispatcher for the Conversation Orchestrator + publish pipeline.
 *
 * TikTok's public API surface is narrow: Content Posting API for
 * publishing photos/videos, Research API for insights. DMs and comment
 * replies require partner-tier access most integrations don't have.
 *
 * Every function throws with a coded error when credentials are
 * missing or the underlying integration isn't yet wired. No simulator
 * paths — a fake "delivered" for an unimplemented lane is worse than
 * a loud failure the caller can convert to a 503.
 *
 * Env:
 *   TIKTOK_ACCESS_TOKEN — required for anything that hits the live API
 */

import { v4 as uuidv4 } from 'uuid'

export function getTikTokConfig() {
  return {
    accessToken: process.env.TIKTOK_ACCESS_TOKEN || '',
  }
}

export function isTikTokEnabled() {
  return Boolean(getTikTokConfig().accessToken)
}

function requireTikTokCreds(token, feature) {
  if (!token) {
    const err = new Error(`TikTok ${feature} requires TIKTOK_ACCESS_TOKEN to be set`)
    err.code = 'TIKTOK_UNCONFIGURED'
    throw err
  }
}

function unimplemented(feature) {
  const err = new Error(`TikTok ${feature} requires partner API access (not yet implemented)`)
  err.code = 'TIKTOK_UNIMPLEMENTED'
  throw err
}

export async function replyToTikTokComment({ commentId, text, accessToken }) {
  const token = accessToken || getTikTokConfig().accessToken
  if (!commentId) throw Object.assign(new Error('commentId is required'), { code: 'MISSING_COMMENT_ID' })
  if (!text?.trim()) throw Object.assign(new Error('reply text is required'), { code: 'MISSING_CONTENT' })
  requireTikTokCreds(token, 'comment replies')
  unimplemented('comment replies')
}

export async function sendTikTokDM({ userId, text, accessToken }) {
  const token = accessToken || getTikTokConfig().accessToken
  if (!userId) throw Object.assign(new Error('userId is required'), { code: 'MISSING_RECIPIENT' })
  if (!text?.trim()) throw Object.assign(new Error('text is required'), { code: 'MISSING_CONTENT' })
  requireTikTokCreds(token, 'DMs')
  unimplemented('DM sending')
}

export async function publishTikTokPhoto({ imageUrls, caption, accessToken }) {
  const token = accessToken || getTikTokConfig().accessToken
  const urls = Array.isArray(imageUrls) ? imageUrls.filter(Boolean) : [imageUrls].filter(Boolean)
  if (!urls.length) throw Object.assign(new Error('imageUrls is required'), { code: 'MISSING_MEDIA' })
  requireTikTokCreds(token, 'photo publishing')

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

export async function publishTikTokVideo({ videoUrl, caption, accessToken }) {
  const token = accessToken || getTikTokConfig().accessToken
  if (!videoUrl) throw Object.assign(new Error('videoUrl is required'), { code: 'MISSING_MEDIA' })
  requireTikTokCreds(token, 'video publishing')

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

export async function fetchTikTokInsights({ videoId, accessToken }) {
  const token = accessToken || getTikTokConfig().accessToken
  if (!videoId) throw Object.assign(new Error('videoId is required'), { code: 'MISSING_VIDEO_ID' })
  requireTikTokCreds(token, 'insights')

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
    fetched_at: new Date().toISOString(),
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
