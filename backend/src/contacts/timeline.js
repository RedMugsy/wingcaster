import { findAll, findOne } from '../db.js'

async function formatActor(agentId) {
  if (!agentId) return 'System'
  const agent = await findOne('agents', (a) => a.id === agentId)
  return agent?.name || 'System'
}

async function contactPropertyIds(contactId) {
  const inquiries = await findAll('inquiries', (i) => i.contact_id === contactId)
  return inquiries.map((i) => i.property_id).filter(Boolean)
}

async function contactInquiryIds(contactId) {
  const inquiries = await findAll('inquiries', (i) => i.contact_id === contactId)
  return inquiries.map((i) => i.id)
}

export async function buildContactTimeline(contactId) {
  const contact = await findOne('contacts', (c) => c.id === contactId)
  if (!contact) return null

  const propertyIds = await contactPropertyIds(contactId)
  const inquiryIds = await contactInquiryIds(contactId)

  const events = []

  // Manual notes
  const notes = await findAll('contact_notes', (n) => n.contact_id === contactId)
  for (const n of notes) {
    events.push({
      id: n.id,
      type: 'note',
      title: 'Note added',
      timestamp: n.created_at,
      actor: await formatActor(n.agent_id),
      data: n,
    })
  }

  // Tasks
  const tasks = await findAll('tasks', (t) => t.contact_id === contactId)
  for (const t of tasks) {
    events.push({
      id: t.id,
      type: t.status === 'completed' ? 'task_completed' : 'task',
      title: t.status === 'completed' ? `Task completed: ${t.title}` : `Task due: ${t.title}`,
      timestamp: t.status === 'completed' ? (t.completed_at || t.updated_at) : t.due_at,
      actor: await formatActor(t.assigned_to),
      data: t,
    })
  }

  // Viewings
  const viewings = await findAll('viewings', (v) => v.contact_id === contactId)
  const viewingIds = new Set(viewings.map((v) => v.id))
  for (const v of viewings) {
    events.push({
      id: v.id,
      type: 'viewing',
      title: `Viewing ${v.status?.replace(/_/g, ' ')}`,
      timestamp: v.scheduled_at || v.created_at,
      actor: await formatActor(v.agent_id),
      data: v,
    })
  }

  // Opportunities
  const opportunities = await findAll('opportunities', (o) => o.contact_id === contactId)
  const opportunityIds = new Set(opportunities.map((o) => o.id))
  for (const o of opportunities) {
    events.push({
      id: o.id,
      type: 'opportunity',
      title: `Opportunity ${o.stage?.replace(/_/g, ' ')}`,
      timestamp: o.updated_at || o.created_at,
      actor: await formatActor(o.agent_id),
      data: o,
    })
  }

  // Stage history
  const stageHistory = await findAll('opportunity_stage_history', (h) => opportunityIds.has(h.opportunity_id))
  for (const h of stageHistory) {
    events.push({
      id: h.id,
      type: 'stage_change',
      title: `Stage moved from ${h.from_stage || 'none'} to ${h.to_stage}`,
      timestamp: h.created_at,
      actor: await formatActor(h.changed_by),
      data: h,
    })
  }

  // Conversation messages
  const conversations = await findAll('conversations', (c) => c.contact_id === contactId)
  for (const conv of conversations) {
    const messages = await findAll('conversation_messages', (m) => m.conversation_id === conv.id)
    for (const m of messages) {
      events.push({
        id: m.id,
        type: 'message',
        title: m.direction === 'inbound' ? `Inbound ${m.channel}` : `Outbound ${m.channel}`,
        timestamp: m.created_at,
        actor: m.direction === 'outbound' ? await formatActor(m.created_by_agent_id) : (conv.contact_name || 'Contact'),
        data: m,
      })
    }
  }

  // Activity log: by explicit contact_id in meta or by matched inquiry/property/viewing
  const activityLog = await findAll('activity_log', (a) => {
    if (a.meta?.contact_id === contactId) return true
    if (a.property_id && propertyIds.includes(a.property_id)) return true
    if (a.meta?.inquiry_id && inquiryIds.includes(a.meta.inquiry_id)) return true
    if (a.meta?.viewing_id && viewingIds.has(a.meta.viewing_id)) return true
    return false
  })
  for (const a of activityLog) {
    events.push({
      id: a.id,
      type: 'activity',
      title: a.type?.replace(/_/g, ' ') || 'Activity',
      timestamp: a.created_at,
      actor: await formatActor(a.agent_id),
      data: a,
    })
  }

  events.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime())
  return { contact, events }
}
