/**
 * Territory CRUD — the country-level pricing + billing boundary.
 *
 * Post-migration 030: the row is SPLIT across two tables that share
 * the same id (a 1:1 by design):
 *
 *   public.territories        — code, name, currency (listing/disclosure)
 *   commercial.territories    — pricing_multiplier, launch_status,
 *                               launch_wave, data_residency_required,
 *                               billing_mode, vat_percent,
 *                               regulator_id_type, default_zone_id,
 *                               payment_gateway_*, sort_order, active
 *                               (billing/pricing)
 *
 * The pricing module is the OWNER of commercial.territories and only
 * READS from public.territories. If a caller creates a commercial
 * territory for a code that has no public row yet, we create the
 * public row first so the FK holds.
 */

import { v4 as uuidv4 } from 'uuid'
import { findAll, findOne, insert, update } from '../../db.js'

const CODE_RE = /^[A-Z]{2}$/

/**
 * List territories with both listing (name, currency) and commercial
 * (multiplier, status, ...) fields merged. Sorted by launch_wave then
 * sort_order then name.
 */
export async function listTerritories({ includeInactive = false } = {}) {
  const [pubRows, commRows] = await Promise.all([
    findAll('territories', () => true),
    findAll('commercial_territories', () => true),
  ])
  const pubById = new Map(pubRows.map((r) => [r.id, r]))
  const merged = commRows
    .filter((c) => (includeInactive ? true : c.active !== false))
    .map((c) => mergeTerritory(pubById.get(c.id), c))
  return merged.sort((a, b) => {
    const w = (a.launch_wave || 99) - (b.launch_wave || 99)
    if (w !== 0) return w
    const s = (a.sort_order || 0) - (b.sort_order || 0)
    if (s !== 0) return s
    return (a.name || '').localeCompare(b.name || '')
  })
}

export async function getTerritory(id) {
  if (!id) return null
  const [pub, comm] = await Promise.all([
    findOne('territories', (r) => r.id === id),
    findOne('commercial_territories', (r) => r.id === id),
  ])
  if (!comm) return null
  return mergeTerritory(pub, comm)
}

export async function getTerritoryByCode(code) {
  if (!code) return null
  const upper = String(code).toUpperCase()
  const comm = await findOne('commercial_territories', (r) => String(r.code || '').toUpperCase() === upper)
  if (!comm) return null
  const pub = await findOne('territories', (r) => r.id === comm.id)
  return mergeTerritory(pub, comm)
}

export async function createTerritory(input) {
  const code = String(input.code || '').toUpperCase()
  if (!CODE_RE.test(code)) throw new Error('code must be a two-letter ISO country code')
  if (!input.name) throw new Error('name required')
  const existing = await getTerritoryByCode(code)
  if (existing) throw new Error(`Territory ${code} already exists`)

  // Ensure a public.territories row exists first (FK target).
  let pub = await findOne('territories', (r) => String(r.code || '').toUpperCase() === code)
  if (!pub) {
    const id = uuidv4()
    pub = {
      id,
      code,
      name: String(input.name),
      currency: (input.currency || 'USD').toUpperCase().slice(0, 3),
    }
    await insert('territories', pub)
  }

  const now = new Date().toISOString()
  const commRow = {
    id: pub.id,
    code,
    pricing_multiplier: clampMultiplier(input.pricing_multiplier),
    launch_status: normalizeLaunchStatus(input.launch_status),
    launch_wave: input.launch_wave != null ? Math.max(1, Number(input.launch_wave)) : null,
    data_residency_required: Boolean(input.data_residency_required),
    billing_mode: normalizeBillingMode(input.billing_mode),
    vat_percent: clampVat(input.vat_percent),
    regulator_id_type: input.regulator_id_type || null,
    default_zone_id: null,
    payment_gateway_primary: input.payment_gateway_primary || null,
    payment_gateway_secondary: input.payment_gateway_secondary || null,
    sort_order: Number(input.sort_order) || 0,
    active: input.active !== false,
    created_at: now,
    updated_at: now,
  }
  await insert('commercial_territories', commRow)

  // Best-effort partition creation for commercial.usage_events. Silent
  // no-op if the DB user lacks DDL rights or the table isn't partitioned.
  await ensureUsageEventsPartition(pub.id, code).catch(() => {})

  return mergeTerritory(pub, commRow)
}

export async function updateTerritory(id, patch) {
  const existing = await getTerritory(id)
  if (!existing) throw new Error('territory not found')
  const changes = { updated_at: new Date().toISOString() }
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
  await update('commercial_territories', { id }, changes)

  // Name / currency updates go to the public row (listing concern).
  const pubChanges = {}
  if (patch.name != null) pubChanges.name = String(patch.name)
  if (patch.currency != null) pubChanges.currency = String(patch.currency).toUpperCase().slice(0, 3)
  if (Object.keys(pubChanges).length) {
    await update('territories', { id }, pubChanges)
  }
  return await getTerritory(id)
}

/**
 * Deactivate rather than hard-delete, since the row may be referenced
 * from listings, subscriptions, or usage_events.
 */
export async function deactivateTerritory(id) {
  return await updateTerritory(id, { active: false, launch_status: 'sunset' })
}

/**
 * Ensure a per-territory partition of commercial.usage_events exists.
 * Called from createTerritory + from seedPricingHierarchy. Requires the
 * DB user to have CREATE rights on the commercial schema.
 *
 * Naming convention: commercial.usage_events_<lowercase-code>. Postgres
 * table names are 63 chars max; ISO-2 codes stay well under.
 */
export async function ensureUsageEventsPartition(territoryId, code) {
  if (!territoryId || !code) return
  const partitionName = `usage_events_${String(code).toLowerCase()}`
  const { query } = await import('../../db.js')
  const exists = await query(
    `SELECT 1 FROM information_schema.tables
      WHERE table_schema = 'commercial' AND table_name = $1
      LIMIT 1`,
    [partitionName],
  ).catch(() => [])
  // query() resolves to the rows array, not a pg result object — reading
  // .rows here made this guard dead, so the partition DDL below was attempted
  // on every territory create even when the partition already existed.
  if (Array.isArray(exists) && exists.length) return
  // Wrap in try — partitioning may not be applied yet (e.g. old DB) or
  // the DB user may lack DDL rights. Either case is a no-op.
  try {
    await query(
      `CREATE TABLE commercial."${partitionName}"
         PARTITION OF commercial.usage_events
         FOR VALUES IN ($1)`,
      [territoryId],
    )
  } catch (_err) {
    // Silent — resolver still writes to the default partition.
  }
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

function mergeTerritory(pub, comm) {
  if (!comm) return null
  return {
    id: comm.id,
    code: comm.code || pub?.code || null,
    name: pub?.name || null,
    currency: pub?.currency || null,
    pricing_multiplier: comm.pricing_multiplier,
    launch_status: comm.launch_status,
    launch_wave: comm.launch_wave,
    data_residency_required: comm.data_residency_required,
    billing_mode: comm.billing_mode,
    vat_percent: comm.vat_percent,
    regulator_id_type: comm.regulator_id_type,
    default_zone_id: comm.default_zone_id,
    payment_gateway_primary: comm.payment_gateway_primary,
    payment_gateway_secondary: comm.payment_gateway_secondary,
    sort_order: comm.sort_order,
    active: comm.active,
    created_at: comm.created_at,
    updated_at: comm.updated_at,
  }
}
