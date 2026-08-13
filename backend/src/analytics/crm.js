import { findAll } from '../db.js'
import { getPipelineSummary } from '../opportunities.js'

function parseDate(date) {
  if (!date) return null
  const d = new Date(date)
  return isNaN(d.getTime()) ? null : d
}

function isInRange(iso, startDate, endDate) {
  if (!iso) return false
  const d = parseDate(iso)
  if (!d) return false
  if (startDate && d < startDate) return false
  if (endDate && d >= endDate) return false
  return true
}

function startOfMonth(date) {
  return new Date(date.getFullYear(), date.getMonth(), 1)
}

function formatMonthBucket(date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`
}

function median(values) {
  if (!values.length) return null
  const sorted = [...values].sort((a, b) => a - b)
  const mid = Math.floor(sorted.length / 2)
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2
}

function average(values) {
  if (!values.length) return null
  return Math.round(values.reduce((s, v) => s + v, 0) / values.length)
}

function filterByAgent(items, agentId, key = 'agent_id') {
  if (!agentId) return items
  return items.filter((i) => i[key] === agentId || i.assigned_to === agentId || i.assigned_agent_id === agentId)
}

function filterByAgency(items, agencyId) {
  if (!agencyId) return items
  return items.filter((i) => i.agency_id === agencyId)
}

function applyScopeFilters({ items, agentId, agencyId, agentKey = 'agent_id', startDate, endDate, dateKey = 'created_at' }) {
  let rows = items
  if (agencyId) rows = filterByAgency(rows, agencyId)
  else if (agentId) rows = filterByAgent(rows, agentId, agentKey)
  if (startDate || endDate) {
    rows = rows.filter((r) => isInRange(r[dateKey], startDate, endDate))
  }
  return rows
}

function bucketByField(items, field) {
  const buckets = {}
  items.forEach((i) => {
    const key = i[field] || 'unknown'
    buckets[key] = (buckets[key] || 0) + 1
  })
  return buckets
}

export async function getCrmAnalytics({ agentId, agencyId, startDate, endDate } = {}) {
  const start = parseDate(startDate)
  const end = parseDate(endDate)

  const allOpportunities = await findAll('opportunities')
  const opportunities = applyScopeFilters({ items: allOpportunities, agentId, agencyId, startDate: start, endDate: end, dateKey: 'created_at' })

  const allContacts = await findAll('contacts')
  const contacts = applyScopeFilters({ items: allContacts, agentId, agencyId, agentKey: 'assigned_agent_id', startDate: start, endDate: end, dateKey: 'created_at' })

  const allTasks = await findAll('tasks')
  const tasks = applyScopeFilters({ items: allTasks, agentId, agencyId, startDate: start, endDate: end, dateKey: 'created_at' })

  const allViewings = await findAll('viewings')
  const viewings = applyScopeFilters({ items: allViewings, agentId, agencyId, startDate: start, endDate: end, dateKey: 'created_at' })

  const pipeline = agentId ? await getPipelineSummary(agentId) : computePipelineSummary(opportunities)

  const openOpportunities = opportunities.filter((o) => !['closed_won', 'closed_lost'].includes(o.stage))
  const closedWon = opportunities.filter((o) => o.stage === 'closed_won')
  const closedLost = opportunities.filter((o) => o.stage === 'closed_lost')
  const closed = closedWon.length + closedLost.length

  const opportunitiesCreated = opportunities.length
  const contactsCreated = contacts.length
  const conversionRate = contactsCreated ? Math.round((opportunitiesCreated / contactsCreated) * 100) : null
  const winRate = closed ? Math.round((closedWon.length / closed) * 100) : null

  // Lead sources by first touch channel
  const leadSources = bucketByField(contacts, 'first_touch_channel')

  // Contact status funnel
  const contactStatus = bucketByField(contacts, 'status')

  // Task performance
  const completedTasks = tasks.filter((t) => t.status === 'completed')
  const pendingTasks = tasks.filter((t) => t.status === 'pending')
  const overdueTasks = pendingTasks.filter((t) => t.due_at && new Date(t.due_at) < new Date())
  const taskCompletionRate = tasks.length ? Math.round((completedTasks.length / tasks.length) * 100) : null
  const taskOverdueRate = pendingTasks.length ? Math.round((overdueTasks.length / pendingTasks.length) * 100) : null

  // Tasks by priority
  const tasksByPriority = bucketByField(tasks, 'priority')

  // Viewings outcome
  const viewingsByOutcome = {}
  viewings.forEach((v) => {
    const key = v.outcome || v.status || 'unknown'
    viewingsByOutcome[key] = (viewingsByOutcome[key] || 0) + 1
  })

  // Revenue forecast by expected close month (open opportunities only)
  const revenueForecast = {}
  openOpportunities.forEach((o) => {
    if (!o.expected_close_date) return
    const d = parseDate(o.expected_close_date)
    if (!d) return
    const bucket = formatMonthBucket(d)
    revenueForecast[bucket] = (revenueForecast[bucket] || 0) + (Number(o.deal_value) || 0)
  })

  // Won revenue by close month
  const wonRevenueByMonth = {}
  closedWon.forEach((o) => {
    if (!o.closed_at && !o.updated_at) return
    const d = parseDate(o.closed_at || o.updated_at)
    if (!d) return
    const bucket = formatMonthBucket(d)
    wonRevenueByMonth[bucket] = (wonRevenueByMonth[bucket] || 0) + (Number(o.deal_value) || 0)
  })

  // Agent performance (only relevant when agency/platform scope)
  const opportunitiesByAgent = {}
  opportunities.forEach((o) => {
    const key = o.agent_id || 'unassigned'
    opportunitiesByAgent[key] = (opportunitiesByAgent[key] || 0) + 1
  })

  return {
    generated_at: new Date().toISOString(),
    scope: { agent_id: agentId || null, agency_id: agencyId || null, start_date: startDate || null, end_date: endDate || null },
    summary: {
      contacts_created: contactsCreated,
      opportunities_created: opportunitiesCreated,
      open_opportunities: openOpportunities.length,
      closed_won: closedWon.length,
      closed_lost: closedLost.length,
      win_rate: winRate,
      conversion_rate: conversionRate,
      total_pipeline_value: pipeline.total_value,
      weighted_pipeline_value: pipeline.weighted_value,
      total_tasks: tasks.length,
      completed_tasks: completedTasks.length,
      pending_tasks: pendingTasks.length,
      overdue_tasks: overdueTasks.length,
      task_completion_rate: taskCompletionRate,
      task_overdue_rate: taskOverdueRate,
      viewings_total: viewings.length,
    },
    pipeline: {
      ...pipeline,
      by_stage: pipeline.by_stage || {},
    },
    lead_sources: Object.entries(leadSources).map(([label, value]) => ({ label, value })).sort((a, b) => b.value - a.value),
    contact_funnel: Object.entries(contactStatus).map(([label, value]) => ({ label, value })).sort((a, b) => b.value - a.value),
    tasks_by_priority: Object.entries(tasksByPriority).map(([label, value]) => ({ label, value })).sort((a, b) => b.value - a.value),
    viewings_by_outcome: Object.entries(viewingsByOutcome).map(([label, value]) => ({ label, value })).sort((a, b) => b.value - a.value),
    revenue_forecast: Object.entries(revenueForecast).map(([label, value]) => ({ label, value })).sort((a, b) => a.label.localeCompare(b.label)),
    won_revenue_by_month: Object.entries(wonRevenueByMonth).map(([label, value]) => ({ label, value })).sort((a, b) => a.label.localeCompare(b.label)),
    opportunities_by_agent: Object.entries(opportunitiesByAgent).map(([label, value]) => ({ label, value })).sort((a, b) => b.value - a.value),
  }
}

function computePipelineSummary(opportunities) {
  const open = opportunities.filter((o) => !['closed_won', 'closed_lost'].includes(o.stage))
  const totalValue = open.reduce((sum, o) => sum + (Number(o.deal_value) || 0), 0)
  const weightedValue = open.reduce((sum, o) => sum + (Number(o.deal_value) || 0) * (Number(o.probability) || 0) / 100, 0)
  const byStage = {}
  open.forEach((o) => {
    byStage[o.stage] = (byStage[o.stage] || 0) + 1
  })
  return {
    total_opportunities: open.length,
    total_value: totalValue,
    weighted_value: Math.round(weightedValue),
    by_stage: byStage,
  }
}

export async function getCommunicationsAnalytics({ agentId, agencyId, startDate, endDate } = {}) {
  const start = parseDate(startDate)
  const end = parseDate(endDate)

  const allConversations = await findAll('conversations')
  const conversations = applyScopeFilters({ items: allConversations, agentId, agencyId, agentKey: 'assigned_agent_id', startDate: start, endDate: end, dateKey: 'created_at' })

  const allMessages = await findAll('conversation_messages')
  const messages = applyScopeFilters({ items: allMessages, agentId, agencyId, agentKey: 'created_by_agent_id', startDate: start, endDate: end, dateKey: 'created_at' })

  // Volume by channel
  const channelVolume = {}
  messages.forEach((m) => {
    const key = m.channel || 'unknown'
    if (!channelVolume[key]) channelVolume[key] = { inbound: 0, outbound: 0, total: 0 }
    channelVolume[key][m.direction] = (channelVolume[key][m.direction] || 0) + 1
    channelVolume[key].total += 1
  })

  // Status distribution for outbound messages
  const outboundStatuses = {}
  messages.filter((m) => m.direction === 'outbound').forEach((m) => {
    const key = m.status || 'unknown'
    outboundStatuses[key] = (outboundStatuses[key] || 0) + 1
  })

  // Conversation status distribution
  const conversationStatus = bucketByField(conversations, 'status')

  // Response time metrics per conversation
  const firstResponseTimes = []
  const allResponseTimes = []
  const conversationIds = [...new Set(conversations.map((c) => c.id))]

  conversationIds.forEach((conversationId) => {
    const thread = messages
      .filter((m) => m.conversation_id === conversationId)
      .sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime())

    let firstInbound = null
    for (const m of thread) {
      if (m.direction === 'inbound') {
        firstInbound = m
        break
      }
    }
    if (!firstInbound) return

    let firstOutboundAfter = null
    for (const m of thread) {
      if (m.direction === 'outbound' && new Date(m.created_at) >= new Date(firstInbound.created_at)) {
        firstOutboundAfter = m
        break
      }
    }
    if (firstOutboundAfter) {
      const ms = new Date(firstOutboundAfter.created_at).getTime() - new Date(firstInbound.created_at).getTime()
      if (ms >= 0) firstResponseTimes.push(ms)
    }

    // All inbound -> next outbound response times
    for (let i = 0; i < thread.length; i++) {
      if (thread[i].direction !== 'inbound') continue
      for (let j = i + 1; j < thread.length; j++) {
        if (thread[j].direction === 'outbound') {
          const ms = new Date(thread[j].created_at).getTime() - new Date(thread[i].created_at).getTime()
          if (ms >= 0) allResponseTimes.push(ms)
          break
        }
      }
    }
  })

  const formatDuration = (ms) => {
    if (ms === null) return null
    return {
      milliseconds: ms,
      minutes: Math.round(ms / 60000),
      hours: Number((ms / 3600000).toFixed(2)),
    }
  }

  const avgFirstResponse = firstResponseTimes.length ? average(firstResponseTimes) : null
  const medianFirstResponse = firstResponseTimes.length ? median(firstResponseTimes) : null
  const avgResponseTime = allResponseTimes.length ? average(allResponseTimes) : null
  const medianResponseTime = allResponseTimes.length ? median(allResponseTimes) : null

  // Unread conversations
  const unreadConversations = conversations.filter((c) => c.is_unread_by_agent || (c.unread_count || 0) > 0)

  // Assigned/unassigned split
  const assignedCount = conversations.filter((c) => c.assigned_agent_id).length
  const unassignedCount = conversations.length - assignedCount

  // Top agents by assigned conversations
  const conversationsByAgent = {}
  conversations.forEach((c) => {
    const key = c.assigned_agent_id || 'unassigned'
    conversationsByAgent[key] = (conversationsByAgent[key] || 0) + 1
  })

  return {
    generated_at: new Date().toISOString(),
    scope: { agent_id: agentId || null, agency_id: agencyId || null, start_date: startDate || null, end_date: endDate || null },
    summary: {
      conversations_total: conversations.length,
      messages_total: messages.length,
      inbound_messages: messages.filter((m) => m.direction === 'inbound').length,
      outbound_messages: messages.filter((m) => m.direction === 'outbound').length,
      unread_conversations: unreadConversations.length,
      assigned_conversations: assignedCount,
      unassigned_conversations: unassignedCount,
    },
    channel_volume: Object.entries(channelVolume).map(([label, value]) => ({ label, ...value })).sort((a, b) => b.total - a.total),
    outbound_statuses: Object.entries(outboundStatuses).map(([label, value]) => ({ label, value })).sort((a, b) => b.value - a.value),
    conversation_status: Object.entries(conversationStatus).map(([label, value]) => ({ label, value })).sort((a, b) => b.value - a.value),
    first_response_time: {
      average: formatDuration(avgFirstResponse),
      median: formatDuration(medianFirstResponse),
      sample_count: firstResponseTimes.length,
    },
    response_time: {
      average: formatDuration(avgResponseTime),
      median: formatDuration(medianResponseTime),
      sample_count: allResponseTimes.length,
    },
    conversations_by_agent: Object.entries(conversationsByAgent).map(([label, value]) => ({ label, value })).sort((a, b) => b.value - a.value),
  }
}

export default { getCrmAnalytics, getCommunicationsAnalytics }
