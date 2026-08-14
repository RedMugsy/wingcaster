/**
 * Core Rate Card — runtime-editable table of casts-per-action.
 *
 * Spec §7 + user amendment: "even the price rate per the different
 * markets/zones should not be fixed". The Core Rate Card is the base
 * from which every Territory / Zone applies its % multiplier.
 *
 * Exactly one row may be is_active = true at any time (partial unique
 * index in migration 029). Old versions stay in the table forever so
 * grandfathered subscriptions (pinned by version at signup) can always
 * be re-resolved.
 */

import { findAll, findOne, insert, update, query } from '../../db.js'
import { CAST_RATES_V1, CAST_VALUE_MINOR_SEED } from '../rate-card.js'

/**
 * List every rate card ever created (active first, then by version desc).
 */
export async function listRateCards() {
  const rows = await findAll('core_rate_cards', () => true)
  return rows
    .sort((a, b) => {
      if (a.is_active !== b.is_active) return a.is_active ? -1 : 1
      return (b.version || 0) - (a.version || 0)
    })
}

export async function getActiveRateCard() {
  const rows = await findAll('core_rate_cards', (r) => r.is_active === true)
  return rows[0] || null
}

export async function getRateCardByVersion(version) {
  const v = Number(version)
  if (!Number.isFinite(v)) return null
  return await findOne('core_rate_cards', (r) => Number(r.version) === v)
}

/**
 * Create a new draft rate card. Not activated by default.
 */
export async function createRateCard({
  name,
  description = null,
  currency = 'USD',
  cast_value_minor = CAST_VALUE_MINOR_SEED,
  rates = {},
  created_by = null,
}) {
  if (!name) throw new Error('name required')
  const rows = await listRateCards()
  const nextVersion = rows.reduce((max, r) => Math.max(max, Number(r.version) || 0), 0) + 1
  const now = new Date().toISOString()
  const row = {
    id: undefined,
    version: nextVersion,
    name,
    description,
    currency,
    cast_value_minor: Math.max(1, Number(cast_value_minor) || CAST_VALUE_MINOR_SEED),
    rates: sanitizeRates(rates),
    is_active: false,
    activated_at: null,
    deactivated_at: null,
    created_by,
    created_at: now,
    updated_at: now,
  }
  await insert('core_rate_cards', row)
  return await getRateCardByVersion(nextVersion)
}

export async function updateRateCard(id, patch) {
  if (!id) throw new Error('id required')
  const existing = await findOne('core_rate_cards', (r) => r.id === id)
  if (!existing) throw new Error('rate card not found')
  const changes = {}
  if (patch.name != null) changes.name = String(patch.name)
  if (patch.description !== undefined) changes.description = patch.description
  if (patch.currency != null) changes.currency = String(patch.currency).toUpperCase().slice(0, 3)
  if (patch.cast_value_minor != null) {
    changes.cast_value_minor = Math.max(1, Number(patch.cast_value_minor))
  }
  if (patch.rates != null) changes.rates = sanitizeRates(patch.rates)
  changes.updated_at = new Date().toISOString()
  await update('core_rate_cards', { id }, changes)
  return await findOne('core_rate_cards', (r) => r.id === id)
}

/**
 * Activate a rate card. Deactivates whichever card is currently active
 * (atomic behaviour is enforced by the partial unique index — this two-
 * step is safe because both updates go through Postgres and we can
 * tolerate a very brief window where zero cards are active).
 */
export async function activateRateCard(id) {
  const target = await findOne('core_rate_cards', (r) => r.id === id)
  if (!target) throw new Error('rate card not found')
  const active = await getActiveRateCard()
  const now = new Date().toISOString()
  if (active && active.id !== id) {
    await update('core_rate_cards', { id: active.id }, {
      is_active: false, deactivated_at: now, updated_at: now,
    })
  }
  await update('core_rate_cards', { id }, {
    is_active: true, activated_at: now, deactivated_at: null, updated_at: now,
  })
  return await getActiveRateCard()
}

/**
 * Ensure a v1 rate card exists on boot, seeded from the hardcoded
 * CAST_RATES_V1 in backend/src/billing/rate-card.js. Idempotent.
 */
export async function ensureSeedRateCard() {
  const rows = await listRateCards()
  if (rows.length) return await getActiveRateCard() || rows[0]
  const seeded = await createRateCard({
    name: 'Wingcaster Core Rate Card v1',
    description: 'Seeded from CAST_RATES_V1 on first boot. Every action from spec §6 catalog, cast value = $0.10.',
    currency: 'USD',
    cast_value_minor: CAST_VALUE_MINOR_SEED,
    rates: { ...CAST_RATES_V1 },
    created_by: 'system',
  })
  return await activateRateCard(seeded.id)
}

function sanitizeRates(rates) {
  const out = {}
  for (const [k, v] of Object.entries(rates || {})) {
    const n = Number(v)
    if (!Number.isFinite(n) || n < 0) continue
    out[String(k)] = Math.round(n)
  }
  return out
}
