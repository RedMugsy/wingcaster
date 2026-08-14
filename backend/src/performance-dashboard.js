/**
 * Per-listing Performance dashboard (Phase 4.9).
 *
 * Aggregates data across every channel this listing has been published to:
 *   - distributions (current + historical insights from distribution_insight_snapshots)
 *   - conversation_messages (public comments + private DMs tied to this
 *     listing via raw_payload external ids matching distribution external_ids)
 *   - inquiries (originated from social routing per Phase 4.7 process router)
 *   - contacts (unique contacts who engaged with the listing via any channel)
 *   - viewings (from api.createViewing / bookViewing flows)
 *   - closed_transactions (Phase 6.5 outcome capture)
 *
 * Returns:
 *   - all_channels: aggregate stat block (impressions, views, clicks,
 *     engagements, average views per post, unique contacts, funnel counts)
 *   - per_channel: array of per-channel stat blocks (each identical shape)
 *   - time_series: daily snapshots per channel for the last N days (from
 *     distribution_insight_snapshots)
 *   - funnel: per-channel breakdown Views → Comments → DMs → Inquiries
 *     → Viewings → Closed
 *
 * All computation is read-only. Owner-scoped.
 */

import { findAll, findOne } from './db.js'

const DEFAULT_TIME_SERIES_DAYS = 30

/**
 * Resolve the full performance dashboard payload for a listing.
 * Returns { error: 'msg' } on auth/not-found — caller maps to HTTP code.
 */
