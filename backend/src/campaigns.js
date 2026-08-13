/**
 * Drip campaigns / automated sequences for nurture, re-engagement, and
 * follow-up. A sequence is a reusable template; an enrollment binds a contact
 * to a running instance of a sequence with a scheduled step cursor.
 *
 * Collection: campaigns
 *   - id, name, description, status ('draft' | 'active' | 'paused' | 'archived')
 *   - trigger ('manual' | 'new_lead' | 'viewing_completed' | 'inquiry' | 'tag')
 *   - tags_filter, target_channel ('email' | 'sms' | 'whatsapp')
 *   - steps: [{ step_index, delay_hours, channel, template_id, subject, body }]
 *   - created_by, created_at, updated_at
 *
 * Collection: campaign_enrollments
 *   - id, campaign_id, contact_id, assigned_agent_id, status ('active' | 'completed' | 'paused' | 'cancelled')
 *   - current_step_index, next_run_at, started_at, completed_at, created_at, updated_at
 *
 * Collection: campaign_messages
 *   - id, enrollment_id, campaign_id, step_index, contact_id, conversation_id, message_id
 *   - status, sent_at, delivered_at, error, created_at
 */

import { v4 as uuidv4 } from 'uuid'
import { findAll, findOne, insert, update, remove } from './db.js'
import { getTemplateById, renderTemplate, incrementUsageCount } from './message-templates.js'
import { getOrCreateConversation, sendOutboundMessage } from './conversations/orchestrator.js'

const AUTO_DISPATCH_ENABLED = process.env.CAMPAIGN_AUTO_DISPATCH_ENABLED !== 'false'

const VALID_CHANNELS = ['email', 'sms', 'whatsapp']
const VALID_STATUSES = ['draft', 'active', 'paused', 'archived']
const VALID_TRIGGERS = ['manual', 'new_lead', 'viewing_completed', 'inquiry', 'tag']

function nowIso() {
  return new Date().toISOString()
}

function hoursFromNow(hours) {
  return new Date(Date.now() + hours * 60 * 60 * 1000).toISOString()
}

function splitName(name) {
  const parts = String(name || '').trim().split(/\s+/)
  return {
    first_name: parts[0] || '',
    last_name: parts.slice(1).join(' ') || '',
  }
}

async function getLatestPropertyContext(contactId) {
  const inquiries = (await findAll('inquiries', (i) => i.contact_id === contactId))
    .filter((i) => i.property_id)
    .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())
  if (inquiries.length > 0) {
    const property = await findOne('properties', (p) => p.id === inquiries[0].property_id)
    if (property) {
      return {
        property_title: property.title || '',
        property_address: property.address || property.location || '',
        property_price: property.price ? String(property.price) : '',
        property_type: property.property_type || '',
        viewing_date: '',
      }
    }
  }

  const viewings = (await findAll('viewings', (v) => v.contact_id === contactId))
    .sort((a, b) => new Date(b.created_at || b.scheduled_at).getTime() - new Date(a.created_at || a.scheduled_at).getTime())
  if (viewings.length > 0) {
    const v = viewings[0]
    const property = v.property_id ? await findOne('properties', (p) => p.id === v.property_id) : null
    return {
      property_title: property?.title || v.property_title || '',
      property_address: property?.address || property?.location || v.property_address || '',
      property_price: property?.price ? String(property.price) : '',
      property_type: property?.property_type || '',
      viewing_date: v.scheduled_at ? new Date(v.scheduled_at).toLocaleDateString() : '',
    }
  }

  return {
    property_title: '',
    property_address: '',
    property_price: '',
    property_type: '',
    viewing_date: '',
  }
}

async function buildCampaignVariables(contact, agent) {
  const nameParts = splitName(contact.name)
  const propertyContext = await getLatestPropertyContext(contact.id)

  return {
    client_name: contact.name || '',
    first_name: nameParts.first_name,
    last_name: nameParts.last_name,
    email: contact.email || '',
    phone: contact.phone || '',
    status: contact.status || '',
    agent_name: agent?.name || '',
    agent_phone: agent?.phone || '',
    agent_email: agent?.email || '',
    ...propertyContext,
  }
}

