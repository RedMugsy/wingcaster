/**
 * Pricing Zone CRUD — sub-country pricing slice.
 *
 * Beirut vs. rural Lebanon is the canonical example. Each zone carries
 * its own pricing_multiplier that stacks with the parent Territory's:
 *
 *   effective_cast_value = core.cast_value × territory.mult × zone.mult
 *
 * Exactly one zone per territory may be is_default = true (enforced by
 * the partial unique index in migration 029). New tenants signing up
 * without a resolvable city fall to the default zone.
 */

import { v4 as uuidv4 } from 'uuid'
import { findAll, findOne, insert, update } from '../../db.js'
import { getTerritory, updateTerritory } from './territories.js'

export async function listZones({ territoryId = null, includeInactive = false } = {}) {
  const rows = await findAll('pricing_zones', (r) => {
    if (territoryId && r.territory_id !== territoryId) return false
    if (!includeInactive && r.active === false) return false
    return true
  })
  return rows.sort((a, b) => {
    if (a.is_default !== b.is_default) return a.is_default ? -1 : 1
    const s = (a.sort_order || 0) - (b.sort_order || 0)
    if (s !== 0) return s
    return (a.name || '').localeCompare(b.name || '')
  })
}

export async function getZone(id) {
  if (!id) return null
  return await findOne('pricing_zones', (r) => r.id === id)
}

export async function createZone(input) {
  if (!input.territory_id) throw new Error('territory_id required')
  const territory = await getTerritory(input.territory_id)
  if (!territory) throw new Error('territory not found')
  if (!input.code) throw new Error('code required')
  if (!input.name) throw new Error('name required')
  const code = String(input.code).toLowerCase().slice(0, 64)
  const existing = await findOne(
    'pricing_zones',
    (r) => r.territory_id === input.territory_id && String(r.code).toLowerCase() === code,
  )
  if (existing) throw new Error(`Zone ${code} already exists in this territory`)
  const now = new Date().toISOString()
  const row = {
    id: uuidv4(),
    territory_id: input.territory_id,
    code,
    name: String(input.name),
    name_ar: input.name_ar || null,
    pricing_multiplier: clampMultiplier(input.pricing_multiplier),
    is_default: Boolean(input.is_default),
    sort_order: Number(input.sort_order) || 0,
    active: input.active !== false,
    created_at: now,
    updated_at: now,
  }
  await insert('pricing_zones', row)
  if (row.is_default) {
    await ensureSingleDefault(row.territory_id, row.id)
    await updateTerritory(row.territory_id, { default_zone_id: row.id })
  }
  return row
}

export async function updateZone(id, patch) {
  const existing = await getZone(id)
  if (!existing) throw new Error('zone not found')
  const changes = { updated_at: new Date().toISOString() }
  if (patch.name != null) changes.name = String(patch.name)
  if (patch.name_ar !== undefined) changes.name_ar = patch.name_ar || null
  if (patch.pricing_multiplier != null) changes.pricing_multiplier = clampMultiplier(patch.pricing_multiplier)
  if (patch.is_default !== undefined) changes.is_default = Boolean(patch.is_default)
  if (patch.sort_order != null) changes.sort_order = Number(patch.sort_order) || 0
  if (patch.active !== undefined) changes.active = Boolean(patch.active)
  await update('pricing_zones', { id }, changes)
  if (changes.is_default === true) {
    await ensureSingleDefault(existing.territory_id, id)
    await updateTerritory(existing.territory_id, { default_zone_id: id })
  }
  return await getZone(id)
}

export async function deactivateZone(id) {
  const existing = await getZone(id)
  if (!existing) throw new Error('zone not found')
  if (existing.is_default) {
    throw new Error('cannot deactivate the default zone — set another zone as default first')
  }
  return await updateZone(id, { active: false })
}

async function ensureSingleDefault(territoryId, keepId) {
  const rows = await findAll(
    'pricing_zones',
    (r) => r.territory_id === territoryId && r.is_default === true && r.id !== keepId,
  )
  for (const r of rows) {
    await update('pricing_zones', { id: r.id }, {
      is_default: false, updated_at: new Date().toISOString(),
    })
  }
}

function clampMultiplier(v) {
  const n = Number(v)
  if (!Number.isFinite(n) || n <= 0) return 1
  return Math.round(n * 10000) / 10000
}
