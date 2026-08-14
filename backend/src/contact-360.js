/**
 * Contact 360 — unified per-contact conversation view + AI lead summary
 * + weighted lead score + AI-suggested next steps.
 *
 * Closes the Comms Orchestrator loop: today an agent can see engagement
 * per listing / per channel / per category (Phase 4.6 + 4.7); this
 * module lets them see EVERYTHING for one contact across every channel
 * on a single screen with an AI-synthesised profile + action list.
 *
 * Depends on:
 *   - Phase 4.7 classifier (per-message categories already stored)
 *   - Phase 3 aiAdapter (multi-provider fallback)
 *   - No new external services or dependencies
 */

import { v4 as uuidv4 } from 'uuid'
import { findAll, findOne, insert, update } from './db.js'

/* ============================================================================
 * Lead-score weighting — deterministic, no AI.
 *
 * Each Phase-4.7 category has a signal weight. We sum across every inbound
 * message the contact has sent, normalise against total message count so
 * chatty leads with many low-signal messages don't dominate active leads
 * with fewer high-signal ones, and clamp to [0, 100].
 *
 * These weights are the "opinion" of the score — tuneable per tenant later
 * (would live in the routing_configs pattern from Phase 4.7b).
 * ========================================================================== */

export const CATEGORY_WEIGHTS = {
  hot_lead:    10,
  investor:     8,
  interest:     6,
  question:     3,
  testimonial:  3,
  referral:     2,
  reaction:     1,
  general:      0.5,
  objection:   -2,
  complaint:   -5,
  spam:        -2,
}

const SCORE_MAX_RAW = 60  // above this the lead is "very hot" — cap so any single message can't dominate

const PUBLIC_COMMENT_CHANNELS = new Set([
  'instagram_comment',
  'facebook_comment',
  'tiktok_comment',
  'x_mention',
  'linkedin_comment',
])

/**
 * Compute lead score for a contact. Pure DB read + weighted arithmetic.
 * Never fails — returns 0 if nothing found.
 */
export async function computeLeadScore(contactId) {
  const conversations = await findAll('conversations', (c) => c.contact_id === contactId)
  if (!conversations.length) {
    return { score: 0, message_count: 0, category_counts: {}, weighted_sum: 0, reasoning: 'No conversations recorded yet.' }
  }
  const convIds = new Set(conversations.map((c) => c.id))
  const messages = await findAll(
    'conversation_messages',
    (m) => convIds.has(m.conversation_id) && m.direction === 'inbound',
  )
  if (!messages.length) {
    return { score: 0, message_count: 0, category_counts: {}, weighted_sum: 0, reasoning: 'No inbound messages yet.' }
  }

  const counts = {}
  let weightedSum = 0
  for (const m of messages) {
    const cat = m.category || 'general'
    counts[cat] = (counts[cat] || 0) + 1
    weightedSum += CATEGORY_WEIGHTS[cat] ?? 0
  }
  // Normalisation: bounded raw sum → 0..100. Chatty low-signal contacts
  // don't out-score focused high-signal ones because we cap the raw sum
  // rather than dividing by message count (which would penalise engagement).
  const clamped = Math.max(0, Math.min(SCORE_MAX_RAW, weightedSum))
  const score = Math.round((clamped / SCORE_MAX_RAW) * 100)

  const reasoning = buildScoreReasoning(counts, weightedSum, score)
  return { score, message_count: messages.length, category_counts: counts, weighted_sum: weightedSum, reasoning }
}

function buildScoreReasoning(counts, weightedSum, score) {
  const parts = []
  const top = Object.entries(counts)
    .sort(([, a], [, b]) => b - a)
    .filter(([cat]) => cat !== 'general')
    .slice(0, 3)
  if (top.length === 0) {
    return `Score ${score}/100 based on ${Object.values(counts).reduce((a, b) => a + b, 0)} messages — no high-signal categories yet.`
  }
  for (const [cat, n] of top) {
    parts.push(`${n} × ${cat}`)
  }
  return `Score ${score}/100 — top signals: ${parts.join(', ')} (weighted sum ${weightedSum.toFixed(1)}).`
}

