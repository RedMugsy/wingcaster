import { v4 as uuidv4 } from 'uuid'
import { findAllModule, findOneModule, insertModule, updateModule, removeModule } from '../infrastructure/db.js'
import { AreaStatus, defaultRadiiForLevel } from '../domain/types.js'

export function createAreaService({ adapter, config, logger }) {
  async function list({ status, level, search, limit = 100, offset = 0 } = {}) {
    let rows = await findAllModule('area_profiles')
    if (status) rows = rows.filter((a) => a.status === status)
    if (level) rows = rows.filter((a) => a.level === level)
    if (search) {
      const q = search.toLowerCase()
      rows = rows.filter(
        (a) =>
          a.name?.toLowerCase().includes(q) ||
          a.name_ar?.toLowerCase().includes(q) ||
          a.slug?.toLowerCase().includes(q) ||
          a.summary?.toLowerCase().includes(q),
      )
    }
    const total = rows.length
    return { items: rows.slice(offset, offset + limit), total }
  }

  async function getById(id) {
    return findOneModule('area_profiles', (a) => a.id === id)
  }

  async function getBySlug(slug) {
    return findOneModule('area_profiles', (a) => a.slug === slug)
  }

  async function create(payload) {
    const now = new Date().toISOString()
    const radii = payload.proximity_radii_json || defaultRadiiForLevel(payload.level)
    const area = {
      id: uuidv4(),
      name: payload.name,
      name_ar: payload.name_ar,
      slug: payload.slug,
      level: payload.level,
      parent_id: payload.parent_id || null,
      center_latitude: Number(payload.center_latitude),
      center_longitude: Number(payload.center_longitude),
      boundary_geojson: payload.boundary_geojson || null,
      proximity_radii_json: typeof radii === 'string' ? radii : JSON.stringify(radii),
      summary: payload.summary || '',
      summary_ar: payload.summary_ar || '',
      lifestyle_profile: payload.lifestyle_profile || '',
      investment_outlook: payload.investment_outlook || '',
      activity_score: payload.activity_score ?? null,
      activity_trend: payload.activity_trend || null,
      family_profile_skew: payload.family_profile_skew || null,
      estimated_population_density: payload.estimated_population_density || null,
      status: payload.status || AreaStatus.DRAFT,
      published_at: null,
      created_at: now,
      updated_at: now,
    }
    return insertModule('area_profiles', area)
  }

  async function updateArea(id, patch) {
    const existing = await getById(id)
    if (!existing) return null
    const now = new Date().toISOString()
    const updates = { ...existing, updated_at: now }

    const allowed = [
      'name',
      'name_ar',
      'slug',
      'level',
      'parent_id',
      'center_latitude',
      'center_longitude',
      'boundary_geojson',
      'proximity_radii_json',
      'summary',
      'summary_ar',
      'lifestyle_profile',
      'investment_outlook',
      'activity_score',
      'activity_trend',
      'family_profile_skew',
      'estimated_population_density',
      'status',
    ]
    for (const key of allowed) {
      if (patch[key] !== undefined) {
        updates[key] = key === 'proximity_radii_json' && typeof patch[key] === 'object'
          ? JSON.stringify(patch[key])
          : patch[key]
      }
    }
    if (patch.status === AreaStatus.SCORING_ENABLED && !existing.published_at) {
      updates.published_at = now
    }
    await updateModule('area_profiles', (a) => a.id === id, () => updates)
    return updates
  }

  async function removeArea(id) {
    return removeModule('area_profiles', (a) => a.id === id)
  }

  async function getChildren(parentId) {
    return findAllModule('area_profiles', (a) => a.parent_id === parentId)
  }

  async function listPublic({ level, search, limit = 100, offset = 0 } = {}) {
    const rows = await findAllModule('area_profiles', (a) => a.status === AreaStatus.SCORING_ENABLED)
    let filtered = rows
    if (level) filtered = filtered.filter((a) => a.level === level)
    if (search) {
      const q = search.toLowerCase()
      filtered = filtered.filter(
        (a) =>
          a.name?.toLowerCase().includes(q) ||
          a.name_ar?.toLowerCase().includes(q) ||
          a.slug?.toLowerCase().includes(q),
      )
    }
    const total = filtered.length
    return { items: filtered.slice(offset, offset + limit), total }
  }

  return {
    list,
    getById,
    getBySlug,
    create,
    update: updateArea,
    remove: removeArea,
    getChildren,
    listPublic,
  }
}