function isContactOptedOut(contact, channel) {
  if (contact.status === 'do_not_contact') return true
  const tags = new Set((contact.tags || []).map((t) => String(t).toLowerCase()))
  if (tags.has('opted_out') || tags.has('unsubscribe') || tags.has('unsubscribed')) return true
  if (contact.communication_preferences?.[channel]?.enabled === false) return true
  return false
}

async function resolveStepContent(step, variables) {
  if (step.template_id) {
    const template = await getTemplateById(step.template_id)
    if (!template) throw new Error(`Template ${step.template_id} not found`)
    if (template.channel !== step.channel) {
      throw new Error(`Template ${template.id} is for channel ${template.channel}, step uses ${step.channel}`)
    }
    const rendered = renderTemplate(template, variables)
    return {
      body: rendered.body,
      subject: rendered.subject || step.subject || '',
      template_id: template.id,
      rendered_variables: rendered.variables_used,
      missing_variables: rendered.missing_variables,
    }
  }
  return {
    body: step.body || '',
    subject: step.subject || '',
    template_id: null,
    rendered_variables: [],
    missing_variables: [],
  }
}

export async function createCampaign({
  name,
  description = '',
  status = 'draft',
  trigger = 'manual',
  tagsFilter = [],
  targetChannel = 'email',
  steps = [],
  createdBy = null,
}) {
  if (!name?.trim()) throw new Error('Campaign name is required')
  if (!VALID_STATUSES.includes(status)) throw new Error(`Invalid campaign status: ${status}`)
  if (!VALID_TRIGGERS.includes(trigger)) throw new Error(`Invalid campaign trigger: ${trigger}`)
  if (!VALID_CHANNELS.includes(targetChannel)) throw new Error(`Invalid campaign channel: ${targetChannel}`)
  if (!Array.isArray(steps) || steps.length === 0) throw new Error('At least one step is required')

  const normalizedSteps = steps.map((s, idx) => {
    if (!s.body?.trim() && !s.template_id) throw new Error(`Step ${idx} requires body or template_id`)
    if (s.channel && !VALID_CHANNELS.includes(s.channel)) throw new Error(`Invalid step channel: ${s.channel}`)
    return {
      step_index: idx,
      delay_hours: Math.max(0, Number(s.delay_hours) || 0),
      channel: s.channel || targetChannel,
      template_id: s.template_id || null,
      subject: s.subject || '',
      body: s.body || '',
    }
  })

  const campaign = {
    id: uuidv4(),
    name: name.trim(),
    description: description.trim(),
    status,
    trigger,
    tags_filter: Array.isArray(tagsFilter) ? tagsFilter : [],
    target_channel: targetChannel,
    steps: normalizedSteps,
    created_by: createdBy,
    created_at: nowIso(),
    updated_at: nowIso(),
  }
  await insert('campaigns', campaign)
  return campaign
}

export async function getCampaigns({ status, trigger, createdBy } = {}) {
  let rows = await findAll('campaigns')
  if (status) rows = rows.filter((c) => c.status === status)
  if (trigger) rows = rows.filter((c) => c.trigger === trigger)
  if (createdBy) rows = rows.filter((c) => c.created_by === createdBy)
  rows.sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())
  return rows
}

export async function getCampaignById(id) {
  return findOne('campaigns', (c) => c.id === id)
}

