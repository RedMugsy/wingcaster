import { Collections } from '../infrastructure/db.js'
import { DEFAULT_MATCH_CONFIG } from '../domain/types.js'

export function createConfigService({ dal, config, logger }) {
  async function getDefaultConfig() {
    let cfg = await dal.findOne(Collections.PRICING_MATCH_CONFIGS, (c) => c.is_default === true)
    if (!cfg) {
      cfg = await dal.insert(Collections.PRICING_MATCH_CONFIGS, {
        id: crypto.randomUUID(),
        name: 'Default comparable match config',
        config_json: DEFAULT_MATCH_CONFIG,
        is_default: true,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
    }
    return cfg
  }

  async function getConfigById(id) {
    return dal.findOne(Collections.PRICING_MATCH_CONFIGS, (c) => c.id === id)
  }

  async function listConfigs() {
    return dal.findAll(Collections.PRICING_MATCH_CONFIGS, () => true)
  }

  async function createConfig(payload) {
    const now = new Date().toISOString()
    const item = {
      id: crypto.randomUUID(),
      name: payload.name,
      config_json: payload.config_json || DEFAULT_MATCH_CONFIG,
      is_default: payload.is_default || false,
      created_at: now,
      updated_at: now,
      data: payload.data || {},
    }
    if (item.is_default) {
      await unsetDefaultFlag()
    }
    return dal.insert(Collections.PRICING_MATCH_CONFIGS, item)
  }

  async function updateConfig(id, payload) {
    const existing = await dal.findOne(Collections.PRICING_MATCH_CONFIGS, (c) => c.id === id)
    if (!existing) return null
    if (payload.is_default) {
      await unsetDefaultFlag(id)
    }
    let updatedRecord = null
    await dal.update(Collections.PRICING_MATCH_CONFIGS, (c) => c.id === id, (c) => {
      updatedRecord = {
      ...c,
      ...payload,
      config_json: payload.config_json ? { ...c.config_json, ...payload.config_json } : c.config_json,
      updated_at: new Date().toISOString(),
      data: { ...c.data, ...(payload.data || {}) },
      }
      return updatedRecord
    })
    return updatedRecord
  }

  async function deleteConfig(id) {
    return dal.remove(Collections.PRICING_MATCH_CONFIGS, (c) => c.id === id)
  }

  async function unsetDefaultFlag(excludeId) {
    const all = await dal.findAll(Collections.PRICING_MATCH_CONFIGS, (c) => c.is_default === true)
    for (const c of all) {
      if (excludeId && c.id === excludeId) continue
      await dal.update(Collections.PRICING_MATCH_CONFIGS, (x) => x.id === c.id, (x) => ({ ...x, is_default: false, updated_at: new Date().toISOString() }))
    }
  }

  return {
    getDefaultConfig,
    getConfigById,
    listConfigs,
    createConfig,
    updateConfig,
    deleteConfig,
  }
}
