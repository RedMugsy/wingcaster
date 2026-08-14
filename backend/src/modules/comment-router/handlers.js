/**
 * Route handlers for the process router.
 *
 * Each handler takes a common `ctx` bundle and returns an outcomes array
 * describing what it did (used for the audit log + UI surfacing). Handlers
 * are pure with respect to context — they call the injected db helpers,
 * ai adapter, and orchestrator so this module can be unit-tested without
 * pulling the whole server graph.
 */

import { v4 as uuidv4 } from 'uuid'
import { renderTemplate, refineWithAi } from './reply-composer.js'
import { createOpportunity } from '../../opportunities.js'
import { emitUsageEventAsync } from '../../billing/index.js'

const NEW_ROUTING_ID = () => uuidv4()

/* ------------------------- Handler dispatch table ------------------------ */

export function getHandlerForCategory(category) {
  return HANDLERS[category] || HANDLERS.general
}

/* ------------------------------- Handlers -------------------------------- */

async function handleHotLead(ctx) {
  const outcomes = []
  const reply = await composeReply(ctx, 'hot_lead')
  if (reply.drafted) outcomes.push({ type: 'reply_drafted', at: nowIso(), notes: 'hot_lead template' })

  if (ctx.routeConfig.auto_reply && ctx.orchestrator && reply.text) {
    try {
      const sent = await ctx.orchestrator.sendOutboundMessage({
        conversationId: ctx.conversation.id,
        content: reply.text,
        sentByAgentId: ctx.agent?.id || null,
      })
      outcomes.push({ type: 'reply_sent', ref_id: sent?.message?.id || null, at: nowIso() })
    } catch (err) {
      outcomes.push({ type: 'reply_send_failed', at: nowIso(), notes: err.message })
    }
  }

  if (ctx.routeConfig.open_opportunity && ctx.contact && ctx.listing) {
    try {
      const opp = await createOpportunity({
        contactId: ctx.contact.id,
        propertyId: ctx.listing.id,
        agentId: ctx.agent?.id || null,
        agencyId: ctx.agency?.id || null,
        stage: ctx.routeConfig.opportunity_stage || 'qualification',
        source: `hot_lead_comment:${ctx.message.channel}`,
        notes: `Auto-opened from a hot-lead comment on ${ctx.distribution?.platform || 'a social post'}.\n\nOriginal comment: "${(ctx.message.content || '').slice(0, 300)}"`,
      })
      // Tag investor / standard sub-pipeline for downstream reporting.
      await ctx.db.update('opportunities', (o) => o.id === opp.id, (o) => ({
        ...o,
        sub_pipeline: ctx.routeConfig.sub_pipeline || 'standard',
        origin: 'social_comment',
      }))
      outcomes.push({ type: 'opportunity_created', ref_id: opp.id, at: nowIso() })
    } catch (err) {
      outcomes.push({ type: 'opportunity_create_failed', at: nowIso(), notes: err.message })
    }
  }

  if (ctx.routeConfig.notify_agent) {
    outcomes.push(await recordNotification(ctx, 'agent', 'hot_lead', 'urgent'))
  }
  if (ctx.routeConfig.notify_agency_owner) {
    outcomes.push(await recordNotification(ctx, 'agency_owner', 'hot_lead', 'urgent'))
  }
  return outcomes
}

