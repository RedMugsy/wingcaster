import { findOne, findAll } from '../../db.js'

export function createDefaultPlatformAdapter() {
  return {
    async getAgentById(agentId) {
      return (await findOne('agents', (a) => a.id === agentId)) || null
    },

    async getAgentByPhoneNumber(phone) {
      const normalized = String(phone || '').replace(/\D/g, '')
      return (await findOne('agents', (a) => String(a.phone || '').replace(/\D/g, '') === normalized)) || null
    },

    async getPropertiesForArea(areaId, { status = 'active', limit = 20 } = {}) {
      const area = await findOne('area_profiles', (a) => a.id === areaId)
      if (!area) return []
      const rows = await findAll('properties', (p) => {
        if (status && p.status !== status) return false
        return (
          (area.city && p.city === area.city) ||
          (area.neighborhood && p.neighborhood === area.neighborhood) ||
          false
        )
      })
      return rows.slice(0, limit)
    },

    async getPropertyById(propertyId) {
      return (await findOne('properties', (p) => p.id === propertyId)) || null
    },

    async emit(event, payload) {
      return { emitted: true, event, payload }
    },
  }
}
