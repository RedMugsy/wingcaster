import { v4 as uuidv4 } from 'uuid'
import { findAll, findOne, insert, update, remove } from './db.js'

const VALID_TYPES = ['call', 'email', 'follow_up', 'viewing', 'meeting']
const VALID_STATUSES = ['pending', 'completed', 'cancelled', 'snoozed']
const VALID_PRIORITIES = ['low', 'normal', 'high', 'urgent']

function nowIso() {
  return new Date().toISOString()
}

export async function createTask({
  contactId,
  inquiryId,
  opportunityId,
  conversationId,
  assignedTo,
  type = 'follow_up',
  title,
  notes = '',
  dueAt,
  priority = 'normal',
  createdBy,
}) {
  if (!title) throw new Error('Task title is required')
  if (!dueAt) throw new Error('Task due_at is required')
  if (!VALID_TYPES.includes(type)) throw new Error(`Invalid task type: ${type}`)
  if (!VALID_PRIORITIES.includes(priority)) throw new Error(`Invalid task priority: ${priority}`)

  const task = {
    id: uuidv4(),
    contact_id: contactId || null,
    inquiry_id: inquiryId || null,
    opportunity_id: opportunityId || null,
    conversation_id: conversationId || null,
    assigned_to: assignedTo || null,
    type,
    title,
    notes,
    due_at: dueAt,
    completed_at: null,
    status: 'pending',
    priority,
    created_by: createdBy || null,
    created_at: nowIso(),
    updated_at: nowIso(),
  }
  await insert('tasks', task)
  return task
}

export async function getTaskById(id) {
  return await findOne('tasks', (t) => t.id === id)
}

export async function getTasks({ assignedTo, status, contactId, inquiryId, opportunityId, dueBefore, dueAfter } = {}) {
  let rows = await findAll('tasks')
  if (assignedTo) rows = rows.filter((t) => t.assigned_to === assignedTo)
  if (status) rows = rows.filter((t) => t.status === status)
  if (contactId) rows = rows.filter((t) => t.contact_id === contactId)
  if (inquiryId) rows = rows.filter((t) => t.inquiry_id === inquiryId)
  if (opportunityId) rows = rows.filter((t) => t.opportunity_id === opportunityId)
  if (dueBefore) rows = rows.filter((t) => t.due_at && t.due_at <= dueBefore)
  if (dueAfter) rows = rows.filter((t) => t.due_at && t.due_at >= dueAfter)
  rows.sort((a, b) => new Date(a.due_at).getTime() - new Date(b.due_at).getTime())
  return rows
}

export async function getOverdueTasks(assignedTo, now = nowIso()) {
  return await getTasks({ assignedTo, status: 'pending', dueBefore: now })
}

export async function getDueSoonTasks(assignedTo, now = nowIso(), windowMs = 24 * 60 * 60 * 1000) {
  const dueBefore = new Date(new Date(now).getTime() + windowMs).toISOString()
  return await getTasks({ assignedTo, status: 'pending', dueBefore, dueAfter: now })
}

export async function getTasksDueToday(assignedTo, now = nowIso()) {
  const startOfDay = new Date(new Date(now).setHours(0, 0, 0, 0)).toISOString()
  const endOfDay = new Date(new Date(now).setHours(23, 59, 59, 999)).toISOString()
  return await getTasks({ assignedTo, status: 'pending', dueAfter: startOfDay, dueBefore: endOfDay })
}

export async function updateTask(id, patch) {
  const task = await findOne('tasks', (t) => t.id === id)
  if (!task) return null
  const allowed = ['title', 'notes', 'due_at', 'status', 'priority', 'assigned_to', 'contact_id', 'inquiry_id', 'opportunity_id', 'conversation_id']
  const next = { ...task, updated_at: nowIso() }
  for (const key of allowed) {
    if (patch[key] !== undefined) next[key] = patch[key]
  }
  if (next.status === 'completed' && !next.completed_at) {
    next.completed_at = nowIso()
  } else if (next.status !== 'completed') {
    next.completed_at = null
  }
  if (patch.status && !VALID_STATUSES.includes(patch.status)) {
    throw new Error(`Invalid task status: ${patch.status}`)
  }
  await update('tasks', (t) => t.id === id, () => next)
  return await findOne('tasks', (t) => t.id === id)
}