export async function updateCampaign(id, patch) {
  const campaign = await findOne('campaigns', (c) => c.id === id)
  if (!campaign) return null
  const allowed = ['name', 'description', 'status', 'trigger', 'tags_filter', 'target_channel', 'steps']
  const next = { ...campaign, updated_at: nowIso() }
  for (const key of allowed) {
    if (patch[key] !== undefined) next[key] = patch[key]
  }
  if (next.status && !VALID_STATUSES.includes(next.status)) throw new Error(`Invalid campaign status: ${next.status}`)
  if (next.trigger && !VALID_TRIGGERS.includes(next.trigger)) throw new Error(`Invalid campaign trigger: ${next.trigger}`)
  if (next.target_channel && !VALID_CHANNELS.includes(next.target_channel)) throw new Error(`Invalid campaign channel: ${next.target_channel}`)
  if (next.steps) {
    next.steps = next.steps.map((s, idx) => ({
      step_index: idx,
      delay_hours: Math.max(0, Number(s.delay_hours) || 0),
      channel: s.channel || next.target_channel,
      template_id: s.template_id || null,
      subject: s.subject || '',
      body: s.body || '',
    }))
  }
  await update('campaigns', (c) => c.id === id, () => next)
  return findOne('campaigns', (c) => c.id === id)
}

export async function deleteCampaign(id) {
  const enrollments = await findAll('campaign_enrollments', (e) => e.campaign_id === id)
  if (enrollments.length > 0) throw new Error('Cannot delete campaign with active enrollments')
  return remove('campaigns', (c) => c.id === id)
}

export async function enrollContact({ campaignId, contactId, assignedAgentId, startAt = nowIso() }) {
  const campaign = await findOne('campaigns', (c) => c.id === campaignId && c.status === 'active')
  if (!campaign) throw new Error('Active campaign not found')
  const contact = await findOne('contacts', (c) => c.id === contactId)
  if (!contact) throw new Error('Contact not found')

  const existing = await findOne('campaign_enrollments', (e) => e.campaign_id === campaignId && e.contact_id === contactId && e.status === 'active')
  if (existing) return existing

  const firstStep = campaign.steps[0]
  const nextRunAt = firstStep?.delay_hours ? hoursFromNow(firstStep.delay_hours) : startAt

  const enrollment = {
    id: uuidv4(),
    campaign_id: campaignId,
    contact_id: contactId,
    assigned_agent_id: assignedAgentId || contact.assigned_agent_id || null,
    status: 'active',
    current_step_index: 0,
    next_run_at: nextRunAt,
    started_at: startAt,
    completed_at: null,
    created_at: nowIso(),
    updated_at: nowIso(),
  }
  await insert('campaign_enrollments', enrollment)
  return enrollment
}

export async function getEnrollments({ campaignId, contactId, status, assignedAgentId, dueBefore } = {}) {
  let rows = await findAll('campaign_enrollments')
  if (campaignId) rows = rows.filter((e) => e.campaign_id === campaignId)
  if (contactId) rows = rows.filter((e) => e.contact_id === contactId)
  if (status) rows = rows.filter((e) => e.status === status)
  if (assignedAgentId) rows = rows.filter((e) => e.assigned_agent_id === assignedAgentId)
  if (dueBefore) rows = rows.filter((e) => e.next_run_at && e.next_run_at <= dueBefore)
  rows.sort((a, b) => new Date(a.next_run_at || b.created_at).getTime() - new Date(b.next_run_at || a.created_at).getTime())
  return rows
}

export async function getEnrollmentById(id) {
  return findOne('campaign_enrollments', (e) => e.id === id)
}

export async function updateEnrollment(id, patch) {
  const enrollment = await findOne('campaign_enrollments', (e) => e.id === id)
  if (!enrollment) return null
  const allowed = ['status', 'current_step_index', 'next_run_at']
  const next = { ...enrollment, updated_at: nowIso() }
  for (const key of allowed) {
    if (patch[key] !== undefined) next[key] = patch[key]
  }
  if (next.status === 'completed' && !next.completed_at) next.completed_at = nowIso()
  await update('campaign_enrollments', (e) => e.id === id, () => next)
  return findOne('campaign_enrollments', (e) => e.id === id)
}

export async function cancelEnrollment(id) {
  return updateEnrollment(id, { status: 'cancelled' })
}

