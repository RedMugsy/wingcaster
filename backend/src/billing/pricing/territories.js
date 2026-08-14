/**
 * Territory CRUD — the country-level pricing + billing boundary.
 *
 * A Territory maps to an ISO country code. It carries:
 *   - pricing_multiplier: % markup applied to the Core Rate Card's
 *                         cast_value at this country level (0.4 = 40%
 *                         of base, 2.0 = 200%).
 *   - launch_status:      launched | planned | blocked | sunset
 *   - launch_wave:        integer bucket (1 = Lebanon-first, 2 = Wave 2,
 *                         3 = Wave 3, admin can add more)
 *   - data_residency_required, billing_mode, vat_percent,
 *     regulator_id_type, payment_gateway_primary/secondary — spec §7,8.
 *   - default_zone_id:    zone used when a tenant signs up without a
 *                         city or when their city is unmapped.
 *
 * Because the existing public.territories table also drives listing
 * disclosure fields, we never delete a row — deactivate it instead.
 */

import { v4 as uuidv4 } from 'uuid'
import { findAll, findOne, insert, update } from '../../db.js'

const CODE_RE = /^[A-Z]{2}$/

export async function listTerritories({ includeInactive = false } = {}) {
  const rows = await findAll('territories', () => true)
  const filtered = includeInactive ? rows : rows.filter((r) => r.active !== false)
  return filtered.sort((a, b) => {
    const w = (a.launch_wave || 99) - (b.launch_wave || 99)
    if (w !== 0) return w
    const s = (a.sort_order || 0) - (b.sort_order || 0)
    if (s !== 0) return s
    return (a.name || '').localeCompare(b.name || '')
  })
}

export async function getTerritory(id) {
  if (!id) return null
  return await findOne('territories', (r) => r.id === id)
}

export async function getTerritoryByCode(code) {
  if (!code) return null
  const upper = String(code).toUpperCase()
  return await findOne('territories', (r) => String(r.code || '').toUpperCase() === upper)
}

export async function createTerritory(input) {
  const code = String(input.code || '').toUpperCase()
  if (!CODE_RE.test(code)) throw new Error('code must be a two-letter ISO country code')
  if (!input.name) throw new Error('name required')
  const existing = await getTerritoryByCode(code)
  if (existing) throw new Error(`Territory ${code} already exists`)
  const now = new Date().toISOString()
  const row = {
    id: uuidv4(),
    code,
    name: String(input.name),
    currency: (input.currency || 'USD').toUpperCase().slice(0, 3),
    pricing_multiplier: clampMultiplier(input.pricing_multiplier),
    launch_status: normalizeLaunchStatus(input.launch_status),
    launch_wave: input.launch_wave != null ? Math.max(1, Number(input.launch_wave)) : null,
    data_residency_required: Boolean(input.data_residency_required),
    billing_mode: normalizeBillingMode(input.billing_mode),
    vat_percent: clampVat(input.vat_percent),
    regulator_id_type: input.regulator_id_type || null,
    default_zone_id: null, // set later when zones exist
    payment_gateway_primary: input.payment_gateway_primary || null,
    payment_gateway_secondary: input.payment_gateway_secondary || null,
    sort_order: Number(input.sort_order) || 0,
    active: input.active !== false,
    created_at: now,
    updated_at: now,
  }
  await insert('territories', row)
  return row
}

export async function updateTerritory(id, patch) {
  const existing = await getTerritory(id)
  if (!existing) throw new Error('territory not found')
  const changes = { updated_at: new Date().toISOString() }
  if (patch.name != null) changes.name = String(patch.name)
  if (patch.currency != null) changes.currency = String(patch.currency).toUpperCase().slice(0, 3)
  if (patch.pricing_multiplier != null) changes.pricing_multiplier = clampMultiplier(patch.pricing_multiplier)
  if (patch.launch_status != null) changes.launch_status = normalizeLaunchStatus(patch.launch_status)
  if (patch.launch_wave !== undefined) {
    changes.launch_wave = patch.launch_wave === null ? null : Math.max(1, Number(patch.launch_wave))
  }
  if (patch.data_residency_required !== undefined) changes.data_residency_required = Boolean(patch.data_residency_required)
  if (patch.billing_mode != null) changes.billing_mode = normalizeBillingMode(patch.billing_mode)
  if (patch.vat_percent != null) changes.vat_percent = clampVat(patch.vat_percent)
  if (patch.regulator_id_type !== undefined) changes.regulator_id_type = patch.regulator_id_type || null
  if (patch.default_zone_id !== undefined) changes.default_zone_id = patch.default_zone_id || null
  if (patch.payment_gateway_primary !== undefined) changes.payment_gateway_primary = patch.payment_gateway_primary || null
  if (patch.payment_gateway_secondary !== undefined) changes.payment_gateway_secondary = patch.payment_gateway_secondary || null
  if (patch.sort_order != null) changes.sort_order = Number(patch.sort_order) || 0
  if (patch.active !== undefined) changes.active = Boolean(patch.active)
  await update('territories', { id }, changes)
  return await getTerritory(id)
}

/**
 * Deactivate rather than hard-delete, since the row may be referenced
 * from listings, subscriptions, or usage_events.
 */
export async function deactivateTerritory(id) {
  return await updateTerritory(id, { active: false, launch_status: 'sunset' })
}

function normalizeLaunchStatus(v) {
  const s = String(v || 'planned').toLowerCase()
  return ['launched', 'planned', 'blocked', 'sunset'].includes(s) ? s : 'planned'
}

function normalizeBillingMode(v) {
  const s = String(v || 'card').toLowerCase()
  return ['card', 'invoice_only', 'manual', 'disabled'].includes(s) ? s : 'card'
}

function clampMultiplier(v) {
  const n = Number(v)
  if (!Number.isFinite(n) || n <= 0) return 1
  return Math.round(n * 10000) / 10000
}

function clampVat(v) {
  const n = Number(v)
  if (!Number.isFinite(n) || n < 0) return 0
  return Math.round(n * 100) / 100
}
