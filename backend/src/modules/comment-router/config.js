/**
 * Per-tenant routing configuration for the comment router.
 *
 * Each of the 11 categories has a route configuration bundle. Tenants
 * override defaults via /api/routing-config; anything not overridden falls
 * back to the shipped defaults.
 *
 * Config lives in a new `routing_configs` collection, one row per
 * (owner_type, owner_id). owner_type='agency' beats owner_type='agent'
 * at resolution time (agency owners can set policy across the team) but
 * an individual agent's overrides supersede agency defaults.
 */

import { findOne, insert, update } from '../../db.js'

export const ROUTING_CATEGORIES = [
  'hot_lead', 'interest', 'investor', 'question',
  'objection', 'complaint', 'testimonial',
  'reaction', 'referral', 'general', 'spam',
]

/**
 * Defaults are intentionally conservative for auto-reply — Hot is the only
 * category that auto-sends by default; every other category composes a
 * "suggested reply" for the agent to review and send manually. Agency
 * owners can flip auto-reply on for Interest / Investor / Question etc.
 * once they've tuned their templates.
 */
export const DEFAULT_ROUTING_CONFIG = {
  hot_lead: {
    enabled: true,
    auto_reply: true,
    auto_reply_template:
      'Hi {contact_name}, thanks for your interest in {listing_title}! One of our agents will reach out within {response_time} minutes. To speed things up, could you share your preferred move-in date and budget?',
    response_time_minutes: 15,
    notify_agent: true,
    notify_agency_owner: false,
    open_opportunity: true,
    opportunity_stage: 'qualification',
    sub_pipeline: 'standard',
    escalation_timeout_minutes: 15,
    min_confidence: 0.6,
  },
  interest: {
    enabled: true,
    auto_reply: false,
    auto_reply_template:
      'Hi {contact_name}, thanks for asking about {listing_title}! It is {listing_price}. When would work for a viewing?',
    notify_agent: true,
    notify_agency_owner: false,
    open_opportunity: true,
    opportunity_stage: 'new',
    sub_pipeline: 'standard',
    escalation_timeout_minutes: 60,
    min_confidence: 0.6,
  },
  investor: {
    enabled: true,
    auto_reply: false,
    auto_reply_template:
      'Hi {contact_name}, {listing_title} is currently listed at {listing_price}. We can put together an investment brief (expected yield, comparable rents, exit assumptions) — would you like us to send it over?',
    notify_agent: true,
    notify_agency_owner: false,
    open_opportunity: true,
    opportunity_stage: 'new',
    sub_pipeline: 'investor',
    escalation_timeout_minutes: 240,
    min_confidence: 0.6,
  },
  question: {
    enabled: true,
    auto_reply: false,
    auto_reply_template:
      'Hi {contact_name}, thanks for the question about {listing_title}! Let me get you the answer shortly.',
    notify_agent: false,
    notify_agency_owner: false,
    create_inquiry: true,
    escalation_timeout_minutes: 1440,
    min_confidence: 0.5,
  },
  objection: {
    enabled: true,
    auto_reply: false, // NEVER auto-respond to a property objection
    auto_reply_template:
      'Hi {contact_name}, I understand — {listing_title} sits at {listing_price} because {price_justification}. Would you like me to send comparable properties in the same area?',
    notify_agent: true,
    notify_agency_owner: false,
    flag_needs_attention: true,
    escalation_timeout_minutes: 240,
    min_confidence: 0.7,
  },
  complaint: {
    enabled: true,
    auto_reply: false, // NEVER auto-respond to a complaint — makes it worse
    notify_agent: true,
    notify_agency_owner: true,
    flag_needs_attention: true,
    priority: 'urgent',
    escalation_timeout_minutes: 60,
    min_confidence: 0.7,
  },
  testimonial: {
    enabled: true,
    auto_reply: false,
    auto_reply_template:
      'Thank you so much for the kind words, {contact_name}! Would you allow us to feature your review on our website and social channels? (We will always credit you or use just your first name — whichever you prefer.)',
    add_to_marketing_queue: true,
    consent_required: true,
    notify_agent: false,
    notify_agency_owner: false,
    min_confidence: 0.6,
  },
  reaction: {
    enabled: true,
    auto_reply: false,
    increment_engagement: true,
    notify_agent: false,
    notify_agency_owner: false,
    min_confidence: 0.5,
  },
  referral: {
    enabled: true,
    auto_reply: false,
    notify_agent: true,
    notify_agency_owner: false,
    prompt_agent_dm: true,
    min_confidence: 0.6,
  },
  general: {
    enabled: true,
    auto_reply: false,
    ai_watch_thread: true, // subscribe an AI watcher for follow-ups
    notify_agent: false,
    notify_agency_owner: false,
    min_confidence: 0.0,
  },
  spam: {
    enabled: true,
    auto_reply: false,
    hide_from_views: true,
    notify_agent: false,
    notify_agency_owner: false,
    min_confidence: 0.7,
  },
}

/**
 * Resolve the effective routing config for a given agent by merging:
 *   agency defaults > agent overrides > DEFAULT_ROUTING_CONFIG.
 *
 * Agents inherit their agency's config. Individual agents can override
 * any per-category setting on their own row.
 */
export async function loadRoutingConfig({ agentId, agencyId }) {
  const effective = deepClone(DEFAULT_ROUTING_CONFIG)

  if (agencyId) {
    const agency = await findOne(
      'routing_configs',
      (c) => c.owner_type === 'agency' && c.owner_id === agencyId,
    )
    if (agency?.routes) mergeRoutes(effective, agency.routes)
  }
  if (agentId) {
    const agent = await findOne(
      'routing_configs',
      (c) => c.owner_type === 'agent' && c.owner_id === agentId,
    )
    if (agent?.routes) mergeRoutes(effective, agent.routes)
  }
  return effective
}

/**
 * Upsert the routing config for an owner (agent or agency). Only the
 * overridden fields need to be sent; missing fields fall back to the
 * defaults or the higher-scope config at resolve time.
 */
export async function upsertRoutingConfig({ ownerType, ownerId, routes }) {
  if (!['agent', 'agency'].includes(ownerType)) throw new Error('ownerType must be agent | agency')
  if (!ownerId) throw new Error('ownerId is required')

  const normalized = normalizeRoutes(routes || {})
  const existing = await findOne(
    'routing_configs',
    (c) => c.owner_type === ownerType && c.owner_id === ownerId,
  )
  const now = new Date().toISOString()
  if (existing) {
    await update('routing_configs', (c) => c.id === existing.id, (c) => ({
      ...c,
      routes: { ...(c.routes || {}), ...normalized },
      updated_at: now,
    }))
    return await findOne('routing_configs', (c) => c.id === existing.id)
  }
  const row = {
    id: `rc_${ownerType}_${ownerId}`,
    owner_type: ownerType,
    owner_id: ownerId,
    routes: normalized,
    created_at: now,
    updated_at: now,
  }
  await insert('routing_configs', row)
  return row
}

function normalizeRoutes(input) {
  const out = {}
  for (const cat of ROUTING_CATEGORIES) {
    if (input[cat] && typeof input[cat] === 'object') {
      out[cat] = { ...input[cat] }
    }
  }
  return out
}

function mergeRoutes(target, patch) {
  for (const cat of ROUTING_CATEGORIES) {
    if (patch[cat] && typeof patch[cat] === 'object') {
      target[cat] = { ...target[cat], ...patch[cat] }
    }
  }
}

function deepClone(obj) {
  return JSON.parse(JSON.stringify(obj))
}