/* ============================================================================
 * Unified conversation feed for a contact.
 *
 * Groups messages by channel and by listing so the frontend can render
 * either a chronological interleaved view OR filter by channel/listing tab.
 * Each message carries its Phase-4.7 category + confidence + suggested_reply.
 * ========================================================================== */

export async function resolveContact360Feed(contactId, requesterAgentId) {
  const contact = await findOne('contacts', (c) => c.id === contactId)
  if (!contact) return { error: 'Contact not found' }
  if (contact.assigned_agent_id !== requesterAgentId) {
    return { error: 'Not authorised for this contact' }
  }

  const conversations = await findAll('conversations', (c) => c.contact_id === contactId)
  if (!conversations.length) {
    return {
      contact,
      channels: [],
      listings: [],
      messages: [],
      conversation_ids: [],
      message_count: 0,
    }
  }

  const convIds = new Set(conversations.map((c) => c.id))
  const messages = await findAll('conversation_messages', (m) => convIds.has(m.conversation_id))

  // For public-comment messages, resolve which listing they were on by
  // matching raw_payload external ids back to distributions (same lookup
  // as the Comments Section on the Listing Profile — Phase 4.6c).
  const dists = await findAll('distributions', (d) => d.agent_id === requesterAgentId && d.status === 'published' && d.external_id)
  const distByExternalId = new Map()
  for (const d of dists) distByExternalId.set(String(d.external_id), d)

  const listingIds = new Set()
  const enriched = messages.map((m) => {
    let listing_id = null
    let platform = null
    if (PUBLIC_COMMENT_CHANNELS.has(m.channel)) {
      const raw = m.metadata?.raw_payload || {}
      const externalId = [raw.media_id, raw.post_id, raw.post_urn, raw.tweet_id, raw.video_id]
        .find((c) => c && distByExternalId.has(String(c)))
      if (externalId) {
        const dist = distByExternalId.get(String(externalId))
        listing_id = dist?.property_id || null
        platform = dist?.platform || null
        if (listing_id) listingIds.add(listing_id)
      }
    }
    return {
      id: m.id,
      conversation_id: m.conversation_id,
      channel: m.channel,
      platform,
      listing_id,
      direction: m.direction,
      content: m.content,
      created_at: m.created_at,
      status: m.status,
      author_name: m.metadata?.raw_payload?.from_username || null,
      category: m.category || null,
      sentiment: m.sentiment || null,
      category_confidence: m.category_confidence ?? null,
      suggested_reply: m.suggested_reply || null,
      needs_agent_attention: !!m.needs_agent_attention,
    }
  })

  const listings = await Promise.all(
    Array.from(listingIds).map(async (id) => {
      const p = await findOne('properties', (x) => x.id === id)
      return p ? { id: p.id, title: p.title, city: p.city, price: p.price, price_unit: p.price_unit } : null
    }),
  )

  // Unique channels for the tab bar, ordered by most-recent activity.
  const channelActivity = new Map()
  for (const m of enriched) {
    const at = new Date(m.created_at).getTime()
    if (!channelActivity.has(m.channel) || channelActivity.get(m.channel) < at) {
      channelActivity.set(m.channel, at)
    }
  }
  const channels = Array.from(channelActivity.entries())
    .sort(([, a], [, b]) => b - a)
    .map(([ch]) => ch)

  enriched.sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime())

  return {
    contact,
    channels,
    listings: listings.filter(Boolean),
    conversations,
    conversation_ids: Array.from(convIds),
    messages: enriched,
    message_count: enriched.length,
  }
}

/* ============================================================================
 * AI-generated lead summary + next steps.
 *
 * Cached in the contact_lead_summaries collection (one row per contact).
 * Stale detection is deterministic — if inbound message count grew by 5+
 * OR a high-signal category message landed after generation, we mark stale.
 * The frontend can show cached-with-stale-flag while the user optionally
 * hits a refresh button to regenerate synchronously.
 * ========================================================================== */

const STALE_MESSAGE_DELTA = 5
const STALE_HOURS = 72
const HIGH_SIGNAL_CATEGORIES = new Set(['hot_lead', 'complaint', 'objection', 'investor'])

export async function getCachedLeadSummary(contactId) {
  const rows = await findAll('contact_lead_summaries', (r) => r.contact_id === contactId)
  if (!rows.length) return null
  return rows.sort((a, b) => new Date(b.generated_at).getTime() - new Date(a.generated_at).getTime())[0]
}

