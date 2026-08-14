/**
 * Pricing City CRUD — city→zone assignment table.
 *
 * At tenant signup we accept a free-text city, normalize it, and look
 * it up here. If found, we use that city's zone. If not, we fall back
 * to the territory's default_zone_id.
 */

import { v4 as uuidv4 } from 'uuid'
import { findAll, findOne, insert, update } from '../../db.js'

export async function listCities({ territoryId = null, zoneId = null, includeInactive = false } = {}) {
  const rows = await findAll('pricing_cities', (r) => {
    if (territoryId && r.territory_id !== territoryId) return false
    if (zoneId && r.zone_id !== zoneId) return false
    if (!includeInactive && r.active === false) return false
    return true
  })
  return rows.sort((a, b) => {
    const s = (a.sort_order || 0) - (b.sort_order || 0)
    if (s !== 0) return s
    return (a.name || '').localeCompare(b.name || '')
  })
}

export async function getCity(id) {
  if (!id) return null
  return await findOne('pricing_cities', (r) => r.id === id)
}

export async function findCityByName(territoryId, name) {
  const norm = normalizeName(name)
  if (!norm || !territoryId) return null
  return await findOne(
    'pricing_cities',
    (r) => r.territory_id === territoryId && r.name_norm === norm && r.active !== false,
  )
}

export async function createCity(input) {
  if (!input.territory_id) throw new Error('territory_id required')
  if (!input.name) throw new Error('name required')
  const norm = normalizeName(input.name)
  if (!norm) throw new Error('city name normalizes to empty string')
  const existing = await findOne(
    'pricing_cities',
    (r) => r.territory_id === input.territory_id && r.name_norm === norm,
  )
  if (existing) throw new Error(`City "${input.name}" already exists in this territory`)
  const now = new Date().toISOString()
  const row = {
    id: uuidv4(),
    territory_id: input.territory_id,
    zone_id: input.zone_id || null,
    name: String(input.name),
    name_ar: input.name_ar || null,
    name_norm: norm,
    latitude: numberOrNull(input.latitude),
    longitude: numberOrNull(input.longitude),
    sort_order: Number(input.sort_order) || 0,
    active: input.active !== false,
    created_at: now,
    updated_at: now,
  }
  await insert('pricing_cities', row)
  return row
}

export async function updateCity(id, patch) {
  const existing = await getCity(id)
  if (!existing) throw new Error('city not found')
  const changes = { updated_at: new Date().toISOString() }
  if (patch.name != null) {
    changes.name = String(patch.name)
    changes.name_norm = normalizeName(patch.name)
  }
  if (patch.name_ar !== undefined) changes.name_ar = patch.name_ar || null
  if (patch.zone_id !== undefined) changes.zone_id = patch.zone_id || null
  if (patch.latitude !== undefined) changes.latitude = numberOrNull(patch.latitude)
  if (patch.longitude !== undefined) changes.longitude = numberOrNull(patch.longitude)
  if (patch.sort_order != null) changes.sort_order = Number(patch.sort_order) || 0
  if (patch.active !== undefined) changes.active = Boolean(patch.active)
  await update('pricing_cities', { id }, changes)
  return await getCity(id)
}

export async function deactivateCity(id) {
  return await updateCity(id, { active: false })
}

/**
 * Bulk assign a batch of cities to a zone. Used by admin UX when
 * re-slicing a territory.
 */
export async function assignCitiesToZone(cityIds, zoneId) {
  const ids = (cityIds || []).filter(Boolean)
  const results = []
  for (const id of ids) {
    results.push(await updateCity(id, { zone_id: zoneId || null }))
  }
  return results
}

export function normalizeName(name) {
  if (!name) return ''
  return String(name)
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '') // strip combining diacritics
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 255)
}

function numberOrNull(v) {
  if (v == null || v === '') return null
  const n = Number(v)
  return Number.isFinite(n) ? n : null
}