export async function resolveListingPerformance(listingId, agentId, { days = DEFAULT_TIME_SERIES_DAYS } = {}) {
  const listing = await findOne('properties', (p) => p.id === listingId)
  if (!listing) return { error: 'Listing not found' }
  if (listing.agent_id !== agentId) return { error: 'Only the listing owner can view its performance' }

  // Distributions (published posts across every platform)
  const distributions = await findAll(
    'distributions',
    (d) => d.property_id === listingId,
  )
  const publishedDists = distributions.filter((d) => d.status === 'published' && d.external_id)
  const distByExternalId = new Map(publishedDists.map((d) => [String(d.external_id), d]))
  const distIds = new Set(publishedDists.map((d) => d.id))

  // Snapshots for time-series
  const snapshots = distIds.size
    ? await findAll('distribution_insight_snapshots', (s) => distIds.has(s.distribution_id))
    : []

  // Public comment channels tied to this listing (via distribution external_id match)
  const publicCommentChannels = new Set([
    'instagram_comment', 'facebook_comment', 'tiktok_comment',
    'x_mention', 'linkedin_comment',
  ])
  const dmChannels = new Set([
    'instagram_dm', 'facebook_messenger', 'tiktok_dm', 'x_dm', 'whatsapp', 'sms',
  ])

  // All messages whose raw_payload references one of our external_ids
  const allInboundMessages = await findAll('conversation_messages', (m) => {
    if (m.direction !== 'inbound') return false
    const isComment = publicCommentChannels.has(m.channel)
    const isDm = dmChannels.has(m.channel)
    if (!isComment && !isDm) return false
    if (isComment) {
      const raw = m.metadata?.raw_payload || {}
      const candidates = [raw.media_id, raw.post_id, raw.post_urn, raw.tweet_id, raw.video_id]
        .filter(Boolean).map(String)
      return candidates.some((c) => distByExternalId.has(c))
    }
    // For DMs: match via conversation → contact → any prior comment on this listing
    // (best-effort — the conversation may not directly reference an external_id).
    // This is captured downstream when we walk unique contacts.
    return false
  })

  // Contact set — every contact who has commented or DM'd about this listing
  const commentContactIds = new Set()
  for (const m of allInboundMessages) {
    const conv = m.conversation_id
    if (conv) {
      const conversation = await findOne('conversations', (c) => c.id === conv)
      if (conversation?.contact_id) commentContactIds.add(conversation.contact_id)
    }
  }

  // DMs from contacts who are ALSO in commentContactIds — attributed to this listing
  const attributedDmMessages = commentContactIds.size
    ? await findAll('conversation_messages', (m) => {
      if (m.direction !== 'inbound') return false
      if (!dmChannels.has(m.channel)) return false
      // We'll attribute by checking the conversation's contact belongs to our set
      return true
    })
    : []
  const attributedDms = []
  for (const m of attributedDmMessages) {
    const conversation = await findOne('conversations', (c) => c.id === m.conversation_id)
    if (conversation?.contact_id && commentContactIds.has(conversation.contact_id)) {
      attributedDms.push(m)
    }
  }

  // Inquiries this listing has generated (from Phase 4.7 router + any manual capture)
  const inquiries = await findAll('inquiries', (i) => i.property_id === listingId)

  // Viewings for this listing
  const viewings = await findAll('viewings', (v) => v.property_id === listingId || v.listing_id === listingId)

  // Closed transactions
  const closedTransactions = await findAll(
    'closed_transactions',
    (t) => t.listing_id === listingId && t.agent_id === agentId,
  )

  // ================ Aggregate across all channels ================
  const totals = zeroMetricBlock()
  for (const d of publishedDists) {
    totals.impressions += Number(d.impressions || d.insights?.impressions || 0)
    totals.reach       += Number(d.reach || d.insights?.reach || 0)
    totals.likes       += Number(d.likes || d.insights?.likes || 0)
    totals.comments    += Number(d.comments_count || d.insights?.comments || 0)
    totals.shares      += Number(d.shares || d.insights?.shares || 0)
    totals.saves       += Number(d.saves || d.insights?.saves || 0)
    totals.clicks      += Number(d.clicks || d.insights?.clicks || 0)
  }
  totals.engagements = totals.likes + totals.comments + totals.shares + totals.saves
  totals.messages = allInboundMessages.length + attributedDms.length
  totals.inquiries = inquiries.length
  totals.viewings_scheduled = viewings.length
  totals.closes = closedTransactions.length
  totals.contacts = commentContactIds.size
  totals.avg_views_per_post = publishedDists.length ? Math.round(totals.impressions / publishedDists.length) : 0

  // ================ Per-channel breakdown ================
  const channelKeys = Array.from(new Set(publishedDists.map((d) => d.platform))).sort()
  const perChannel = channelKeys.map((platform) => {
    const dists = publishedDists.filter((d) => d.platform === platform)
    const block = zeroMetricBlock()
    for (const d of dists) {
      block.impressions += Number(d.impressions || d.insights?.impressions || 0)
      block.reach       += Number(d.reach || d.insights?.reach || 0)
      block.likes       += Number(d.likes || d.insights?.likes || 0)
      block.comments    += Number(d.comments_count || d.insights?.comments || 0)
      block.shares      += Number(d.shares || d.insights?.shares || 0)
      block.saves       += Number(d.saves || d.insights?.saves || 0)
      block.clicks      += Number(d.clicks || d.insights?.clicks || 0)
    }
    block.engagements = block.likes + block.comments + block.shares + block.saves
    block.published_posts = dists.length
    block.avg_views_per_post = dists.length ? Math.round(block.impressions / dists.length) : 0

    // Messages attributed to this channel specifically
    const channelCommentTypes = channelPublicCommentTypesFor(platform)
    const channelDmTypes = channelDmTypesFor(platform)
    const channelInboundComments = allInboundMessages.filter((m) => channelCommentTypes.has(m.channel))
    const channelInboundDms = attributedDms.filter((m) => channelDmTypes.has(m.channel))
    block.messages = channelInboundComments.length + channelInboundDms.length

    // Inquiries attributed to this channel (router-created inquiries store
    // the source channel in inquiry.channel)
    block.inquiries = inquiries.filter((i) => channelInquiryMatch(i.channel, platform)).length

    return { platform, ...block }
  })

  // ================ Funnel per channel ================
  const funnel = perChannel.map((c) => ({
    platform: c.platform,
    views: c.impressions,
    engagements: c.engagements,
    clicks: c.clicks,
    inquiries: c.inquiries,
    viewings_scheduled: viewings.filter((v) => (v.source_channel || v.channel || '') === c.platform).length,
    closes: closedTransactions.filter((t) => (t.attribution_source || '').includes(c.platform)).length,
  }))

  // ================ Time-series (daily bins per channel) ================
  const timeSeries = buildTimeSeries(snapshots, channelKeys, days)

  return {
    listing_id: listingId,
    generated_at: new Date().toISOString(),
    all_channels: totals,
    per_channel: perChannel,
    funnel,
    time_series: timeSeries,
    counts: {
      published_posts: publishedDists.length,
      channels: channelKeys.length,
      snapshot_days: timeSeries.days,
      snapshot_points: snapshots.length,
      contacts_reached: commentContactIds.size,
    },
  }
}

