import { v4 as uuidv4 } from 'uuid'
import { findAllModule, findOneModule, insertModule, updateModule, removeModule } from '../infrastructure/db.js'
import { SignalStatus } from '../domain/types.js'

export function createSignalService({ config, logger }) {
  async function list({ areaId, status, sourceTypeId, limit = 100, offset = 0 } = {}) {
    let rows = await findAllModule('area_signals')
    if (areaId) rows = rows.filter((s) => s.area_id === areaId)
    if (status) rows = rows.filter((s) => s.status === status)
    if (sourceTypeId) rows = rows.filter((s) => s.source_type_id === sourceTypeId)
    const total = rows.length
    return { items: rows.slice(offset, offset + limit).sort((a, b) => new Date(b.fetched_at || b.created_at).getTime() - new Date(a.fetched_at || a.created_at).getTime()), total }
  }

  async function getById(id) {
    return findOneModule('area_signals', (s) => s.id === id)
  }

  async function create(payload) {
    const now = new Date().toISOString()
    const signal = {
      id: uuidv4(),
      area_id: payload.area_id,
      area_source_id: payload.area_source_id || null,
      source_type_id: payload.source_type_id,
      signal_type: payload.signal_type,
      raw_content: payload.raw_content || null,
      raw_url: payload.raw_url || null,
      raw_media_urls: payload.raw_media_urls ? JSON.stringify(payload.raw_media_urls) : null,
      extracted_features: JSON.stringify(payload.extracted_features || {}),
      occurred_at: payload.occurred_at || now,
      fetched_at: now,
      status: payload.status || SignalStatus.PENDING_EXTRACTION,
      created_at: now,
      updated_at: now,
    }
    return insertModule('area_signals', signal)
  }

  async function updateSignal(id, patch) {
    const existing = await getById(id)
    if (!existing) return null
    const updates = { ...existing, updated_at: new Date().toISOString() }
    const allowed = [
      'area_id',
      'area_source_id',
      'source_type_id',
      'signal_type',
      'raw_content',
      'raw_url',
      'raw_media_urls',
      'extracted_features',
      'occurred_at',
      'fetched_at',
      'status',
    ]
    for (const key of allowed) {
      if (patch[key] !== undefined) {
        updates[key] =
          (key === 'raw_media_urls' || key === 'extracted_features') && typeof patch[key] === 'object'
            ? JSON.stringify(patch[key])
            : patch[key]
      }
    }
    await updateModule('area_signals', (s) => s.id === id, () => updates)
    return updates
  }

  async function currentFeatures(id) {
    const row = await getById(id)
    const value = row?.extracted_features
    if (typeof value === 'string') {
      try {
        return JSON.parse(value || '{}')
      } catch {
        return {}
      }
    }
    return value || {}
  }

  async function verifySignal(id, { verifiedBy, notes }) {
    return updateSignal(id, {
      status: SignalStatus.VERIFIED,
      extracted_features: { ...(await currentFeatures(id)), verified_by: verifiedBy, verified_notes: notes },
    })
  }

  async function rejectSignal(id, { verifiedBy, reason }) {
    return updateSignal(id, {
      status: SignalStatus.REJECTED,
      extracted_features: { ...(await currentFeatures(id)), rejected_by: verifiedBy, rejection_reason: reason },
    })
  }

  async function removeSignal(id) {
    return removeModule('area_signals', (s) => s.id === id)
  }

  return { list, getById, create, update: updateSignal, verify: verifySignal, reject: rejectSignal, remove: removeSignal }
}
