import { v4 as uuidv4 } from 'uuid'
import { findAll, findOne, insert, update } from './db.js'

export const OPPORTUNITY_STAGES = [
  'new',
  'qualification',
  'viewing',
  'offer',
  'negotiation',
  'closed_won',
  'closed_lost',
]

const STAGE_PROBABILITY = {
  new: 10,
  qualification: 25,
  viewing: 40,
  offer: 60,
  negotiation: 80,
  closed_won: 100,
  closed_lost: 0,
}

function nowIso() {
  return new Date().toISOString()
}

export function getStageProbability(stage) {
  return STAGE_PROBABILITY[stage] ?? 25
}

export async function createOpportunity({
  contactId,
  propertyId,
  agentId,
  agencyId,
  stage = 'new',
  dealValue,
  currency = 'USD',
  probability,
  expectedCloseDate,
  source = 'manual',
  notes = '',
}) {
  if (!contactId) throw new Error('contact_id is required')
  if (!OPPORTUNITY_STAGES.includes(stage)) throw new Error(`Invalid opportunity stage: ${stage}`)

  const opportunity = {
    id: uuidv4(),
    contact_id: contactId,
    property_id: propertyId || null,
    agent_id: agentId || null,
    agency_id: agencyId || null,
    stage,
    deal_value: dealValue != null ? Number(dealValue) : null,
    currency,
    probability: probability != null ? Number(probability) : getStageProbability(stage),
    expected_close_date: expectedCloseDate || null,
    lost_reason: '',
    closed_at: null,
    source,
    notes,
    created_at: nowIso(),
    updated_at: nowIso(),
  }
  await insert('opportunities', opportunity)
  await recordStageHistory({
    opportunityId: opportunity.id,
    fromStage: null,
    toStage: stage,
    changedBy: agentId,
    reason: `Opportunity created from ${source}`,
  })
  return opportunity
}

export async function getOpportunityById(id) {
  return await findOne('opportunities', (o) => o.id === id)
}

export async function getOpportunities({ agentId, contactId, propertyId, status, stage } = {}) {
  let rows = await findAll('opportunities')
  if (agentId) rows = rows.filter((o) => o.agent_id === agentId)
  if (contactId) rows = rows.filter((o) => o.contact_id === contactId)
  if (propertyId) rows = rows.filter((o) => o.property_id === propertyId)
  if (status === 'open') rows = rows.filter((o) => !['closed_won', 'closed_lost'].includes(o.stage))
  if (status === 'closed') rows = rows.filter((o) => ['closed_won', 'closed_lost'].includes(o.stage))
  if (stage) rows = rows.filter((o) => o.stage === stage)
  rows.sort((a, b) => new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime())
  return rows
}

export async function recordStageHistory({ opportunityId, fromStage, toStage, changedBy, reason = '' }) {
  if (fromStage === toStage) return null
  const history = {
    id: uuidv4(),
    opportunity_id: opportunityId,
    from_stage: fromStage,
    to_stage: toStage,
    changed_by: changedBy || null,
    reason,
    changed_at: nowIso(),
    created_at: nowIso(),
  }
  await insert('opportunity_stage_history', history)
  return history
}

export async function getStageHistory(opportunityId) {
  const rows = await findAll('opportunity_stage_history', (h) => h.opportunity_id === opportunityId)
  return rows.sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime())
}

export async function updateOpportunity(id, patch, { changedBy } = {}) {
  const opportunity = await findOne('opportunities', (o) => o.id === id)
  if (!opportunity) return null

  const allowed = ['stage', 'deal_value', 'currency', 'probability', 'expected_close_date', 'lost_reason', 'notes', 'property_id', 'agent_id']
  const next = { ...opportunity, updated_at: nowIso() }
  for (const key of allowed) {
    if (patch[key] !== undefined) next[key] = patch[key]
  }

  if (patch.stage && !OPPORTUNITY_STAGES.includes(patch.stage)) {
    throw new Error(`Invalid opportunity stage: ${patch.stage}`)
  }

  if (patch.probability === undefined && patch.stage) {
    next.probability = getStageProbability(patch.stage)
  }

  if (patch.stage && ['closed_won', 'closed_lost'].includes(patch.stage) && !next.closed_at) {
    next.closed_at = nowIso()
  } else if (patch.stage && !['closed_won', 'closed_lost'].includes(patch.stage)) {
    next.closed_at = null
  }

  const stageChanged = patch.stage && patch.stage !== opportunity.stage
  await update('opportunities', (o) => o.id === id, () => next)

  if (stageChanged) {
    await recordStageHistory({
      opportunityId: id,
      fromStage: opportunity.stage,
      toStage: next.stage,
      changedBy,
      reason: patch.lost_reason || patch.notes || 'Stage updated',
    })
  }

  return await findOne('opportunities', (o) => o.id === id)
}

export async function closeOpportunity(id, { status, lostReason, changedBy }) {
  if (!['closed_won', 'closed_lost'].includes(status)) {
    throw new Error('status must be closed_won or closed_lost')
  }
  return await updateOpportunity(id, { stage: status, lost_reason: lostReason || '' }, { changedBy })
}

/**
 * Find or create an opportunity tied to the viewing's contact/property,
 * advancing it based on the outcome.
 */
export async function createOrAdvanceOpportunityFromViewing({ viewing, inquiry, agentId }) {
  if (!viewing || !inquiry || viewing.status !== 'completed') return null

  const existing = await findOne('opportunities', (o) =>
    o.contact_id === (viewing.contact_id || inquiry.contact_id) &&
    o.property_id === (viewing.property_id || inquiry.property_id) &&
    !['closed_won', 'closed_lost'].includes(o.stage),
  )

  if (viewing.outcome === 'interested') {
    const property = viewing.property_id ? await findOne('properties', (p) => p.id === viewing.property_id) : null
    if (existing) {
      return await updateOpportunity(existing.id, { stage: 'offer' }, { changedBy: agentId })
    }
    return await createOpportunity({
      contactId: viewing.contact_id || inquiry.contact_id,
      propertyId: viewing.property_id || inquiry.property_id,
      agentId: agentId || inquiry.agent_id || inquiry.assigned_to,
      agencyId: inquiry.agency_id,
      stage: 'offer',
      dealValue: property?.price || null,
      currency: property?.price_unit === 'month' ? 'USD' : 'USD',
      source: 'viewing',
      notes: viewing.outcome_notes || '',
    })
  }

  if (viewing.outcome === 'not_interested' && existing) {
    return await updateOpportunity(existing.id, { stage: 'closed_lost', lost_reason: 'Not interested after viewing' }, { changedBy: agentId })
  }

  return existing
}

export async function getPipelineSummary(agentId) {
  const rows = await getOpportunities({ agentId, status: 'open' })
  const totalValue = rows.reduce((sum, o) => sum + (Number(o.deal_value) || 0), 0)
  const weightedValue = rows.reduce((sum, o) => sum + (Number(o.deal_value) || 0) * (Number(o.probability) || 0) / 100, 0)
  const byStage = {}
  rows.forEach((o) => {
    byStage[o.stage] = (byStage[o.stage] || 0) + 1
  })
  return {
    total_opportunities: rows.length,
    total_value: totalValue,
    weighted_value: Math.round(weightedValue),
    by_stage: byStage,
  }
}