async function handleInterest(ctx) {
  const outcomes = []
  const reply = await composeReply(ctx, 'interest')
  if (reply.drafted) outcomes.push({ type: 'reply_drafted', at: nowIso(), notes: 'interest template' })
  if (ctx.routeConfig.auto_reply && ctx.orchestrator && reply.text) {
    try {
      const sent = await ctx.orchestrator.sendOutboundMessage({
        conversationId: ctx.conversation.id,
        content: reply.text,
        sentByAgentId: ctx.agent?.id || null,
      })
      outcomes.push({ type: 'reply_sent', ref_id: sent?.message?.id || null, at: nowIso() })
    } catch (err) {
      outcomes.push({ type: 'reply_send_failed', at: nowIso(), notes: err.message })
    }
  }
  if (ctx.routeConfig.open_opportunity && ctx.contact && ctx.listing) {
    try {
      const opp = await createOpportunity({
        contactId: ctx.contact.id,
        propertyId: ctx.listing.id,
        agentId: ctx.agent?.id || null,
        agencyId: ctx.agency?.id || null,
        stage: ctx.routeConfig.opportunity_stage || 'new',
        source: `interest_comment:${ctx.message.channel}`,
        notes: `Auto-opened from an interest comment.\n\n"${(ctx.message.content || '').slice(0, 300)}"`,
      })
      await ctx.db.update('opportunities', (o) => o.id === opp.id, (o) => ({
        ...o,
        sub_pipeline: ctx.routeConfig.sub_pipeline || 'standard',
        origin: 'social_comment',
      }))
      outcomes.push({ type: 'opportunity_created', ref_id: opp.id, at: nowIso() })
    } catch (err) {
      outcomes.push({ type: 'opportunity_create_failed', at: nowIso(), notes: err.message })
    }
  }
  if (ctx.routeConfig.notify_agent) {
    outcomes.push(await recordNotification(ctx, 'agent', 'interest', 'normal'))
  }
  return outcomes
}

async function handleInvestor(ctx) {
  // Same shape as Interest, but with investor sub-pipeline tag.
  return handleInterest({
    ...ctx,
    routeConfig: { ...ctx.routeConfig, sub_pipeline: ctx.routeConfig.sub_pipeline || 'investor' },
  })
}

async function handleQuestion(ctx) {
  const outcomes = []
  const reply = await composeReply(ctx, 'question')
  if (reply.drafted) outcomes.push({ type: 'reply_drafted', at: nowIso(), notes: 'question template' })

  if (ctx.routeConfig.create_inquiry && ctx.contact && ctx.listing) {
    try {
      const inquiryRow = {
        id: uuidv4(),
        property_id: ctx.listing.id,
        property_title: ctx.listing.title,
        agent_id: ctx.agent?.id || null,
        agency_id: ctx.agency?.id || null,
        site_id: null,
        landing_page: ctx.distribution?.landing_page || null,
        name: ctx.contact.name || ctx.author_name || 'Social lead',
        email: ctx.contact.email || '',
        phone: ctx.contact.phone || '',
        message: ctx.message.content || '',
        source: `question_comment:${ctx.message.channel}`,
        channel: ctx.message.channel,
        status: 'new',
        priority: 'normal',
        origin: 'social_comment',
        origin_message_id: ctx.message.id,
        created_at: nowIso(),
      }
      await ctx.db.insert('inquiries', inquiryRow)
      outcomes.push({ type: 'inquiry_created', ref_id: inquiryRow.id, at: nowIso() })
    } catch (err) {
      outcomes.push({ type: 'inquiry_create_failed', at: nowIso(), notes: err.message })
    }
  }
  if (ctx.routeConfig.notify_agent) {
    outcomes.push(await recordNotification(ctx, 'agent', 'question', 'low'))
  }
  return outcomes
}

async function handleObjection(ctx) {
  const outcomes = []
  const reply = await composeReply(ctx, 'objection')
  if (reply.drafted) outcomes.push({ type: 'reply_drafted', at: nowIso(), notes: 'objection-handling suggestion (agent review only)' })

  // Flag the message row as needing attention so it surfaces in the
  // command-center "Escalations" panel.
  if (ctx.routeConfig.flag_needs_attention) {
    await ctx.db.update('conversation_messages', (m) => m.id === ctx.message.id, (m) => ({
      ...m,
      needs_agent_attention: true,
      priority: 'high',
    }))
    outcomes.push({ type: 'flagged_for_agent', at: nowIso() })
  }
  outcomes.push(await recordNotification(ctx, 'agent', 'objection', 'high'))
  return outcomes
}