export async function recordCampaignMessage({ enrollmentId, campaignId, stepIndex, contactId, conversationId, messageId, status = 'sent', error = null }) {
  const record = {
    id: uuidv4(),
    enrollment_id: enrollmentId,
    campaign_id: campaignId,
    step_index: stepIndex,
    contact_id: contactId,
    conversation_id: conversationId || null,
    message_id: messageId || null,
    status,
    error,
    sent_at: status === 'sent' ? nowIso() : null,
    created_at: nowIso(),
  }
  await insert('campaign_messages', record)
  return record
}

export async function getCampaignMessages({ enrollmentId, campaignId, contactId } = {}) {
  let rows = await findAll('campaign_messages')
  if (enrollmentId) rows = rows.filter((r) => r.enrollment_id === enrollmentId)
  if (campaignId) rows = rows.filter((r) => r.campaign_id === campaignId)
  if (contactId) rows = rows.filter((r) => r.contact_id === contactId)
  rows.sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime())
  return rows
}

async function advanceEnrollment(enrollment, campaign) {
  const nextStepIndex = enrollment.current_step_index + 1
  const nextStep = campaign.steps[nextStepIndex]
  const nextRunAt = nextStep ? hoursFromNow(nextStep.delay_hours) : null
  await updateEnrollment(enrollment.id, {
    current_step_index: nextStepIndex,
    next_run_at: nextRunAt,
    status: nextStep ? 'active' : 'completed',
  })
}

/**
 * Advance active enrollments that are due. This is called by the scheduler.
 * Returns a summary of processed enrollments and any errors.
 */
