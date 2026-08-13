import { v4 as uuidv4 } from 'uuid'
import { findAllModule, findOneModule, insertModule, updateModule, removeModule } from '../infrastructure/db.js'

export function createDimensionService({ config, logger }) {
  async function list({ isActive, isDefault, search } = {}) {
    let rows = await findAllModule('score_dimensions')
    if (isActive !== undefined) rows = rows.filter((d) => d.is_active === isActive)
    if (isDefault !== undefined) rows = rows.filter((d) => d.is_default === isDefault)
    if (search) {
      const q = search.toLowerCase()
      rows = rows.filter(
        (d) =>
          d.name?.toLowerCase().includes(q) ||
          d.name_ar?.toLowerCase().includes(q) ||
          d.slug?.toLowerCase().includes(q),
      )
    }
    return rows.sort((a, b) => (a.sort_order || 0) - (b.sort_order || 0))
  }

  async function getById(id) {
    return findOneModule('score_dimensions', (d) => d.id === id)
  }

  async function getBySlug(slug) {
    return findOneModule('score_dimensions', (d) => d.slug === slug)
  }

  async function create(payload) {
    const now = new Date().toISOString()
    const dim = {
      id: uuidv4(),
      name: payload.name,
      name_ar: payload.name_ar,
      description: payload.description || '',
      slug: payload.slug,
      display_config: JSON.stringify(payload.display_config || {}),
      scoring_logic_config: JSON.stringify(payload.scoring_logic_config || {}),
      composite_weight: payload.composite_weight ?? 0,
      sort_order: payload.sort_order ?? 0,
      is_active: payload.is_active ?? true,
      is_default: false,
      created_at: now,
      updated_at: now,
    }
    return insertModule('score_dimensions', dim)
  }

  async function updateDimension(id, patch) {
    const existing = await getById(id)
    if (!existing) return null
    const updates = { ...existing, updated_at: new Date().toISOString() }
    const allowed = [
      'name',
      'name_ar',
      'description',
      'slug',
      'display_config',
      'scoring_logic_config',
      'composite_weight',
      'sort_order',
      'is_active',
    ]
    for (const key of allowed) {
      if (patch[key] !== undefined) {
        updates[key] =
          (key === 'display_config' || key === 'scoring_logic_config') && typeof patch[key] === 'object'
            ? JSON.stringify(patch[key])
            : patch[key]
      }
    }
    await updateModule('score_dimensions', (d) => d.id === id, () => updates)
    return updates
  }

  async function removeDimension(id) {
    const existing = await getById(id)
    if (existing?.is_default) {
      throw new Error('Cannot delete a default dimension')
    }
    return removeModule('score_dimensions', (d) => d.id === id)
  }

  return { list, getById, getBySlug, create, update: updateDimension, remove: removeDimension }
}
