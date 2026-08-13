/**
 * X (Twitter) dispatcher for the Conversation Orchestrator.
 *
 * X API v2 is required for DMs and mentions. Live access requires a paid
 * Basic/Pro/Enterprise tier and appropriate OAuth 2.0 scopes. This module
 * provides a dev simulator and a live-path scaffold that can be enabled once
 * credentials are available.
 *
 * Env:
 *   X_PROVIDER=dev|x_api_v2                    (default: dev)
 *   X_BEARER_TOKEN                             (for API v2 lookups)
 *   X_API_KEY / X_API_KEY_SECRET               (OAuth 1.0a user context)
 *   X_ACCESS_TOKEN / X_ACCESS_TOKEN_SECRET     (OAuth 1.0a user context)
 *   X_DEV_ALWAYS_SUCCESS=true                  (default: true)
 */

import { v4 as uuidv4 } from 'uuid'

export function getXConfig() {
  return {
    provider: process.env.X_PROVIDER || 'dev',
    bearerToken: process.env.X_BEARER_TOKEN || '',
    apiKey: process.env.X_API_KEY || '',
    apiKeySecret: process.env.X_API_KEY_SECRET || '',
    accessToken: process.env.X_ACCESS_TOKEN || '',
    accessTokenSecret: process.env.X_ACCESS_TOKEN_SECRET || '',
    devAlwaysSuccess: process.env.X_DEV_ALWAYS_SUCCESS !== 'false',
  }
}

export function isXEnabled() {
  const cfg = getXConfig()
  if (cfg.provider === 'dev') return true
  return Boolean(cfg.bearerToken && cfg.accessToken && cfg.accessTokenSecret)
}

function xApiBase() {
  return 'https://api.twitter.com/2'
}

/**
 * Send an X DM (direct message). Live path requires X API v2 DM endpoints.
 */
export async function sendXDM({ participantId, text, bearerToken }) {
  const cfg = getXConfig()
  const token = bearerToken || cfg.bearerToken
  if (!participantId) throw Object.assign(new Error('participantId is required for X DM'), { code: 'MISSING_RECIPIENT' })
  if (!text?.trim()) throw Object.assign(new Error('text is required'), { code: 'MISSING_CONTENT' })

  if (cfg.provider === 'dev' || !isXEnabled()) {
    if (cfg.devAlwaysSuccess) {
      return {
        ok: true,
        provider: 'x_dev_simulator',
        provider_message_id: `x_dm_dev_${uuidv4().slice(0, 12)}`,
        participant_id: participantId,
        text: text.trim(),
        simulated: true,
      }
    }
    throw Object.assign(new Error('X dev mode configured to fail'), { code: 'DEV_FAILURE' })
  }

  // Live X API v2 DM conversation creation + message send.
  // Requires OAuth 1.0a user context or OAuth 2.0 with dm.write scope.
  const conversationRes = await fetch(`${xApiBase()}/dm_conversations`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      participant_id: participantId,
      message: { text: text.trim() },
    }),
  })

  const data = await conversationRes.json().catch(() => ({}))
  if (!conversationRes.ok) {
    const err = new Error(`X DM error (${conversationRes.status}): ${data?.detail || JSON.stringify(data).slice(0, 200)}`)
    err.code = data?.title || `X_DM_${conversationRes.status}`
    err.details = data
    throw err
  }

  return {
    ok: true,
    provider: 'x_api_v2',
    provider_message_id: data?.data?.dm_conversation_id || data?.data?.id || null,
    participant_id: participantId,
    text: text.trim(),
    simulated: false,
  }
}

/**
 * Reply to an X mention or public post. Public replies should never contain PII;
 * we encourage the user to move to DM.
 */
export async function replyToXMention({ tweetId, text, bearerToken }) {
  const cfg = getXConfig()
  const token = bearerToken || cfg.bearerToken
  if (!tweetId) throw Object.assign(new Error('tweetId is required'), { code: 'MISSING_TWEET_ID' })
  if (!text?.trim()) throw Object.assign(new Error('reply text is required'), { code: 'MISSING_CONTENT' })

  if (cfg.provider === 'dev' || !isXEnabled()) {
    if (cfg.devAlwaysSuccess) {
      return {
        ok: true,
        provider: 'x_dev_simulator',
        provider_message_id: `x_mention_dev_${uuidv4().slice(0, 12)}`,
        tweet_id: tweetId,
        text: text.trim(),
        simulated: true,
      }
    }
    throw Object.assign(new Error('X dev mode configured to fail'), { code: 'DEV_FAILURE' })
  }

  const res = await fetch(`${xApiBase()}/tweets`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ text: text.trim(), reply: { in_reply_to_tweet_id: tweetId } }),
  })

  const data = await res.json().catch(() => ({}))
  if (!res.ok) {
    const err = new Error(`X mention reply error (${res.status}): ${data?.detail || JSON.stringify(data).slice(0, 200)}`)
    err.code = data?.title || `X_MENTION_${res.status}`
    err.details = data
    throw err
  }

  return {
    ok: true,
    provider: 'x_api_v2',
    provider_message_id: data?.data?.id || null,
    tweet_id: tweetId,
    text: text.trim(),
    simulated: false,
  }
}

/**
 * Publish a tweet. Live path uses X API v2 `POST /2/tweets` with OAuth 2.0
 * bearer token (user context) plus optional media_ids from a prior upload.
 * Media upload uses v1.1 `media/upload.json` — the current caller supplies
 * already-uploaded media_ids. When no media_ids are provided the tweet is
 * text-only.
 *
 * Reference: https://developer.x.com/en/docs/x-api/tweets/manage-tweets/api-reference/post-tweets
 */