/* ------------------------------ helpers ------------------------------ */

function zeroMetricBlock() {
  return {
    impressions: 0,
    reach: 0,
    likes: 0,
    comments: 0,
    shares: 0,
    saves: 0,
    clicks: 0,
    engagements: 0,
    messages: 0,
    inquiries: 0,
    viewings_scheduled: 0,
    closes: 0,
    contacts: 0,
    avg_views_per_post: 0,
    published_posts: 0,
  }
}

function channelPublicCommentTypesFor(platform) {
  const map = {
    instagram: new Set(['instagram_comment']),
    facebook: new Set(['facebook_comment']),
    tiktok: new Set(['tiktok_comment']),
    x: new Set(['x_mention']),
    linkedin: new Set(['linkedin_comment']),
  }
  return map[platform] || new Set()
}

function channelDmTypesFor(platform) {
  const map = {
    instagram: new Set(['instagram_dm']),
    facebook: new Set(['facebook_messenger']),
    tiktok: new Set(['tiktok_dm']),
    x: new Set(['x_dm']),
    whatsapp: new Set(['whatsapp']),
  }
  return map[platform] || new Set()
}

function channelInquiryMatch(inquiryChannel, platform) {
  if (!inquiryChannel) return false
  const c = String(inquiryChannel).toLowerCase()
  return c === platform || c.startsWith(`${platform}_`)
}

/**
 * Bucket snapshots into daily bins per channel over the last `days` days.
 * Returns { days, channels: { <platform>: [{date, impressions, engagements, clicks}] } }
 */
function buildTimeSeries(snapshots, channelKeys, days) {
  const now = Date.now()
  const dayMs = 24 * 3600 * 1000
  const startMs = now - (days - 1) * dayMs

  // Initialise every day for every channel to zero so the chart has a full x-axis.
  const dayKeys = []
  for (let i = 0; i < days; i++) {
    const d = new Date(startMs + i * dayMs)
    dayKeys.push(d.toISOString().slice(0, 10))
  }
  const channels = {}
  for (const key of channelKeys) {
    channels[key] = dayKeys.map((date) => ({
      date, impressions: 0, engagements: 0, clicks: 0, comments: 0, likes: 0, shares: 0, saves: 0,
      // Latest snapshot on that day wins (metrics are cumulative from the platform's side)
      _has_snapshot: false,
    }))
  }

  // For each snapshot, place it in the right (channel, day) bin. Because
  // platform APIs return cumulative counters, we take the MAX value seen
  // for a given day (last snapshot before EOD).
  for (const s of snapshots) {
    if (!channels[s.platform]) continue
    const day = new Date(s.snapshot_at).toISOString().slice(0, 10)
    const idx = dayKeys.indexOf(day)
    if (idx < 0) continue
    const bin = channels[s.platform][idx]
    bin.impressions = Math.max(bin.impressions, Number(s.impressions) || 0)
    bin.likes       = Math.max(bin.likes,       Number(s.likes)       || 0)
    bin.comments    = Math.max(bin.comments,    Number(s.comments)    || 0)
    bin.shares      = Math.max(bin.shares,      Number(s.shares)      || 0)
    bin.saves       = Math.max(bin.saves,       Number(s.saves)       || 0)
    bin.clicks      = Math.max(bin.clicks,      Number(s.clicks)      || 0)
    bin.engagements = bin.likes + bin.comments + bin.shares + bin.saves
    bin._has_snapshot = true
  }

  // Carry-forward: for any day without a snapshot, propagate the previous
  // day's values (a cumulative counter shouldn't reset).
  for (const key of Object.keys(channels)) {
    let last = { impressions: 0, likes: 0, comments: 0, shares: 0, saves: 0, clicks: 0, engagements: 0 }
    for (const bin of channels[key]) {
      if (bin._has_snapshot) {
        last = { ...bin }
      } else {
        bin.impressions = last.impressions
        bin.likes = last.likes
        bin.comments = last.comments
        bin.shares = last.shares
        bin.saves = last.saves
        bin.clicks = last.clicks
        bin.engagements = last.engagements
      }
      delete bin._has_snapshot
    }
  }

  return { days, channels }
}
