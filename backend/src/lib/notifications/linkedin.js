/**
 * LinkedIn dispatcher.
 *
 * LinkedIn has two surfaces we care about:
 *   1. Publishing UGC posts (text, article, image) via the LinkedIn API v2.
 *   2. Reading incoming comments on organization posts (via polling).
 *
 * For live posting you need:
 *   - A LinkedIn Developer app with r_organization_admin, w_organization_social,
 *     w_member_social, r_liteprofile scopes (varies by post target).
 *   - Either a personal author URN (urn:li:person:XXX) or an organization URN
 *     (urn:li:organization:XXX).
 *   - An OAuth 2.0 access token for that author.
 *
 * Env:
 *   LINKEDIN_PROVIDER=dev|linkedin_api      (default: dev)
 *   LINKEDIN_ACCESS_TOKEN                   (member-scoped or org-scoped OAuth token)
 *   LINKEDIN_AUTHOR_URN                     (default author, e.g. urn:li:organization:12345)
 *   LINKEDIN_API_VERSION=202405             (LI-Version header, YYYYMM)
 *   LINKEDIN_DEV_ALWAYS_SUCCESS=true        (default: true)
 */

import { v4 as uuidv4 } from 'uuid'

const REST_BASE = 'https://api.linkedin.com/rest'
const UGC_BASE = 'https://api.linkedin.com/v2'

export function getLinkedInConfig() {
  return {
    provider: process.env.LINKEDIN_PROVIDER || 'dev',
    accessToken: process.env.LINKEDIN_ACCESS_TOKEN || '',
    authorUrn: process.env.LINKEDIN_AUTHOR_URN || '',
    apiVersion: process.env.LINKEDIN_API_VERSION || '202405',
    devAlwaysSuccess: process.env.LINKEDIN_DEV_ALWAYS_SUCCESS !== 'false',
  }
}

export function isLinkedInEnabled() {
  const cfg = getLinkedInConfig()
  if (cfg.provider === 'dev') return true
  return Boolean(cfg.accessToken && cfg.authorUrn)
}

/**
 * Publish a LinkedIn post. Live path uses the /rest/posts endpoint (Marketing
 * Developer Platform). Supports:
 *   - Text-only: {commentary}
 *   - Image: {content: {media: {id: <asset urn>, altText}}}
 *   - Article link: {content: {article: {source, title, description}}}
 *
 * NOTE: Image posts require a prior asset upload (initialize + upload) which
 * we do NOT perform here. The `imageAssetUrn` should already be a registered
 * asset URN. Text and article posts work with just the caller args.
 */
export async function publishLinkedInPost({
  authorUrn,
  commentary,
  imageAssetUrn,
  articleUrl,
  articleTitle,
  articleDescription,
  visibility = 'PUBLIC',
  accessToken,
}) {
  const cfg = getLinkedInConfig()
  const author = authorUrn || cfg.authorUrn
  const token = accessToken || cfg.accessToken
  const text = String(commentary || '').trim()

  if (!text && !imageAssetUrn && !articleUrl) {
    throw Object.assign(new Error('commentary, imageAssetUrn, or articleUrl is required'), {
      code: 'MISSING_CONTENT',
    })
  }

  if (!token || !author) {
    const missing = [!token && 'LINKEDIN_ACCESS_TOKEN', !author && 'LINKEDIN_AUTHOR_URN'].filter(Boolean)
    throw Object.assign(
      new Error(`linkedin publishing requires ${missing.join(' and ')} to be set`),
      { code: 'PUBLISH_CREDENTIALS_MISSING' },
    )
  }

  if (!author) {
    throw Object.assign(new Error('authorUrn is required for LinkedIn publishing'), {
      code: 'MISSING_AUTHOR',
    })
  }

  const body = {
    author,
    commentary: text,
    visibility,
    distribution: {
      feedDistribution: 'MAIN_FEED',
      targetEntities: [],
      thirdPartyDistributionChannels: [],
    },
    lifecycleState: 'PUBLISHED',
    isReshareDisabledByAuthor: false,
  }

  if (imageAssetUrn) {
    body.content = { media: { id: imageAssetUrn, altText: text || 'Property listing' } }
  } else if (articleUrl) {
    body.content = {
      article: {
        source: articleUrl,
        title: articleTitle || 'Property listing',
        description: articleDescription || text || '',
      },
    }
  }

  const res = await fetch(`${REST_BASE}/posts`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      'LinkedIn-Version': cfg.apiVersion,
      'X-Restli-Protocol-Version': '2.0.0',
    },
    body: JSON.stringify(body),
  })
  const payload = await res.text()
  const parsed = (() => {
    try { return JSON.parse(payload) } catch { return null }
  })()

  if (!res.ok) {
    throw Object.assign(
      new Error(parsed?.message || `LinkedIn publish failed: ${res.status}`),
      { code: 'LINKEDIN_LIVE_ERROR', details: parsed || payload },
    )
  }

  const postUrn = res.headers.get('x-restli-id') || parsed?.id || null
  return {
    ok: true,
    provider: 'linkedin_rest',
    post_urn: postUrn,
    external_url: postUrn ? `https://linkedin.com/feed/update/${postUrn}` : null,
    raw: parsed || payload,
  }
}

