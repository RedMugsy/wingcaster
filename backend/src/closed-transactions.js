/**
 * Closed transactions — dedicated collection for AVM training data.
 *
 * KEPT SEPARATE from the opportunities pipeline on purpose:
 *   - Opportunities are a lifecycle artifact (agent workflow state)
 *   - Closed transactions are a data artifact (immutable record of a
 *     completed deal, with the pricing / timing / buyer signals a
 *     future AVM will train on)
 *
 * A single opportunity closing 'closed_won' can produce ONE
 * closed_transactions row. A listing status flipping to 'archived'
 * without an opportunity attached can also produce a row (backfill /
 * off-platform capture).
 *
 * Nothing in this module surfaces in the current UI beyond the
 * RecordClosureModal + Settings → Historical Transactions page.
 * Everything else — market reports, agent performance analytics,
 * our own AVM — is deferred until we have volume (>= 200 rows per
 * market).
 */

import { v4 as uuidv4 } from 'uuid'
import { findAll, findOne, insert, update, remove } from './db.js'

export const TRANSACTION_TYPES = ['sale', 'rent', 'lease']

export const BUYER_TYPES = [
  'owner_occupier',
  'investor',
  'corporate',
  'international',
  'unknown',
]

export const PAYMENT_METHODS = [
  'cash',
  'mortgage',
  'installments',
  'off_plan_payment_plan',
  'other',
  'unknown',
]

export const ATTRIBUTION_SOURCES = [
  'own_client',
  'referral',
  'walkin',
  'portal_lead',
  'social_lead',
  'past_client',
  'other',
]

export const CLOSE_REASONS = [
  'market_price',
  'price_reduction',
  'urgent_seller',
  'urgent_buyer',
  'family_transfer',
  'inheritance',
  'relocation',
  'developer_deal',
  'other',
]

function nowIso() {
  return new Date().toISOString()
}

function toNumberOrNull(v) {
  if (v == null || v === '') return null
  const n = Number(v)
  return Number.isFinite(n) ? n : null
}

/**
 * Idempotent create — if a row already exists for (listing_id,
 * closed_at day), we treat that as the same transaction and update
 * instead. Prevents accidental double-recording when both hook points
 * fire (opportunity close_won + listing archive).
 */
export async function recordClosedTransaction(payload) {
  if (!payload?.listing_id) throw new Error('listing_id is required')
  if (!payload?.agent_id) throw new Error('agent_id is required')
  const transactionType = TRANSACTION_TYPES.includes(payload.transaction_type)
    ? payload.transaction_type
    : 'sale'
  const closedAt = payload.closed_at || nowIso()
  const closedDay = closedAt.slice(0, 10)

  const existing = await findOne(
    'closed_transactions',
    (r) => r.listing_id === payload.listing_id && String(r.closed_at || '').slice(0, 10) === closedDay,
  )

  const row = {
    id: existing?.id || uuidv4(),
    listing_id: payload.listing_id,
    agent_id: payload.agent_id,
    agency_id: payload.agency_id || null,
    contact_id: payload.contact_id || null,
    opportunity_id: payload.opportunity_id || null,

    transaction_type: transactionType,

    // Pricing
    original_listed_price: toNumberOrNull(payload.original_listed_price),
    final_sold_price: toNumberOrNull(payload.final_sold_price),
    currency: payload.currency || 'USD',
    price_reductions_count: toNumberOrNull(payload.price_reductions_count),
    price_reduction_history: Array.isArray(payload.price_reduction_history)
      ? payload.price_reduction_history
      : [],

    // Timing
    listed_at: payload.listed_at || null,
    closed_at: closedAt,
    days_on_market: toNumberOrNull(payload.days_on_market),
    days_to_first_offer: toNumberOrNull(payload.days_to_first_offer),

    // Demand signals
    offers_received_count: toNumberOrNull(payload.offers_received_count),
    viewings_conducted: toNumberOrNull(payload.viewings_conducted),
    rejected_offer_max: toNumberOrNull(payload.rejected_offer_max),
    rejected_offer_min: toNumberOrNull(payload.rejected_offer_min),

    // Buyer signals
    buyer_type: BUYER_TYPES.includes(payload.buyer_type) ? payload.buyer_type : 'unknown',
    buyer_nationality: payload.buyer_nationality || null,
    payment_method: PAYMENT_METHODS.includes(payload.payment_method)
      ? payload.payment_method
      : 'unknown',
    down_payment_percent: toNumberOrNull(payload.down_payment_percent),
    mortgage_provider: payload.mortgage_provider || null,

    // Context
    close_reason: CLOSE_REASONS.includes(payload.close_reason) ? payload.close_reason : 'other',
    agent_notes: payload.agent_notes || '',
    attribution_source: ATTRIBUTION_SOURCES.includes(payload.attribution_source)
      ? payload.attribution_source
      : 'other',

    // Provenance (never edit these downstream)
    origin: payload.origin || 'agent_form',
    is_backfilled: Boolean(payload.is_backfilled),
    source_note: payload.source_note || null,

    created_at: existing?.created_at || nowIso(),
    updated_at: nowIso(),
  }

  if (existing) {
    await update('closed_transactions', (r) => r.id === existing.id, () => row)
  } else {
    await insert('closed_transactions', row)
  }
  return row
}

