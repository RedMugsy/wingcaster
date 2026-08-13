import { v4 as uuidv4 } from 'uuid'
import { findAllModule, findOneModule, insertModule, updateModule, removeModule } from '../infrastructure/db.js'

export function createSourceTypeService({ config, logger }) {
  async function list({ isActive, isDefault, archetype, search } = {}) {
    let rows = await findAllModule('source_types')
    if (isActive !== undefined) rows = rows.filter((s) => s.is_active === isActive)
    if (isDefault !== undefined) rows = rows.filter((s) => s.is_default === isDefault)
    if (archetype) rows = rows.filter((s) => s.archetype === archetype)
    if (search) {
      const q = search.toLowerCase()
      rows = rows.filter(
        (s) =>
          s.name?.toLowerCase().includes(q) ||
          s.slug?.toLowerCase().includes(q) ||
          s.archetype?.toLowerCase().includes(q),
      )
    }
    return rows
  }

  async function getById(id) {
    return findOneModule('source_types', (s) => s.id === id)
  }

  async function getBySlug(slug) {
    return findOneModule('source_types', (s) => s.slug === slug)
  }

  async function create(payload) {
    const now = new Date().toISOString()
    const src = {
      id: uuidv4(),
      name: payload.name,
      slug: payload.slug,
      description: payload.description || '',
      archetype: payload.archetype,
      platform: payload.platform || null,
      input_method: payload.input_method,
      extraction_config: JSON.stringify(payload.extraction_config || {}),
      default_reliability: payload.default_reliability ?? 0.5,
      default_decay_days: payload.default_decay_days ?? 90,
      default_ai_prompt_template: payload.default_ai_prompt_template || null,
      is_active: payload.is_active ?? true,
      is_default: false,
      created_at: now,
      updated_at: now,
    }
    return insertModule('source_types', src)
  }

  async function updateSourceType(id, patch) {
    const existing = await getById(id)
    if (!existing) return null
    const updates = { ...existing, updated_at: new Date().toISOString() }
    const allowed = [
      'name',
      'slug',
      'description',
      'archetype',
      'platform',
      'input_method',
      'extraction_config',
      'default_reliability',
      'default_decay_days',
      'default_ai_prompt_template',
      'is_active',
    ]
    for (const key of allowed) {
      if (patch[key] !== undefined) {
        updates[key] = key === 'extraction_config' && typeof patch[key] === 'object'
          ? JSON.stringify(patch[key])
          : patch[key]
      }
    }
    await updateModule('source_types', (s) => s.id === id, () => updates)
    return updates
  }

  async function removeSourceType(id) {
    const existing = await getById(id)
    if (existing?.is_default) {
      throw new Error('Cannot delete a default source type')
    }
    return removeModule('source_types', (s) => s.id === id)
  }

  return { list, getById, getBySlug, create, update: updateSourceType, remove: removeSourceType }
}