export async function isSummaryStale(cached, currentMessageCount, contactId) {
  if (!cached) return true
  const generatedAt = new Date(cached.generated_at).getTime()
  const ageHours = (Date.now() - generatedAt) / (1000 * 3600)
  if (ageHours > STALE_HOURS) return true
  const delta = currentMessageCount - (cached.message_count_at_generation || 0)
  if (delta >= STALE_MESSAGE_DELTA) return true
  // High-signal message since generation?
  const conversations = await findAll('conversations', (c) => c.contact_id === contactId)
  const convIds = new Set(conversations.map((c) => c.id))
  const recentHigh = await findAll('conversation_messages', (m) =>
    convIds.has(m.conversation_id)
    && m.direction === 'inbound'
    && HIGH_SIGNAL_CATEGORIES.has(m.category)
    && new Date(m.created_at).getTime() > generatedAt,
  )
  return recentHigh.length > 0
}

/**
 * Get lead summary — returns cached if present. Never triggers generation.
 * Includes staleness flag so the UI can nudge for refresh.
 */
export async function getLeadSummary({ contactId, requesterAgentId }) {
  const contact = await findOne('contacts', (c) => c.id === contactId)
  if (!contact) return { error: 'Contact not found' }
  if (contact.assigned_agent_id !== requesterAgentId) return { error: 'Not authorised' }

  const [scoreBundle, cached] = await Promise.all([
    computeLeadScore(contactId),
    getCachedLeadSummary(contactId),
  ])
  const stale = await isSummaryStale(cached, scoreBundle.message_count, contactId)

  return {
    contact_id: contactId,
    score: scoreBundle,
    summary: cached ? {
      text: cached.summary_text,
      next_steps: cached.next_steps || [],
      generated_at: cached.generated_at,
      provider: cached.provider,
      message_count_at_generation: cached.message_count_at_generation,
      is_stale: stale,
    } : null,
    has_cached: Boolean(cached),
    is_stale: stale,
  }
}

/**
 * Force regeneration of the AI summary + next steps. Synchronous — takes
 * a few seconds. Persists the new cache row.
 */
export async function regenerateLeadSummary({ contactId, requesterAgentId, aiAdapter, provider, logger }) {
  const contact = await findOne('contacts', (c) => c.id === contactId)
  if (!contact) return { error: 'Contact not found' }
  if (contact.assigned_agent_id !== requesterAgentId) return { error: 'Not authorised' }
  if (!aiAdapter) return { error: 'AI adapter not available' }

  const feed = await resolveContact360Feed(contactId, requesterAgentId)
  if (feed.error) return { error: feed.error }
  const scoreBundle = await computeLeadScore(contactId)

  const summary = await generateSummaryWithAi({ feed, scoreBundle, aiAdapter, provider, logger })
  const nextSteps = await generateNextStepsWithAi({ feed, scoreBundle, summary, aiAdapter, provider, logger })

  const row = {
    id: uuidv4(),
    contact_id: contactId,
    agent_id: requesterAgentId,
    summary_text: summary.text,
    next_steps: nextSteps.steps,
    lead_score_at_generation: scoreBundle.score,
    message_count_at_generation: scoreBundle.message_count,
    provider: summary.provider || provider || 'unknown',
    generated_at: new Date().toISOString(),
  }
  await insert('contact_lead_summaries', row)

  return {
    contact_id: contactId,
    score: scoreBundle,
    summary: {
      text: row.summary_text,
      next_steps: row.next_steps,
      generated_at: row.generated_at,
      provider: row.provider,
      message_count_at_generation: row.message_count_at_generation,
      is_stale: false,
    },
    has_cached: true,
    is_stale: false,
  }
}

/* ------------------------------ AI generators ---------------------------- */