async function handleComplaint(ctx) {
  const outcomes = []
  // NEVER auto-reply. Draft a "template does not apply" note so the agent
  // knows the router touched it.
  outcomes.push({ type: 'reply_suppressed', at: nowIso(), notes: 'complaint policy: no auto-reply' })

  await ctx.db.update('conversation_messages', (m) => m.id === ctx.message.id, (m) => ({
    ...m,
    needs_agent_attention: true,
    priority: 'urgent',
  }))
  outcomes.push({ type: 'flagged_for_agent', at: nowIso(), notes: 'priority=urgent' })
  outcomes.push(await recordNotification(ctx, 'agent', 'complaint', 'urgent'))
  if (ctx.routeConfig.notify_agency_owner) {
    outcomes.push(await recordNotification(ctx, 'agency_owner', 'complaint', 'urgent'))
  }
  return outcomes
}

async function handleTestimonial(ctx) {
  const outcomes = []
  const reply = await composeReply(ctx, 'testimonial')
  if (reply.drafted) outcomes.push({ type: 'reply_drafted', at: nowIso(), notes: 'consent-request suggestion' })

  if (ctx.routeConfig.add_to_marketing_queue) {
    try {
      const row = {
        id: uuidv4(),
        message_id: ctx.message.id,
        contact_id: ctx.contact?.id || null,
        agent_id: ctx.agent?.id || null,
        agency_id: ctx.agency?.id || null,
        property_id: ctx.listing?.id || null,
        content: ctx.message.content || '',
        author_name: ctx.author_name || ctx.contact?.name || '',
        source_channel: ctx.message.channel,
        source_post_url: ctx.distribution?.landing_page || null,
        consent_status: ctx.routeConfig.consent_required ? 'pending' : 'implicit',
        published_status: 'draft',
        created_at: nowIso(),
      }
      await ctx.db.insert('testimonials_queue', row)
      outcomes.push({ type: 'marketing_queued', ref_id: row.id, at: nowIso() })
    } catch (err) {
      outcomes.push({ type: 'marketing_queue_failed', at: nowIso(), notes: err.message })
    }
  }
  return outcomes
}

async function handleReaction(ctx) {
  const outcomes = []
  if (ctx.routeConfig.increment_engagement && ctx.distribution) {
    try {
      await ctx.db.update('distributions', (d) => d.id === ctx.distribution.id, (d) => {
        const counts = d.engagement_counts || { reactions: 0, mentions: 0, referrals: 0 }
        counts.reactions = (counts.reactions || 0) + 1
        return { ...d, engagement_counts: counts, updated_at: nowIso() }
      })
      outcomes.push({ type: 'engagement_incremented', ref_id: ctx.distribution.id, at: nowIso(), notes: 'reactions +1' })
    } catch (err) {
      outcomes.push({ type: 'engagement_increment_failed', at: nowIso(), notes: err.message })
    }
  }
  return outcomes
}

async function handleReferral(ctx) {
  const outcomes = []
  const raw = ctx.message.content || ''
  const mentions = Array.from(raw.matchAll(/(?:^|\s)@([\w\.]{2,})/g)).map((m) => m[1]).slice(0, 5)

  if (ctx.distribution) {
    await ctx.db.update('distributions', (d) => d.id === ctx.distribution.id, (d) => {
      const counts = d.engagement_counts || { reactions: 0, mentions: 0, referrals: 0 }
      counts.referrals = (counts.referrals || 0) + 1
      return { ...d, engagement_counts: counts, updated_at: nowIso() }
    })
    outcomes.push({ type: 'engagement_incremented', ref_id: ctx.distribution.id, at: nowIso(), notes: 'referrals +1' })
  }
  if (ctx.routeConfig.notify_agent && mentions.length) {
    outcomes.push(await recordNotification(ctx, 'agent', 'referral', 'normal', {
      tagged_handles: mentions,
      suggested_action: 'Consider DM-ing the tagged handles directly',
    }))
  }
  return outcomes
}

