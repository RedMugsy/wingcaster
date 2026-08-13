import { v4 as uuidv4 } from 'uuid'
import { findAllModule, findOneModule, insertModule, updateModule, removeModule } from '../infrastructure/db.js'

export function createSourceService({ config, logger }) {
  async function listForArea(areaId, { isMonitored } = {}) {
    let rows = await findAllModule('area_sources', (s) => s.area_id === areaId)
    if (isMonitored !== undefined) rows = rows.filter((s) => s.is_monitored === isMonitored)
    return rows
  }

  async function getById(id) {
    return findOneModule('area_sources', (s) => s.id === id)
  }

  async function create(payload) {
    const now = new Date().toISOString()
    const source = {
      id: uuidv4(),
      area_id: payload.area_id,
      source_type_id: payload.source_type_id,
      name: payload.name || null,
      handle: payload.handle || null,
      url: payload.url || null,
      api_endpoint: payload.api_endpoint || null,
      feed_url: payload.feed_url || null,
      reliability_override: payload.reliability_override ?? null,
      decay_days_override: payload.decay_days_override ?? null,
      is_monitored: payload.is_monitored ?? true,
      last_fetched_at: null,
      auth_config: payload.auth_config ? JSON.stringify(payload.auth_config) : null,
      created_at: now,
      updated_at: now,
    }
    return insertModule('area_sources', source)
  }

  async function updateSource(id, patch) {
    const existing = await getById(id)
    if (!existing) return null
    const updates = { ...existing, updated_at: new Date().toISOString() }
    const allowed = [
      'area_id',
      'source_type_id',
      'name',
      'handle',
      'url',
      'api_endpoint',
      'feed_url',
      'reliability_override',
      'decay_days_override',
      'is_monitored',
      'last_fetched_at',
      'auth_config',
    ]
    for (const key of allowed) {
      if (patch[key] !== undefined) {
        updates[key] = key === 'auth_config' && typeof patch[key] === 'object'
          ? JSON.stringify(patch[key])
          : patch[key]
      }
    }
    await updateModule('area_sources', (s) => s.id === id, () => updates)
    return updates
  }

  async function removeSource(id) {
    return removeModule('area_sources', (s) => s.id === id)
  }

  return { listForArea, getById, create, update: updateSource, remove: removeSource }
}
