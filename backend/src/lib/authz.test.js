import { describe, expect, it } from 'vitest'
import { createAuthz, NotFoundError } from './authz.js'

const agents = [
  { id: 'owner', agency_id: 'agency-a', role: 'agent' },
  { id: 'member', agency_id: 'agency-a', role: 'agent' },
  { id: 'admin', agency_id: 'agency-a', role: 'admin' },
  { id: 'outsider', agency_id: 'agency-b', role: 'admin' },
]

const definitions = [
  ['Conversation', 'conversations', 'assigned_agent_id'],
  ['Contact', 'contacts', 'assigned_agent_id'],
  ['Opportunity', 'opportunities', 'agent_id'],
  ['Task', 'tasks', 'assigned_to'],
  ['Viewing', 'viewings', 'agent_id'],
  ['Property', 'properties', 'agent_id'],
  ['Campaign', 'campaigns', 'agent_id'],
  ['Distribution', 'distributions', 'agent_id'],
]

function fixturesFor(collection, ownerField) {
  return {
    agents,
    agency_members: [
      { id: 'm-owner', agent_id: 'owner', agency_id: 'agency-a', role: 'agent', status: 'active' },
      { id: 'm-member', agent_id: 'member', agency_id: 'agency-a', role: 'agent', status: 'active' },
      { id: 'm-admin', agent_id: 'admin', agency_id: 'agency-a', role: 'admin', status: 'active' },
      { id: 'm-outsider', agent_id: 'outsider', agency_id: 'agency-b', role: 'admin', status: 'active' },
    ],
    [collection]: [{ id: 'resource', [ownerField]: 'owner', agency_id: 'agency-a' }],
  }
}

function buildAuthz(fixtures) {
  const dal = {
    findAll: async (collection, predicate = () => true) => (fixtures[collection] || []).filter(predicate),
    findOne: async (collection, predicate) => (fixtures[collection] || []).find(predicate) || null,
  }
  return createAuthz(dal)
}

describe.each(definitions)('assertOwns%s', (resource, collection, ownerField) => {
  const assertionName = `assertOwns${resource}`

  it('allows the owner', async () => {
    await expect(buildAuthz(fixturesFor(collection, ownerField))[assertionName]('owner', 'resource')).resolves.toMatchObject({ id: 'resource' })
  })

  it('rejects a non-owner without tenant access using NotFoundError', async () => {
    await expect(buildAuthz(fixturesFor(collection, ownerField))[assertionName]('outsider', 'resource')).rejects.toBeInstanceOf(NotFoundError)
  })

  it('allows same-agency access according to the resource rule', async () => {
    const promise = buildAuthz(fixturesFor(collection, ownerField))[assertionName]('member', 'resource')
    if (resource === 'Task') await expect(promise).rejects.toBeInstanceOf(NotFoundError)
    else await expect(promise).resolves.toMatchObject({ id: 'resource' })
  })

  it('allows an agency admin within the agency', async () => {
    await expect(buildAuthz(fixturesFor(collection, ownerField))[assertionName]('admin', 'resource')).resolves.toMatchObject({ id: 'resource' })
  })

  it('rejects a missing row without revealing whether it exists', async () => {
    await expect(buildAuthz(fixturesFor(collection, ownerField))[assertionName]('owner', 'missing')).rejects.toMatchObject({ status: 404, message: 'Not found' })
  })
})

describe('conversation assignment boundary', () => {
  it('allows self and another agent in the conversation agency', async () => {
    const authz = buildAuthz(fixturesFor('conversations', 'assigned_agent_id'))
    const conversation = { assigned_agent_id: 'owner', agency_id: 'agency-a' }
    await expect(authz.assertAssignableConversationAgent('owner', conversation, 'owner')).resolves.toBe(true)
    await expect(authz.assertAssignableConversationAgent('owner', conversation, 'member')).resolves.toBe(true)
  })

  it('rejects a target agent outside the conversation agency', async () => {
    const authz = buildAuthz(fixturesFor('conversations', 'assigned_agent_id'))
    await expect(authz.assertAssignableConversationAgent(
      'owner', { assigned_agent_id: 'owner', agency_id: 'agency-a' }, 'outsider',
    )).resolves.toBe(false)
  })
})
