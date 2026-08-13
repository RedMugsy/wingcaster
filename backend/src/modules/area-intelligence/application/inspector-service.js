import { v4 as uuidv4 } from 'uuid'
import { findAllModule, findOneModule, insertModule, updateModule, removeModule } from '../infrastructure/db.js'
import { AssignmentStatus, SubmissionStatus } from '../domain/types.js'

export function createInspectorService({ adapter, config, logger }) {
  async function listAssignments({ agentId, areaId, status } = {}) {
    let rows = await findAllModule('inspector_assignments')
    if (agentId) rows = rows.filter((a) => a.agent_id === agentId)
    if (areaId) rows = rows.filter((a) => a.area_id === areaId)
    if (status) rows = rows.filter((a) => a.status === status)
    return rows.sort((a, b) => new Date(b.assigned_at).getTime() - new Date(a.assigned_at).getTime())
  }

  async function getAssignmentById(id) {
    return findOneModule('inspector_assignments', (a) => a.id === id)
  }

  async function createAssignment(payload) {
    const now = new Date().toISOString()
    const assignment = {
      id: uuidv4(),
      agent_id: payload.agent_id,
      area_id: payload.area_id,
      assigned_by: payload.assigned_by || null,
      assigned_at: now,
      due_at: payload.due_at || null,
      completed_at: null,
      notes: payload.notes || null,
      status: AssignmentStatus.PENDING,
      created_at: now,
      updated_at: now,
    }
    return insertModule('inspector_assignments', assignment)
  }

  async function updateAssignmentStatus(id, status, { completedAt } = {}) {
    const existing = await getAssignmentById(id)
    if (!existing) return null
    const updates = { ...existing, status, updated_at: new Date().toISOString() }
    if (status === AssignmentStatus.COMPLETED && !existing.completed_at) {
      updates.completed_at = completedAt || new Date().toISOString()
    }
    await updateModule('inspector_assignments', (a) => a.id === id, () => updates)
    return updates
  }

  async function listSubmissions({ areaId, agentId, status } = {}) {
    let rows = await findAllModule('inspection_submissions')
    if (areaId) rows = rows.filter((s) => s.area_id === areaId)
    if (agentId) rows = rows.filter((s) => s.agent_id === agentId)
    if (status) rows = rows.filter((s) => s.status === status)
    return rows.sort((a, b) => new Date(b.submitted_at).getTime() - new Date(a.submitted_at).getTime())
  }

  async function getSubmissionById(id) {
    return findOneModule('inspection_submissions', (s) => s.id === id)
  }

  async function createSubmission(payload) {
    const now = new Date().toISOString()
    const submission = {
      id: uuidv4(),
      assignment_id: payload.assignment_id,
      agent_id: payload.agent_id,
      area_id: payload.area_id,
      gps_latitude: Number(payload.gps_latitude),
      gps_longitude: Number(payload.gps_longitude),
      photo_urls: payload.photo_urls ? JSON.stringify(payload.photo_urls) : null,
      dimension_scores: JSON.stringify(payload.dimension_scores || {}),
      notes: payload.notes || null,
      status: SubmissionStatus.PENDING_REVIEW,
      reviewed_by: null,
      reviewed_at: null,
      review_notes: null,
      submitted_at: now,
      created_at: now,
      updated_at: now,
    }
    return insertModule('inspection_submissions', submission)
  }

  async function reviewSubmission(id, { status, reviewedBy, reviewNotes }) {
    const existing = await getSubmissionById(id)
    if (!existing) return null
    const updates = {
      ...existing,
      status,
      reviewed_by: reviewedBy,
      reviewed_at: new Date().toISOString(),
      review_notes: reviewNotes || null,
      updated_at: new Date().toISOString(),
    }
    await updateModule('inspection_submissions', (s) => s.id === id, () => updates)
    return updates
  }

  return {
    listAssignments,
    getAssignmentById,
    createAssignment,
    updateAssignmentStatus,
    listSubmissions,
    getSubmissionById,
    createSubmission,
    reviewSubmission,
  }
}