async function handleGeneral(ctx) {
  const outcomes = []
  if (ctx.routeConfig.ai_watch_thread) {
    await ctx.db.update('conversations', (c) => c.id === ctx.conversation.id, (c) => ({
      ...c,
      ai_watching: true,
      ai_watch_started_at: c.ai_watch_started_at || nowIso(),
      updated_at: nowIso(),
    }))
    outcomes.push({ type: 'ai_watcher_subscribed', ref_id: ctx.conversation.id, at: nowIso() })
  }
  return outcomes
}

async function handleSpam(ctx) {
  await ctx.db.update('conversation_messages', (m) => m.id === ctx.message.id, (m) => ({
    ...m,
    is_hidden: true,
    hidden_reason: 'spam',
    hidden_at: nowIso(),
  }))
  return [{ type: 'hidden', ref_id: ctx.message.id, at: nowIso(), notes: 'spam' }]
}

const HANDLERS = {
  hot_lead:    handleHotLead,
  interest:    handleInterest,
  investor:    handleInvestor,
  question:    handleQuestion,
  objection:   handleObjection,
  complaint:   handleComplaint,
  testimonial: handleTestimonial,
  reaction:    handleReaction,
  referral:    handleReferral,
  general:     handleGeneral,
  spam:        handleSpam,
}

/* ------------------------------- Primitives ------------------------------ */

async function composeReply(ctx, category) {
  const template = ctx.routeConfig.auto_reply_template
  if (!template) return { drafted: false, text: null }

  const rendered = renderTemplate(template, {
    contact: ctx.contact,
    listing: ctx.listing,
    distribution: ctx.distribution,
    agent: ctx.agent,
    author_name: ctx.author_name,
    response_time_minutes: ctx.routeConfig.response_time_minutes || 15,
  })
  const refined = await refineWithAi({
    rendered,
    category,
    message: ctx.message,
    aiAdapter: ctx.aiAdapter,
    provider: ctx.aiProvider,
  })

  // Persist the drafted / sent reply on the original message row so the
  // UI can surface it beside the incoming comment.
  await ctx.db.update('conversation_messages', (m) => m.id === ctx.message.id, (m) => ({
    ...m,
    suggested_reply: refined,
    suggested_reply_composed_at: nowIso(),
  }))

  // Emit the AI-drafting cost — one event per composed reply. Uses the
  // agent tenant so cost lands against the right agency.
  emitUsageEventAsync({
    actionKey: 'ai.reply.drafted',
    tenantId: ctx.agent?.id || 'unknown',
    quantity: 1,
    channel: ctx.message.channel,
    listingId: ctx.listing?.id || null,
    conversationId: ctx.conversation?.id || null,
    metadata: { category, provider: ctx.aiProvider || null },
  })

  return { drafted: true, text: refined }
}

async function recordNotification(ctx, target, category, severity, extra = {}) {
  const targetId = target === 'agent'
    ? (ctx.agent?.id || null)
    : (ctx.agency?.owner_id || ctx.agency?.id || null)
  await ctx.db.insert('routing_notifications', {
    id: NEW_ROUTING_ID(),
    target,
    target_id: targetId,
    category,
    severity,
    message_id: ctx.message.id,
    conversation_id: ctx.conversation.id,
    listing_id: ctx.listing?.id || null,
    distribution_id: ctx.distribution?.id || null,
    read: false,
    extra,
    created_at: nowIso(),
  })
  return {
    type: target === 'agent' ? 'agent_notified' : 'agency_owner_notified',
    at: nowIso(),
    notes: `severity=${severity}`,
  }
}

function nowIso() {
  return new Date().toISOString()
}