export async function listClosedTransactions({ agentId, agencyId, listingId, contactId, limit = 200 } = {}) {
  const rows = await findAll('closed_transactions', (r) => {
    if (agentId && r.agent_id !== agentId) return false
    if (agencyId && r.agency_id !== agencyId) return false
    if (listingId && r.listing_id !== listingId) return false
    if (contactId && r.contact_id !== contactId) return false
    return true
  })
  return rows
    .sort((a, b) => new Date(b.closed_at || 0).getTime() - new Date(a.closed_at || 0).getTime())
    .slice(0, limit)
}

export async function getClosedTransaction(id) {
  return await findOne('closed_transactions', (r) => r.id === id)
}

export async function deleteClosedTransaction(id) {
  return await remove('closed_transactions', (r) => r.id === id)
}

/**
 * CSV backfill import. Column names should match the payload keys
 * (case-insensitive). Missing fields fall through to defaults.
 * Returns { imported, skipped, errors: [] }.
 */
export async function importClosedTransactionsCsv({ csvText, agentId, agencyId }) {
  if (!csvText) throw new Error('csvText is required')
  const rows = parseSimpleCsv(csvText)
  const results = { imported: 0, skipped: 0, errors: [] }
  for (let i = 0; i < rows.length; i++) {
    const row = rows[i]
    try {
      const payload = normaliseCsvRow(row)
      if (!payload.listing_id && !payload.external_reference) {
        results.errors.push({ row: i + 2, error: 'listing_id or external_reference required' })
        results.skipped++
        continue
      }
      // Backfill rows that don't reference a listing get a synthetic id so
      // they still record as a training data point without polluting the
      // properties collection.
      const listingId = payload.listing_id || `backfill:${payload.external_reference}`
      await recordClosedTransaction({
        ...payload,
        listing_id: listingId,
        agent_id: agentId,
        agency_id: agencyId,
        origin: 'csv_backfill',
        is_backfilled: true,
        source_note: payload.source_note || `CSV row ${i + 2}`,
      })
      results.imported++
    } catch (err) {
      results.errors.push({ row: i + 2, error: err.message })
      results.skipped++
    }
  }
  return results
}

/**
 * Small tolerant CSV parser — handles quoted values with commas inside,
 * newlines as row separator, first row as header. No dependency added.
 */
function parseSimpleCsv(text) {
  const lines = text.split(/\r?\n/).filter((l) => l.trim().length > 0)
  if (!lines.length) return []
  const headers = splitCsvRow(lines[0]).map((h) => h.trim().toLowerCase())
  const out = []
  for (let i = 1; i < lines.length; i++) {
    const cells = splitCsvRow(lines[i])
    const obj = {}
    headers.forEach((h, idx) => { obj[h] = cells[idx] != null ? String(cells[idx]).trim() : '' })
    out.push(obj)
  }
  return out
}

function splitCsvRow(line) {
  const out = []
  let cur = ''
  let inQuotes = false
  for (let i = 0; i < line.length; i++) {
    const ch = line[i]
    if (ch === '"' && line[i + 1] === '"' && inQuotes) { cur += '"'; i++; continue }
    if (ch === '"') { inQuotes = !inQuotes; continue }
    if (ch === ',' && !inQuotes) { out.push(cur); cur = ''; continue }
    cur += ch
  }
  out.push(cur)
  return out
}

function normaliseCsvRow(row) {
  return {
    listing_id: row.listing_id || row.property_id || row.listing || '',
    external_reference: row.external_reference || row.reference || '',
    transaction_type: row.transaction_type || row.type || 'sale',
    original_listed_price: row.original_listed_price || row.listed_price || '',
    final_sold_price: row.final_sold_price || row.sold_price || row.sale_price || '',
    currency: row.currency || 'USD',
    listed_at: row.listed_at || row.listed_date || null,
    closed_at: row.closed_at || row.closed_date || row.sold_date || null,
    days_on_market: row.days_on_market || '',
    offers_received_count: row.offers_received_count || row.offers || '',
    viewings_conducted: row.viewings_conducted || row.viewings || '',
    buyer_type: (row.buyer_type || '').toLowerCase(),
    buyer_nationality: row.buyer_nationality || row.nationality || '',
    payment_method: (row.payment_method || '').toLowerCase(),
    down_payment_percent: row.down_payment_percent || row.down_payment || '',
    mortgage_provider: row.mortgage_provider || '',
    close_reason: (row.close_reason || '').toLowerCase(),
    agent_notes: row.agent_notes || row.notes || '',
    attribution_source: (row.attribution_source || row.source || '').toLowerCase(),
    source_note: row.source_note || '',
  }
}