export async function publishXTweet({ text, mediaIds = [], replyToTweetId = null, bearerToken }) {
  const cfg = getXConfig()
  const token = bearerToken || cfg.bearerToken
  if (!text?.trim() && mediaIds.length === 0) {
    throw Object.assign(new Error('text or mediaIds is required'), { code: 'MISSING_CONTENT' })
  }
  const trimmed = String(text || '').trim().slice(0, 280)

  if (cfg.provider === 'dev' || !isXEnabled()) {
    if (cfg.devAlwaysSuccess) {
      const id = `x_tweet_dev_${uuidv4().slice(0, 12)}`
      return {
        ok: true,
        provider: 'x_dev_simulator',
        tweet_id: id,
        external_url: `https://x.com/dev/status/${id}`,
        text: trimmed,
        media_count: mediaIds.length,
        simulated: true,
      }
    }
    throw Object.assign(new Error('X dev mode configured to fail'), { code: 'DEV_FAILURE' })
  }

  const body = { text: trimmed }
  if (mediaIds.length > 0) body.media = { media_ids: mediaIds.slice(0, 4) }
  if (replyToTweetId) body.reply = { in_reply_to_tweet_id: String(replyToTweetId) }

  const res = await fetch(`${xApiBase()}/tweets`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  })
  const payload = await res.json().catch(() => ({}))
  if (!res.ok) {
    throw Object.assign(new Error(payload?.detail || payload?.title || `X tweet failed: ${res.status}`), {
      code: 'X_LIVE_ERROR',
      details: payload,
    })
  }
  const tweetId = payload?.data?.id
  return {
    ok: true,
    provider: 'x_api_v2',
    tweet_id: tweetId,
    external_url: tweetId ? `https://x.com/i/web/status/${tweetId}` : null,
    raw: payload,
  }
}

/**
 * Parse an X API v2 webhook payload (filtered stream or account activity).
 * Expected normalized shapes:
 *   { dm_events: [{ id, sender_id, text, created_at }] }
 *   { tweet_create_events: [{ id, text, user: { id, screen_name }, in_reply_to_status_id?, in_reply_to_user_id?, created_at }] }
 *   { mentions: [{ id, user_id, username, text, tweet_id, created_at }] }
 */
/**
 * Fetch public_metrics for a tweet.
 *
 * Docs: https://developer.x.com/en/docs/x-api/tweets/lookup/api-reference/get-tweets-id
 * Metrics returned: impression_count, retweet_count, reply_count, like_count,
 * quote_count, bookmark_count. Impression count needs elevated / Enterprise access.
 */
export async function fetchXInsights({ tweetId, bearerToken }) {
  const cfg = getXConfig()
  const token = bearerToken || cfg.bearerToken
  if (!tweetId) throw Object.assign(new Error('tweetId is required'), { code: 'MISSING_TWEET_ID' })

  if (cfg.provider === 'dev' || !isXEnabled() || !token) {
    return {
      impressions: 4300, reach: null, likes: 58, comments: 5, shares: 11, saves: 4, clicks: null,
      source: 'x_dev_simulator', simulated: true, fetched_at: new Date().toISOString(),
    }
  }

  const res = await fetch(`${xApiBase()}/tweets/${tweetId}?tweet.fields=public_metrics`, {
    headers: { Authorization: `Bearer ${token}` },
  })
  const data = await res.json().catch(() => ({}))
  if (!res.ok) {
    throw Object.assign(
      new Error(`X insights error (${res.status}): ${data?.detail || JSON.stringify(data).slice(0, 200)}`),
      { code: data?.title || `X_INSIGHTS_${res.status}`, details: data },
    )
  }
  const m = data?.data?.public_metrics || {}
  return {
    impressions: m.impression_count ?? null,
    reach: null,
    likes: m.like_count ?? null,
    comments: m.reply_count ?? null,
    shares: (m.retweet_count ?? 0) + (m.quote_count ?? 0),
    saves: m.bookmark_count ?? null,
    clicks: null,
    source: 'x_api_v2',
    simulated: false,
    fetched_at: new Date().toISOString(),
  }
}

export function parseIncomingXWebhook(payload) {
  const events = []
  const dmEvents = payload?.dm_events || []
  const tweetEvents = payload?.tweet_create_events || payload?.mentions || []

  for (const item of Array.isArray(dmEvents) ? dmEvents : [dmEvents]) {
    if (!item) continue
    events.push({
      type: 'dm',
      provider: 'x_api_v2',
      from: item.sender_id || item.participant_id || '',
      from_username: item.sender?.username || '',
      message_id: item.id || `x_dm_${uuidv4().slice(0, 12)}`,
      text: String(item.text || item.message?.text || '').trim(),
      timestamp: item.created_at ? String(item.created_at) : null,
    })
  }

  for (const item of Array.isArray(tweetEvents) ? tweetEvents : [tweetEvents]) {
    if (!item) continue
    const isMention =
      item.type === 'mention' ||
      item.in_reply_to_user_id ||
      (item.entities?.mentions || []).length > 0 ||
      item.mention
    if (isMention || item.tweet_id) {
      events.push({
        type: 'mention',
        provider: 'x_api_v2',
        from: item.user?.id || item.user_id || '',
        from_username: item.user?.screen_name || item.username || '',
        message_id: item.id || item.tweet_id || `x_mention_${uuidv4().slice(0, 12)}`,
        tweet_id: item.id || item.tweet_id || null,
        text: String(item.text || '').trim(),
        timestamp: item.created_at ? String(item.created_at) : null,
      })
    }
  }

  return events
}
