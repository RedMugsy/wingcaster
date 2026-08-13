import { v4 as uuidv4 } from 'uuid'
import { findAllModule, findOneModule, insertModule, updateModule, removeModule } from '../infrastructure/db.js'

export function createAiConfigService({ config, logger }) {
  async function list({ isActive } = {}) {
    let rows = await findAllModule('ai_scoring_configs')
    if (isActive !== undefined) rows = rows.filter((c) => c.is_active === isActive)
    return rows
  }

  async function getById(id) {
    return findOneModule('ai_scoring_configs', (c) => c.id === id)
  }

  async function getActive() {
    return findOneModule('ai_scoring_configs', (c) => c.is_active)
  }

  async function create(payload) {
    const now = new Date().toISOString()
    const cfg = {
      id: uuidv4(),
      name: payload.name,
      description: payload.description || '',
      provider: payload.provider,
      model: payload.model || null,
      temperature: payload.temperature ?? 0.3,
      max_tokens: payload.max_tokens ?? 2048,
      system_prompt: payload.system_prompt,
      scoring_prompt_template: payload.scoring_prompt_template,
      output_schema: JSON.stringify(payload.output_schema || {}),
      is_active: payload.is_active ?? true,
      created_at: now,
      updated_at: now,
    }
    return insertModule('ai_scoring_configs', cfg)
  }

  async function updateConfig(id, patch) {
    const existing = await getById(id)
    if (!existing) return null
    const updates = { ...existing, updated_at: new Date().toISOString() }
    const allowed = [
      'name',
      'description',
      'provider',
      'model',
      'temperature',
      'max_tokens',
      'system_prompt',
      'scoring_prompt_template',
      'output_schema',
      'is_active',
    ]
    for (const key of allowed) {
      if (patch[key] !== undefined) {
        updates[key] = key === 'output_schema' && typeof patch[key] === 'object'
          ? JSON.stringify(patch[key])
          : patch[key]
      }
    }
    await updateModule('ai_scoring_configs', (c) => c.id === id, () => updates)
    return updates
  }

  async function removeConfig(id) {
    return removeModule('ai_scoring_configs', (c) => c.id === id)
  }

  return { list, getById, getActive, create, update: updateConfig, remove: removeConfig }
}