export async function completeTask(id, { completedBy } = {}) {
  return await updateTask(id, { status: 'completed', completed_by: completedBy || null })
}

export async function deleteTask(id) {
  return await remove('tasks', (t) => t.id === id)
}

/**
 * Keep inquiries.next_follow_up_at as a derived/cache of the earliest pending
 * task due date for that inquiry. Call this after any task mutation.
 */
export async function syncInquiryNextFollowUp(inquiryId) {
  const inquiry = await findOne('inquiries', (i) => i.id === inquiryId)
  if (!inquiry) return null
  const pending = (await findAll('tasks', (t) => t.inquiry_id === inquiryId && t.status === 'pending'))
    .sort((a, b) => new Date(a.due_at).getTime() - new Date(b.due_at).getTime())
  const nextDue = pending.length ? pending[0].due_at : null
  await update('inquiries', (i) => i.id === inquiryId, (i) => ({ ...i, next_follow_up_at: nextDue, updated_at: nowIso() }))
  return nextDue
}

function taskTitleFromViewing(viewing, outcome) {
  const client = viewing.client_name || 'client'
  if (viewing.status === 'cancelled') return `Follow up with ${client} after cancelled viewing`
  if (viewing.status === 'no_show') return `Re-engage ${client} after no-show`
  if (viewing.status === 'completed') {
    return outcome === 'interested'
      ? `Call ${client} to discuss offer after viewing`
      : `Follow up with ${client} after viewing`
  }
  if (viewing.scheduled_at) return `Viewing with ${client} at ${new Date(viewing.scheduled_at).toLocaleString()}`
  return `Follow up for ${client}`
}

export async function createViewingFollowUpTask({ viewing, inquiry, agentId }) {
  if (!viewing || !inquiry) return null
  const now = Date.now()
  let dueAt
  let type = 'follow_up'
  let title = taskTitleFromViewing(viewing, viewing.outcome)

  if (viewing.status === 'cancelled') {
    dueAt = new Date(now + 48 * 60 * 60 * 1000).toISOString()
  } else if (viewing.status === 'no_show') {
    dueAt = new Date(now + 2 * 60 * 60 * 1000).toISOString()
  } else if (viewing.status === 'completed') {
    dueAt = new Date(now + (viewing.outcome === 'interested' ? 60 * 60 * 1000 : 24 * 60 * 60 * 1000)).toISOString()
    if (viewing.outcome === 'interested') type = 'call'
  } else if (viewing.status === 'scheduled' || viewing.status === 'confirmed') {
    type = 'viewing'
    dueAt = viewing.scheduled_at
    title = taskTitleFromViewing(viewing, null)
  } else {
    return null
  }

  // Viewing follow-ups supersede earlier pending follow-ups for the same inquiry.
  const supersedeTypes = type === 'viewing' ? ['viewing'] : ['follow_up', 'call', 'email', 'meeting']
  const supersedeTasks = await findAll('tasks', (t) => t.inquiry_id === inquiry.id && t.status === 'pending' && supersedeTypes.includes(t.type))
  for (const t of supersedeTasks) {
    await updateTask(t.id, { status: 'cancelled' })
  }
  // A terminal viewing outcome (completed/cancelled/no-show) removes the scheduled viewing task.
  if (type !== 'viewing') {
    const scheduledViewingTasks = await findAll('tasks', (t) => t.inquiry_id === inquiry.id && t.status === 'pending' && t.type === 'viewing')
    for (const t of scheduledViewingTasks) {
      await updateTask(t.id, { status: 'cancelled' })
    }
  }

  const task = await createTask({
    contactId: viewing.contact_id || inquiry.contact_id || null,
    inquiryId: inquiry.id,
    assignedTo: agentId || inquiry.agent_id || inquiry.assigned_to || null,
    type,
    title,
    notes: viewing.outcome_notes || viewing.notes || '',
    dueAt,
    priority: viewing.outcome === 'interested' ? 'high' : 'normal',
    createdBy: agentId || inquiry.agent_id || null,
  })

  await syncInquiryNextFollowUp(inquiry.id)
  return task
}