/**
 * Reply to a comment on a LinkedIn UGC post.
 *
 *   POST /v2/socialActions/{shareUrn}/comments  {actor, message: {text}}
 */
/**
 * Fetch aggregate share statistics for a LinkedIn post.
 *
 * Docs: https://learn.microsoft.com/en-us/linkedin/marketing/community-management/shares/share-statistics
 * Requires organizationalEntity (author URN) + the share URN.
 */
export async function fetchLinkedInInsights({ shareUrn, authorUrn, accessToken }) {
  const cfg = getLinkedInConfig()
  const token = accessToken || cfg.accessToken
  const author = authorUrn || cfg.authorUrn
  if (!shareUrn) throw Object.assign(new Error('shareUrn is required'), { code: 'MISSING_SHARE_URN' })

  if (cfg.provider === 'dev' || !isLinkedInEnabled() || !token) {
    return {
      impressions: 950, reach: null, likes: 34, comments: 2, shares: 5, saves: null, clicks: 18,
      source: 'linkedin_dev_simulator', simulated: true, fetched_at: new Date().toISOString(),
    }
  }

  const path = `/organizationalEntityShareStatistics?q=organizationalEntity&organizationalEntity=${encodeURIComponent(author)}&shares[0]=${encodeURIComponent(shareUrn)}`
  const res = await fetch(`${REST_BASE}${path}`, {
    headers: {
      Authorization: `Bearer ${token}`,
      'LinkedIn-Version': cfg.apiVersion,
      'X-Restli-Protocol-Version': '2.0.0',
    },
  })
  const data = await res.json().catch(() => ({}))
  if (!res.ok) {
    throw Object.assign(
      new Error(`LinkedIn insights error (${res.status}): ${data?.message || JSON.stringify(data).slice(0, 200)}`),
      { code: `LINKEDIN_INSIGHTS_${res.status}`, details: data },
    )
  }
  const row = data?.elements?.[0]?.totalShareStatistics || {}
  return {
    impressions: row.impressionCount ?? null,
    reach: row.uniqueImpressionsCount ?? null,
    likes: row.likeCount ?? null,
    comments: row.commentCount ?? null,
    shares: row.shareCount ?? null,
    saves: null,
    clicks: row.clickCount ?? null,
    source: 'linkedin_share_statistics',
    simulated: false,
    fetched_at: new Date().toISOString(),
  }
}

export async function replyToLinkedInComment({ postUrn, parentCommentUrn, text, actorUrn, accessToken }) {
  const cfg = getLinkedInConfig()
  const actor = actorUrn || cfg.authorUrn
  const token = accessToken || cfg.accessToken
  if (!postUrn) throw Object.assign(new Error('postUrn is required'), { code: 'MISSING_POST' })
  if (!text?.trim()) throw Object.assign(new Error('reply text is required'), { code: 'MISSING_CONTENT' })

  if (cfg.provider === 'dev' || !isLinkedInEnabled()) {
    if (cfg.devAlwaysSuccess) {
      return {
        ok: true,
        provider: 'linkedin_dev_simulator',
        provider_message_id: `li_comment_dev_${uuidv4().slice(0, 12)}`,
        post_urn: postUrn,
        text: text.trim(),
        simulated: true,
      }
    }
    throw Object.assign(new Error('LinkedIn dev mode configured to fail'), { code: 'DEV_FAILURE' })
  }

  const body = {
    actor,
    message: { text: text.trim() },
  }
  if (parentCommentUrn) body.parentComment = parentCommentUrn

  const res = await fetch(`${UGC_BASE}/socialActions/${encodeURIComponent(postUrn)}/comments`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      'LinkedIn-Version': cfg.apiVersion,
      'X-Restli-Protocol-Version': '2.0.0',
    },
    body: JSON.stringify(body),
  })
  const payload = await res.json().catch(() => ({}))

  if (!res.ok) {
    throw Object.assign(
      new Error(payload?.message || `LinkedIn comment failed: ${res.status}`),
      { code: 'LINKEDIN_LIVE_ERROR', details: payload },
    )
  }
  return {
    ok: true,
    provider: 'linkedin_rest',
    provider_message_id: payload?.id || null,
    raw: payload,
  }
}

/**
 * Parse a LinkedIn poll payload (LinkedIn doesn't push a webhook the way Meta
 * does; the platform polls for new comments on our posts and hands us the
 * page shape from /v2/socialActions/{shareUrn}/comments).
 *
 * Expected shape from the poller:
 *   { elements: [{ id, actor, message: { text }, created: { time } }] }
 */
export function parseIncomingLinkedInPoll(payload) {
  const events = []
  const items = Array.isArray(payload?.elements) ? payload.elements : []
  for (const item of items) {
    events.push({
      type: 'comment',
      provider: 'linkedin',
      from: item.actor || '',
      message_id: item.id || `li_comment_${uuidv4().slice(0, 12)}`,
      text: String(item.message?.text || '').trim(),
      timestamp: item.created?.time ? String(item.created.time) : null,
    })
  }
  return events
}
