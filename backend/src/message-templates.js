/**
 * Message templates domain layer.
 *
 * Provides reusable, variable-driven templates for WhatsApp, SMS, and email.
 * This module is intentionally free of HTTP/Express concerns.
 */

import { v4 as uuidv4 } from 'uuid'
import { findAll, findOne, insert, update, remove } from './db.js'

const VALID_CHANNELS = ['whatsapp', 'sms', 'email']
const VALID_CATEGORIES = ['greeting', 'follow_up', 'viewing', 'offer', 'general']
const VALID_APPROVAL_STATUSES = ['draft', 'pending', 'approved', 'rejected']
const VALID_OWNER_TYPES = ['agent', 'agency', 'platform']
const VARIABLE_RE = /\{\{\s*([a-zA-Z_][a-zA-Z0-9_]*)\s*\}\}/g

export function extractVariables(body, subject) {
  const vars = new Set()
  const text = [body || '', subject || ''].join('\n')
  let match
  while ((match = VARIABLE_RE.exec(text)) !== null) {
    vars.add(match[1])
  }
  return Array.from(vars)
}

function nowIso() {
  return new Date().toISOString()
}

export async function createTemplate({
  name,
  channel,
  category = 'general',
  subject = null,
  body,
  language = 'en',
  approvalStatus = 'draft',
  ownerType = 'agent',
  ownerId = null,
  isDefault = false,
  createdBy,
}) {
  if (!name?.trim()) throw Object.assign(new Error('Template name is required'), { code: 'MISSING_NAME' })
  if (!VALID_CHANNELS.includes(channel)) throw Object.assign(new Error(`Invalid channel: ${channel}`), { code: 'INVALID_CHANNEL' })
  if (!VALID_CATEGORIES.includes(category)) throw Object.assign(new Error(`Invalid category: ${category}`), { code: 'INVALID_CATEGORY' })
  if (!body?.trim()) throw Object.assign(new Error('Template body is required'), { code: 'MISSING_BODY' })
  if (channel === 'email' && !subject?.trim()) {
    throw Object.assign(new Error('Email templates require a subject'), { code: 'MISSING_SUBJECT' })
  }
  if (!VALID_APPROVAL_STATUSES.includes(approvalStatus)) {
    throw Object.assign(new Error(`Invalid approval status: ${approvalStatus}`), { code: 'INVALID_APPROVAL_STATUS' })
  }
  if (!VALID_OWNER_TYPES.includes(ownerType)) {
    throw Object.assign(new Error(`Invalid owner type: ${ownerType}`), { code: 'INVALID_OWNER_TYPE' })
  }

  const template = {
    id: uuidv4(),
    name: name.trim(),
    channel,
    category,
    subject: channel === 'email' ? subject.trim() : null,
    body: body.trim(),
    variables: extractVariables(body, subject),
    language,
    approval_status: approvalStatus,
    owner_type: ownerType,
    owner_id: ownerId || null,
    is_default: Boolean(isDefault),
    usage_count: 0,
    created_by: createdBy || null,
    created_at: nowIso(),
    updated_at: nowIso(),
  }

  await insert('message_templates', template)
  return template
}

export async function getTemplates({ channel, category, ownerType, ownerId, createdBy, includeDefaults = false } = {}) {
  let rows = await findAll('message_templates')

  if (channel) rows = rows.filter((t) => t.channel === channel)
  if (category) rows = rows.filter((t) => t.category === category)
  if (ownerType) rows = rows.filter((t) => t.owner_type === ownerType)
  if (ownerId) rows = rows.filter((t) => t.owner_id === ownerId)
  if (createdBy) rows = rows.filter((t) => t.created_by === createdBy)

  if (includeDefaults && ownerType !== 'platform') {
    const allTemplates = await findAll('message_templates')
    const defaults = allTemplates.filter((t) => t.owner_type === 'platform' && t.is_default)
    const defaultIds = new Set(defaults.map((t) => t.id))
    rows = rows.filter((t) => !defaultIds.has(t.id)).concat(defaults)
  }

  rows.sort((a, b) => new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime())
  return rows
}

export async function getTemplateById(id) {
  return await findOne('message_templates', (t) => t.id === id)
}

export async function getDefaultTemplates({ channel, category } = {}) {
  let rows = (await findAll('message_templates')).filter((t) => t.owner_type === 'platform' && t.is_default)
  if (channel) rows = rows.filter((t) => t.channel === channel)
  if (category) rows = rows.filter((t) => t.category === category)
  rows.sort((a, b) => new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime())
  return rows
}

export async function updateTemplate(id, patch) {
  const template = await findOne('message_templates', (t) => t.id === id)
  if (!template) return null

  const allowed = ['name', 'channel', 'category', 'subject', 'body', 'language', 'approval_status', 'is_default']
  const next = { ...template, updated_at: nowIso() }

  for (const key of allowed) {
    if (patch[key] !== undefined) next[key] = patch[key]
  }

  if (next.channel === 'email' && !next.subject?.trim()) {
    throw Object.assign(new Error('Email templates require a subject'), { code: 'MISSING_SUBJECT' })
  }
  if (!VALID_CHANNELS.includes(next.channel)) throw Object.assign(new Error(`Invalid channel: ${next.channel}`), { code: 'INVALID_CHANNEL' })
  if (!VALID_CATEGORIES.includes(next.category)) throw Object.assign(new Error(`Invalid category: ${next.category}`), { code: 'INVALID_CATEGORY' })
  if (!VALID_APPROVAL_STATUSES.includes(next.approval_status)) {
    throw Object.assign(new Error(`Invalid approval status: ${next.approval_status}`), { code: 'INVALID_APPROVAL_STATUS' })
  }

  next.variables = extractVariables(next.body, next.subject)
  next.subject = next.channel === 'email' ? next.subject?.trim() || '' : null

  await update('message_templates', (t) => t.id === id, () => next)
  return await findOne('message_templates', (t) => t.id === id)
}

export async function deleteTemplate(id) {
  return await remove('message_templates', (t) => t.id === id)
}

export function renderTemplate(template, variables = {}) {
  if (!template) throw Object.assign(new Error('Template is required'), { code: 'MISSING_TEMPLATE' })

  const missing = []
  const replace = (text) =>
    String(text || '').replace(VARIABLE_RE, (match, key) => {
      if (variables[key] === undefined || variables[key] === null) {
        missing.push(key)
        return match
      }
      return String(variables[key])
    })

  const rendered = {
    body: replace(template.body),
    subject: template.channel === 'email' ? replace(template.subject) : null,
    variables_used: extractVariables(template.body, template.subject),
    missing_variables: Array.from(new Set(missing)),
  }

  return rendered
}

export async function incrementUsageCount(id) {
  const template = await findOne('message_templates', (t) => t.id === id)
  if (!template) return null
  await update('message_templates', (t) => t.id === id, (t) => ({ ...t, usage_count: (t.usage_count || 0) + 1, updated_at: nowIso() }))
  return await findOne('message_templates', (t) => t.id === id)
}

export async function getTemplatesForAgent({ agentId, agencyId, channel, category } = {}) {
  let rows = (await findAll('message_templates')).filter((t) => {
    if (t.owner_type === 'platform' && t.is_default) return true
    if (t.owner_type === 'agency' && t.owner_id === agencyId) return true
    if (t.owner_type === 'agent' && t.owner_id === agentId) return true
    return false
  })

  if (channel) rows = rows.filter((t) => t.channel === channel)
  if (category) rows = rows.filter((t) => t.category === category)

  rows.sort((a, b) => new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime())
  return rows
}