async function generateSummaryWithAi({ feed, scoreBundle, aiAdapter, provider, logger }) {
  const messagesBlock = feed.messages
    .filter((m) => m.direction === 'inbound')
    .slice(-40) // last 40 inbound messages max — prompt-length guard
    .map((m) => {
      const listingHint = m.listing_id
        ? ` [on listing "${feed.listings.find((l) => l.id === m.listing_id)?.title || m.listing_id}"]`
        : ''
      const catHint = m.category ? ` [${m.category}]` : ''
      return `- ${m.channel}${listingHint}${catHint} @ ${m.created_at.slice(0, 10)}: ${String(m.content || '').slice(0, 200)}`
    })
    .join('\n')

  const listingsBlock = feed.listings.length
    ? feed.listings.map((l) => `  - ${l.title} (${l.city || 'n/a'})`).join('\n')
    : '  (none engaged with directly)'

  const prompt = `You are a senior real-estate CRM analyst. Write a factual 2-4 sentence
profile of this lead based on their messages across all channels. Focus on:
who they are, what they want, budget or investment signals, which listings
they have engaged with, and their communication preferences. Do NOT invent
details. Do NOT offer next-steps advice — that comes in a separate call.

Contact identity:
  Name:  ${feed.contact?.name || 'Unknown'}
  Email: ${feed.contact?.email || '(none)'}
  Phone: ${feed.contact?.phone || '(none)'}
  Tags:  ${(feed.contact?.tags || []).join(', ') || '(none)'}
  Lead score (deterministic, 0-100): ${scoreBundle.score}
  Category counts across inbound messages: ${JSON.stringify(scoreBundle.category_counts)}

Listings this lead has engaged with:
${listingsBlock}

Inbound messages (up to the last 40, chronological):
${messagesBlock || '(none)'}

Return exactly 2-4 sentences. Plain text. No quotes, no bullets, no preface.`

  let text = ''
  try {
    if (typeof aiAdapter.classifyText === 'function') {
      text = await aiAdapter.classifyText({ prompt, provider })
    } else if (typeof aiAdapter.generateMarketContextSentence === 'function') {
      const r = await aiAdapter.generateMarketContextSentence({ prompt, provider })
      text = r?.sentence || (typeof r === 'string' ? r : '')
    }
  } catch (err) {
    logger?.warn({ err: err.message, contactId: feed.contact?.id }, 'Lead summary AI generation failed')
    text = ''
  }
  const cleaned = String(text || '').trim().replace(/^["']|["']$/g, '')
  return {
    text: cleaned.length > 20
      ? cleaned.slice(0, 1200)
      : buildDeterministicSummaryFallback(feed, scoreBundle),
    provider: provider || 'unknown',
  }
}

function buildDeterministicSummaryFallback(feed, scoreBundle) {
  const name = feed.contact?.name || 'This lead'
  const channelList = feed.channels.slice(0, 3).join(', ')
  const listingCount = feed.listings.length
  const cats = scoreBundle.category_counts
  const signals = []
  if (cats.hot_lead) signals.push(`${cats.hot_lead} explicit buy-intent messages`)
  if (cats.interest) signals.push(`${cats.interest} price/availability questions`)
  if (cats.investor) signals.push(`${cats.investor} investor-language questions`)
  if (cats.question) signals.push(`${cats.question} general questions`)
  if (cats.objection || cats.complaint) signals.push(`${(cats.objection || 0) + (cats.complaint || 0)} concerns to address`)
  const signalStr = signals.length ? signals.join(', ') : 'no strong signals yet'
  return `${name} has engaged across ${feed.channels.length} channel(s) (${channelList || 'none'}) and expressed interest in ${listingCount} listing(s). Their message history shows ${signalStr}. Lead score is ${scoreBundle.score}/100.`
}

const NEXT_STEP_ACTIONS = [
  'send_template_reply',
  'schedule_viewing',
  'send_property_match',
  'follow_up_pending_question',
  'escalate_to_manager',
  'add_to_campaign',
  'nurture_wait',
]

async function generateNextStepsWithAi({ feed, scoreBundle, summary, aiAdapter, provider, logger }) {
  const inboundSummary = feed.messages
    .filter((m) => m.direction === 'inbound')
    .slice(-15)
    .map((m) => `- [${m.category || 'general'}] ${String(m.content || '').slice(0, 150)}`)
    .join('\n')

  const listingsBlock = feed.listings.length
    ? feed.listings.map((l) => `  - id=${l.id} : ${l.title}`).join('\n')
    : '  (no listings engaged)'

  const prompt = `You are a real-estate CRM assistant. Given this lead's profile and
recent messages, output STRICTLY VALID JSON with 1-3 recommended next actions.

Each action must be one of these types EXACTLY:
${NEXT_STEP_ACTIONS.map((a) => `  - ${a}`).join('\n')}

Do NOT invent new action types. Do NOT invent listing IDs — only reference
listings from the list below. Do NOT invent facts about the lead.

Lead:
${summary?.text || feed.contact?.name || 'Unknown'}
Score: ${scoreBundle.score}/100

Listings this lead has engaged with:
${listingsBlock}

Last inbound messages:
${inboundSummary || '(none)'}

Return JSON in this exact shape:
{
  "steps": [
    { "action": "<one of the actions above>",
      "reason": "<one short sentence justifying it>",
      "params": {
        "listing_id": "<listing id from the list above OR null>",
        "template_hint": "<short natural-language template hint OR null>",
        "priority": "urgent|high|normal|low"
      }
    }
  ]
}

Rules:
- If lead score >= 70 or last message is category=hot_lead → include either schedule_viewing or send_template_reply as the FIRST step
- If last message has category=complaint → escalate_to_manager MUST be included
- If there are unanswered category=question messages → include follow_up_pending_question
- If lead score < 15 and no recent hot-signal messages → nurture_wait may be the only step
- No more than 3 steps. Fewer is better than filler.`

  let text = ''
  try {
    if (typeof aiAdapter.classifyText === 'function') {
      text = await aiAdapter.classifyText({ prompt, provider })
    } else if (typeof aiAdapter.generateMarketContextSentence === 'function') {
      const r = await aiAdapter.generateMarketContextSentence({ prompt, provider })
      text = r?.sentence || (typeof r === 'string' ? r : '')
    }
  } catch (err) {
    logger?.warn({ err: err.message, contactId: feed.contact?.id }, 'Next-steps AI generation failed')
  }

  const parsed = safeParseSteps(text)
  if (parsed?.steps?.length) return { steps: parsed.steps.slice(0, 3), provider }

  // Deterministic fallback so the frontend always has SOMETHING actionable.
  return { steps: buildDeterministicNextStepsFallback(feed, scoreBundle), provider }
}

function safeParseSteps(text) {
  if (!text) return null
  const trimmed = String(text).trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '')
  try {
    const obj = JSON.parse(trimmed)
    if (!Array.isArray(obj?.steps)) return null
    return {
      steps: obj.steps
        .filter((s) => s && NEXT_STEP_ACTIONS.includes(s.action))
        .map((s) => ({
          action: s.action,
          reason: String(s.reason || '').slice(0, 220),
          params: {
            listing_id: s.params?.listing_id || null,
            template_hint: s.params?.template_hint || null,
            priority: ['urgent', 'high', 'normal', 'low'].includes(s.params?.priority) ? s.params.priority : 'normal',
          },
        })),
    }
  } catch {
    return null
  }
}

function buildDeterministicNextStepsFallback(feed, scoreBundle) {
  const steps = []
  const cats = scoreBundle.category_counts
  const primaryListing = feed.listings[0] || null
  if (cats.complaint) {
    steps.push({
      action: 'escalate_to_manager',
      reason: 'Complaint signal detected — human handling required, do not auto-reply.',
      params: { listing_id: primaryListing?.id || null, template_hint: null, priority: 'urgent' },
    })
  }
  if (scoreBundle.score >= 70 || cats.hot_lead) {
    steps.push({
      action: 'schedule_viewing',
      reason: 'High buy-intent signal — propose a viewing on the highest-engagement listing.',
      params: { listing_id: primaryListing?.id || null, template_hint: null, priority: 'urgent' },
    })
  }
  if (cats.question && steps.length < 3) {
    steps.push({
      action: 'follow_up_pending_question',
      reason: 'Lead has asked one or more questions — reply with the answer.',
      params: { listing_id: primaryListing?.id || null, template_hint: null, priority: 'high' },
    })
  }
  if (steps.length === 0) {
    steps.push({
      action: 'nurture_wait',
      reason: 'No strong signal yet — keep in nurture flow, revisit on next inbound.',
      params: { listing_id: null, template_hint: null, priority: 'low' },
    })
  }
  return steps.slice(0, 3)
}

export { PUBLIC_COMMENT_CHANNELS }