export async function runCampaignScheduler({ now = nowIso(), maxEnrollments = 50 } = {}) {
  const due = (await getEnrollments({ status: 'active', dueBefore: now })).slice(0, maxEnrollments)
  const summary = { processed: 0, sent: 0, errors: 0, skipped: 0, details: [] }

  for (const enrollment of due) {
    summary.processed++
    const campaign = await findOne('campaigns', (c) => c.id === enrollment.campaign_id)
    if (!campaign || campaign.status !== 'active') {
      await updateEnrollment(enrollment.id, { status: 'paused' })
      summary.skipped++
      summary.details.push({ enrollment_id: enrollment.id, status: 'paused', reason: 'campaign_inactive' })
      continue
    }

    const step = campaign.steps[enrollment.current_step_index]
    if (!step) {
      await updateEnrollment(enrollment.id, { status: 'completed', current_step_index: campaign.steps.length })
      summary.details.push({ enrollment_id: enrollment.id, status: 'completed', reason: 'no_more_steps' })
      continue
    }

    const contact = await findOne('contacts', (c) => c.id === enrollment.contact_id)
    if (!contact) {
      await updateEnrollment(enrollment.id, { status: 'cancelled' })
      summary.skipped++
      summary.details.push({ enrollment_id: enrollment.id, status: 'cancelled', reason: 'contact_missing' })
      continue
    }

    // Dispatch the step through the conversation orchestrator when auto-dispatch is
    // enabled; otherwise fall back to a manual agent task so campaigns stay safe.
    try {
      if (!AUTO_DISPATCH_ENABLED) {
        const task = {
          id: uuidv4(),
          contact_id: contact.id,
          assigned_to: enrollment.assigned_agent_id || contact.assigned_agent_id,
          type: step.channel === 'email' ? 'email' : 'follow_up',
          title: `Campaign: ${campaign.name} — Step ${step.step_index + 1}`,
          notes: `Channel: ${step.channel}\nSubject: ${step.subject}\nBody: ${step.body}`,
          due_at: nowIso(),
          priority: 'normal',
          status: 'pending',
          campaign_enrollment_id: enrollment.id,
          campaign_step_index: step.step_index,
          created_by: campaign.created_by,
          created_at: nowIso(),
          updated_at: nowIso(),
        }
        await insert('tasks', task)

        await recordCampaignMessage({
          enrollmentId: enrollment.id,
          campaignId: campaign.id,
          stepIndex: step.step_index,
          contactId: contact.id,
          messageId: task.id,
          status: 'deferred',
        })

        await advanceEnrollment(enrollment, campaign)
        summary.skipped++
        summary.details.push({ enrollment_id: enrollment.id, step_index: step.step_index, status: 'deferred', task_id: task.id })
        continue
      }

      if (isContactOptedOut(contact, step.channel)) {
        await recordCampaignMessage({
          enrollmentId: enrollment.id,
          campaignId: campaign.id,
          stepIndex: step.step_index,
          contactId: contact.id,
          status: 'skipped',
          error: 'Contact opted out',
        })
        await advanceEnrollment(enrollment, campaign)
        summary.skipped++
        summary.details.push({ enrollment_id: enrollment.id, step_index: step.step_index, status: 'skipped', reason: 'opted_out' })
        continue
      }

      const agent = contact.assigned_agent_id ? await findOne('agents', (a) => a.id === contact.assigned_agent_id) : null
      const variables = await buildCampaignVariables(contact, agent)
      const content = await resolveStepContent(step, variables)

      const { conversation } = await getOrCreateConversation({
        contactId: contact.id,
        channel: step.channel,
        assignedAgentId: enrollment.assigned_agent_id || contact.assigned_agent_id,
        subject: content.subject || `Campaign: ${campaign.name}`,
      })

      const { message, dispatch } = await sendOutboundMessage({
        conversationId: conversation.id,
        content: content.body,
        contentType: 'text',
        subject: content.subject,
        sentByAgentId: enrollment.assigned_agent_id || contact.assigned_agent_id,
      })

      if (content.template_id && dispatch.ok) {
        await incrementUsageCount(content.template_id)
      }

      await recordCampaignMessage({
        enrollmentId: enrollment.id,
        campaignId: campaign.id,
        stepIndex: step.step_index,
        contactId: contact.id,
        conversationId: conversation.id,
        messageId: message.id,
        status: dispatch.ok ? 'sent' : 'failed',
        error: dispatch.error || null,
      })

      await advanceEnrollment(enrollment, campaign)

      if (dispatch.ok) {
        summary.sent++
        summary.details.push({ enrollment_id: enrollment.id, step_index: step.step_index, status: 'sent', message_id: message.id })
      } else {
        summary.errors++
        summary.details.push({ enrollment_id: enrollment.id, step_index: step.step_index, status: 'failed', error: dispatch.error })
      }
    } catch (err) {
      summary.errors++
      summary.details.push({ enrollment_id: enrollment.id, step_index: step.step_index, status: 'error', error: err.message })
      await recordCampaignMessage({
        enrollmentId: enrollment.id,
        campaignId: campaign.id,
        stepIndex: step.step_index,
        contactId: contact.id,
        status: 'failed',
        error: err.message,
      })
      // Keep the cursor moving so a bad step/template does not jam the scheduler.
      await advanceEnrollment(enrollment, campaign)
    }
  }

  return summary
}

/**
 * Enroll contacts matching a campaign's trigger/tags automatically.
 */
export async function autoEnrollContactsForCampaign(campaignId, { maxContacts = 100 } = {}) {
  const campaign = await findOne('campaigns', (c) => c.id === campaignId && c.status === 'active')
  if (!campaign) throw new Error('Active campaign not found')

  const tags = new Set(campaign.tags_filter || [])
  let contacts = await findAll('contacts')
  if (tags.size > 0) {
    contacts = contacts.filter((c) => Array.isArray(c.tags) && c.tags.some((t) => tags.has(t)))
  }
  contacts = contacts.slice(0, maxContacts)

  const enrolled = []
  for (const contact of contacts) {
    const existing = await findOne('campaign_enrollments', (e) => e.campaign_id === campaignId && e.contact_id === contact.id && ['active', 'paused'].includes(e.status))
    if (!existing) {
      enrolled.push(await enrollContact({ campaignId, contactId: contact.id, assignedAgentId: contact.assigned_agent_id }))
    }
  }
  return enrolled
}
