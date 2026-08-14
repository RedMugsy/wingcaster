import { findAll, findOne } from '../db.js'

export class NotFoundError extends Error {
  constructor() {
    super('Not found')
    this.name = 'NotFoundError'
    this.status = 404
  }
}

const RESOURCE_RULES = {
  conversation: { collection: 'conversations', agentFields: ['assigned_agent_id'], sameAgency: true },
  contact: { collection: 'contacts', agentFields: ['assigned_agent_id'], sameAgency: true },
  opportunity: { collection: 'opportunities', agentFields: ['agent_id'], sameAgency: true },
  task: { collection: 'tasks', agentFields: ['assigned_to', 'created_by'], adminOnlyAgency: true },
  viewing: { collection: 'viewings', agentFields: ['agent_id'], sameAgency: true },
  property: { collection: 'properties', agentFields: ['agent_id'], sameAgency: true },
  campaign: { collection: 'campaigns', agentFields: ['agent_id', 'created_by'], sameAgency: true },
  distribution: { collection: 'distributions', agentFields: ['agent_id'], sameAgency: true },
}

export function createAuthz(dal = { findAll, findOne }) {
  async function activeMemberships(agentId) {
    return dal.findAll('agency_members', (member) =>
      member.status === 'active' && (member.agent_id === agentId || member.user_id === agentId))
  }

  async function principal(agentId) {
    const agent = await dal.findOne('agents', (row) => row.id === agentId || row.user_id === agentId)
    const memberships = await activeMemberships(agentId)
    const agencyIds = new Set([agent?.agency_id, ...memberships.map((member) => member.agency_id)].filter(Boolean))
    const adminAgencyIds = new Set(memberships.filter((member) => member.role === 'admin').map((member) => member.agency_id))
    if (agent?.role === 'admin') for (const agencyId of agencyIds) adminAgencyIds.add(agencyId)
    return { agencyIds, adminAgencyIds }
  }

  async function rowAgencyIds(row, agentFields) {
    const agencyIds = new Set([row.agency_id].filter(Boolean))
    for (const field of agentFields) {
      const targetAgentId = row[field]
      if (!targetAgentId) continue
      const target = await dal.findOne('agents', (agent) => agent.id === targetAgentId || agent.user_id === targetAgentId)
      if (target?.agency_id) agencyIds.add(target.agency_id)
      const memberships = await activeMemberships(targetAgentId)
      for (const membership of memberships) agencyIds.add(membership.agency_id)
    }
    return agencyIds
  }

  async function assertOwns(kind, agentId, resourceId) {
    const rule = RESOURCE_RULES[kind]
    const row = await dal.findOne(rule.collection, (candidate) => candidate.id === resourceId)
    if (!row) throw new NotFoundError()
    if (rule.agentFields.some((field) => row[field] === agentId)) return row

    const caller = await principal(agentId)
    const targetAgencyIds = await rowAgencyIds(row, rule.agentFields)
    const permittedAgencies = rule.adminOnlyAgency ? caller.adminAgencyIds : caller.agencyIds
    if ([...targetAgencyIds].some((agencyId) => permittedAgencies.has(agencyId))) return row
    throw new NotFoundError()
  }

  async function assertAssignableConversationAgent(callerId, conversation, targetAgentId) {
    if (targetAgentId === callerId) return true
    const caller = await principal(callerId)
    const conversationAgencies = await rowAgencyIds(conversation, ['assigned_agent_id'])
    const target = await dal.findOne('agents', (agent) => agent.id === targetAgentId || agent.user_id === targetAgentId)
    if (!target) return false
    const targetAgencies = await rowAgencyIds({ agent_id: targetAgentId, agency_id: target.agency_id }, ['agent_id'])
    return [...targetAgencies].some((agencyId) => caller.agencyIds.has(agencyId) && conversationAgencies.has(agencyId))
  }

  return {
    assertOwnsConversation: (agentId, id) => assertOwns('conversation', agentId, id),
    assertOwnsContact: (agentId, id) => assertOwns('contact', agentId, id),
    assertOwnsOpportunity: (agentId, id) => assertOwns('opportunity', agentId, id),
    assertOwnsTask: (agentId, id) => assertOwns('task', agentId, id),
    assertOwnsViewing: (agentId, id) => assertOwns('viewing', agentId, id),
    assertOwnsProperty: (agentId, id) => assertOwns('property', agentId, id),
    assertOwnsCampaign: (agentId, id) => assertOwns('campaign', agentId, id),
    assertOwnsDistribution: (agentId, id) => assertOwns('distribution', agentId, id),
    assertAssignableConversationAgent,
  }
}

const authz = createAuthz()
export const assertOwnsConversation = authz.assertOwnsConversation
export const assertOwnsContact = authz.assertOwnsContact
export const assertOwnsOpportunity = authz.assertOwnsOpportunity
export const assertOwnsTask = authz.assertOwnsTask
export const assertOwnsViewing = authz.assertOwnsViewing
export const assertOwnsProperty = authz.assertOwnsProperty
export const assertOwnsCampaign = authz.assertOwnsCampaign
export const assertOwnsDistribution = authz.assertOwnsDistribution
export const assertAssignableConversationAgent = authz.assertAssignableConversationAgent
