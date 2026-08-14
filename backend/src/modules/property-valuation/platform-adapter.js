/**
 * Default PlatformAdapter for the Market Pricing module.
 *
 * This is the ONLY file in the module that reaches into the core platform.
 */

import { findOne, findAll, query } from '../../db.js'
import { fromRow } from '../../persistence/table-mapper.js'

export function createDefaultPlatformAdapter() {
  return {
    async getPropertyById(propertyId) {
      return (await findOne('properties', (p) => p.id === propertyId)) || null
    },

    async getProperties(filters = {}) {
      const rows = await findAll('properties', (p) => {
        if (filters.status && p.status !== filters.status) return false
        if (filters.property_type && p.property_type !== filters.property_type) return false
        if (filters.city && p.city !== filters.city) return false
        if (filters.neighborhood && p.neighborhood !== filters.neighborhood) return false
        if (filters.excludeId && p.id === filters.excludeId) return false
        return true
      })
      return rows
    },

    async findNearbyProperties({ latitude, longitude, radiusMeters = 5000, filters = {} }) {
      if (latitude == null || longitude == null || !Number.isFinite(Number(latitude)) || !Number.isFinite(Number(longitude))) {
        return []
      }
      const conditions = ['p.geom IS NOT NULL', 'ST_DWithin(p.geom::geography, ST_SetSRID(ST_MakePoint($1, $2), 4326)::geography, $3)']
      const params = [Number(longitude), Number(latitude), Number(radiusMeters)]

      if (filters.status) {
        params.push(filters.status)
        conditions.push(`p.status = $${params.length}`)
      }
      if (filters.property_type) {
        params.push(filters.property_type)
        conditions.push(`p.property_type = $${params.length}`)
      }
      if (filters.excludeId) {
        params.push(filters.excludeId)
        conditions.push(`p.id <> $${params.length}`)
      }

      const sql = `
        SELECT p.*
        FROM public.properties p
        WHERE ${conditions.join(' AND ')}
        ORDER BY p.geom <-> ST_SetSRID(ST_MakePoint($1, $2), 4326)
        LIMIT 1000
      `
      const rows = await query(sql, params)
      return rows.map((row) => fromRow('properties', row))
    },

    async findNearbyExternalComparables({ latitude, longitude, radiusMeters = 5000, filters = {} }) {
      if (latitude == null || longitude == null || !Number.isFinite(Number(latitude)) || !Number.isFinite(Number(longitude))) {
        return []
      }
      const conditions = ['ec.geom IS NOT NULL', 'ST_DWithin(ec.geom::geography, ST_SetSRID(ST_MakePoint($1, $2), 4326)::geography, $3)']
      const params = [Number(longitude), Number(latitude), Number(radiusMeters)]

      if (filters.status) {
        params.push(filters.status)
        conditions.push(`ec.status = $${params.length}`)
      }
      if (filters.property_type) {
        params.push(filters.property_type)
        conditions.push(`ec.property_type = $${params.length}`)
      }
      if (filters.sources?.length) {
        params.push(filters.sources)
        conditions.push(`ec.source = ANY($${params.length}::text[])`)
      }

      const sql = `
        SELECT ec.*
        FROM market_pricing.external_comparables ec
        WHERE ${conditions.join(' AND ')}
        ORDER BY ec.geom <-> ST_SetSRID(ST_MakePoint($1, $2), 4326)
        LIMIT 1000
      `
      const rows = await query(sql, params)
      return rows.map((row) => fromRow('external_comparables', row))
    },

    async getAreaProfiles(filters = {}) {
      const rows = await findAll('area_profiles', (a) => {
        if (filters.status && a.status !== filters.status) return false
        if (filters.level && a.level !== filters.level) return false
        return true
      })
      return rows
    },

    async getAreaById(areaId) {
      return (await findOne('area_profiles', (a) => a.id === areaId)) || null
    },

    async getAreaBySlug(slug) {
      return (await findOne('area_profiles', (a) => a.slug === slug)) || null
    },

    async emit(event, payload) {
      return { emitted: true, event, payload }
    },
  }
}
