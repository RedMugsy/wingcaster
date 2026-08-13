/**
 * Process router — main dispatcher.
 *
 * Consumes a classified conversation_messages row (public comment channel)
 * and routes it to the right downstream process based on the category and
 * the tenant's routing_config. Records every routing decision in the
 * comment_routings audit log so agencies can trace exactly what happened
 * per comment.
 *
 * Route decisions:
 *   - Never route DMs (only public comment channels)
 *   - Never route messages with `category_source === 'manual'` (agent
 *     override — assume the agent will handle it)
 *   - Skip routes where routeConfig.enabled === false
 *   - Skip routes where message.category_confidence < routeConfig.min_confidence
 */

import { v4 as uuidv4 } from 'uuid'
import { findOne, findAll, insert, update } from '../../db.js'
import { getHandlerForCategory } from './handlers.js'
import { loadRoutingConfig } from './config.js'

const PUBLIC_COMMENT_CHANNELS = new Set([
  'instagram_comment',
  'facebook_comment',
  'tiktok_comment',
  'x_mention',
  'linkedin_comment',
])

/**
 * Route a single message. Idempotent per (message_id, category, category_source)
 * — running the router twice for the same classification is a no-op after the
 * first successful dispatch.
 *
 * @param {object} args
 * @param {object} args.message         — the classified conversation_message row
 * @param {object} args.orchestrator    — { sendOutboundMessage } for auto-reply routes
 * @param {object} args.aiAdapter       — for reply refinement (optional)
 * @param {string} args.aiProvider      — provider override (optional)
 * @param {object} args.logger          — pino-style logger
 */
export async function routeClassifiedMessage({ message, orchestrator, aiAdapter, aiProvider, logger }) {
  if (!message || !message.category) return { skipped: 'no_category' }
  if (!PUBLIC_COMMENT_CHANNELS.has(message.channel)) return { skipped: 'not_public_channel' }
  if (message.direction !== 'inbound') return { skipped: 'not_inbound' }

  // Idempotency guard.
  const existing = await findOne(
    'comment_routings',
    (r) => r.message_id === message.id
       && r.category === message.category
       && r.category_source === (message.category_source || null),
  )
  if (existing) return { skipped: 'already_routed', routing_id: existing.id }

  // Resolve context.
  const conversation = await findOne('conversations', (c) => c.id === message.conversation_id)
  if (!conversation) return { skipped: 'no_conversation' }

  const contact = conversation.contact_id
    ? await findOne('contacts', (c) => c.id === conversation.contact_id)
    : null

  const raw = message.metadata?.raw_payload || {}
  const externalCandidates = [raw.media_id, raw.post_id, raw.post_urn, raw.tweet_id, raw.video_id]
    .filter(Boolean).map(String)
  const distribution = externalCandidates.length
    ? await findOne('distributions', (d) => externalCandidates.includes(String(d.external_id)))
    : null

  const listing = distribution?.property_id
    ? await findOne('properties', (p) => p.id === distribution.property_id)
    : null

  const agentId = distribution?.agent_id || contact?.assigned_agent_id || null
  const agent = agentId ? await findOne('agents', (a) => a.id === agentId) : null
  const agency = agent?.agency_id
    ? await findOne('agencies', (ag) => ag.id === agent.agency_id).catch(() => null)
    : null

  // Load per-tenant routing config for THIS agent's agency + individual overrides.
  const config = await loadRoutingConfig({ agentId, agencyId: agent?.agency_id || null })
  const routeConfig = config[message.category] || {}

  if (!routeConfig.enabled) {
    return await recordSkip(message, 'route_disabled', { category: message.category })
  }
  if (typeof routeConfig.min_confidence === 'number'
      && typeof message.category_confidence === 'number'
      && message.category_confidence < routeConfig.min_confidence) {
    return await recordSkip(message, 'below_min_confidence', {
      category: message.category,
      confidence: message.category_confidence,
      threshold: routeConfig.min_confidence,
    })
  }

  const ctx = {
    message,
    conversation,
    contact,
    distribution,
    listing,
    agent,
    agency,
    author_name: raw.from_username || raw.from || null,
    routeConfig,
    orchestrator,
    aiAdapter,
    aiProvider,
    db: { findOne, findAll, insert, update },
  }

  const handler = getHandlerForCategory(message.category)
  let outcomes = []
  try {
    outcomes = await handler(ctx)
  } catch (err) {
    outcomes = [{ type: 'handler_error', at: new Date().toISOString(), notes: err.message }]
    logger?.error({ err: err.message, messageId: message.id, category: message.category }, 'Router handler threw')
  }

  const row = {
    id: uuidv4(),
    message_id: message.id,
    conversation_id: message.conversation_id,
    listing_id: listing?.id || null,
    distribution_id: distribution?.id || null,
    agent_id: agent?.id || null,
    agency_id: agent?.agency_id || null,
    category: message.category,
    category_source: message.category_source || null,
    category_confidence: message.category_confidence ?? null,
    route: routeConfig.route || null,
    outcomes,
    created_at: new Date().toISOString(),
  }
  await insert('comment_routings', row)
  return { routing_id: row.id, outcomes }
}

async function recordSkip(message, reason, details) {
  const row = {
    id: uuidv4(),
    message_id: message.id,
    conversation_id: message.conversation_id,
    listing_id: null,
    distribution_id: null,
    agent_id: null,
    agency_id: null,
    category: message.category,
    category_source: message.category_source || null,
    category_confidence: message.category_confidence ?? null,
    route: null,
    outcomes: [{ type: 'skipped', at: new Date().toISOString(), notes: reason, details }],
    created_at: new Date().toISOString(),
  }
  await insert('comment_routings', row)
  return { routing_id: row.id, skipped: reason, details }
}
