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
export async function replyToTikTokComment({ commentId, text }) {
  const cfg = getTikTokConfig()
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
export async function sendTikTokDM({ userId, text }) {
  const cfg = getTikTokConfig()
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
 * Parse a TikTok webhook payload for comments and mentions.
 * This accepts a normalized JSON shape because TikTok webhooks vary by
 * integration partner. Expected shape:
 *   {
 *     comments: [{ id, user_id, username, text, video_id, created_at }],
 *     mentions: [{ id, user_id, username, text, video_id, created_at }]
 *   }
 */
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
