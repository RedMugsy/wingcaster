/**
 * Stage 13c pure per-source parity diff (DL-196).
 * No SQL. Given (legacyRow, finRow) → {ok, drift_kind, field_diffs}.
 */
export const TIMESTAMP_SKEW_MS = 1000

export const DRIFT_KINDS = [
  'MISSING_FIN',
  'MISSING_LEGACY',
  'FIELD_MISMATCH',
  'DUPLICATE_FIN',
  'TIMESTAMP_SKEW',
  'AMOUNT_MISMATCH',
  'CURRENCY_MISMATCH',
  'TENANT_MISMATCH',
  'ENVIRONMENT_MISMATCH',
  'OTHER',
]

export const SOURCE_USAGE = 'commercial.usage_events'
export const SOURCE_CONSUMPTION = 'commercial.ledger_entries'
export const SOURCE_HOLDS = 'commercial.holds'
export const SOURCE_CAPTURES = 'commercial.captures'

export const PARITY_SOURCES = [
  SOURCE_USAGE,
  SOURCE_CONSUMPTION,
  SOURCE_HOLDS,
  SOURCE_CAPTURES,
]

function num(value, fallback = 0) {
  const n = Number(value)
  return Number.isFinite(n) ? n : fallback
}

function text(value) {
  if (value == null) return ''
  return String(value)
}

function msOf(value) {
  if (!value) return null
  const ms = Date.parse(value instanceof Date ? value.toISOString() : String(value))
  return Number.isFinite(ms) ? ms : null
}

function mismatch(kind, field, legacy, fin) {
  return {
    ok: false,
    drift_kind: kind,
    field_diffs: { [field]: { legacy: legacy ?? null, fin: fin ?? null } },
  }
}

function envOf(row) {
  return row?.environment || row?.fin_environment || null
}

function publicTenantOfFin(finRow) {
  const dims = finRow?.dimensions && typeof finRow.dimensions === 'object'
    ? finRow.dimensions
    : {}
  return dims.public_tenant_id ?? finRow?.public_tenant_id ?? null
}

function compareEnvironment(legacyRow, finRow, environment) {
  const expected = environment || envOf(legacyRow)
  const actual = envOf(finRow)
  if (expected && actual && text(expected) !== text(actual)) {
    return mismatch('ENVIRONMENT_MISMATCH', 'environment', expected, actual)
  }
  return null
}

function compareTimestamp(legacyValue, finValue, field = 'occurred_at') {
  const legacyMs = msOf(legacyValue)
  const finMs = msOf(finValue)
  if (legacyMs == null || finMs == null) return null
  const skew = Math.abs(finMs - legacyMs)
  if (skew > TIMESTAMP_SKEW_MS) {
    return {
      ok: false,
      drift_kind: 'TIMESTAMP_SKEW',
      field_diffs: { [field]: { legacy: legacyValue, fin: finValue, skew_ms: skew } },
    }
  }
  return null
}

/**
 * commercial.usage_events vs fin.usage_events.
 * Byte-equal: action_key/event_type, quantity (after 13a 1:1 map).
 * Tolerance: occurred_at ≤ 1s.
 * Allowed to differ: fin id, holder/book ids, source_system (commercial vs
 * commercial.usage_events), received_at, ingestion_version, cutover_origin.
 */
export function compareUsageEvent(legacyRow, finRow, { environment } = {}) {
  if (!finRow) {
    return { ok: false, drift_kind: 'MISSING_FIN', field_diffs: { fin: null } }
  }
  if (!legacyRow) {
    return { ok: false, drift_kind: 'MISSING_LEGACY', field_diffs: { legacy: null } }
  }
  const envDrift = compareEnvironment(legacyRow, finRow, environment)
  if (envDrift) return envDrift

  const legacyTenant = legacyRow.tenant_id ?? null
  const finTenant = publicTenantOfFin(finRow)
  if (legacyTenant != null && finTenant != null && text(legacyTenant) !== text(finTenant)) {
    return mismatch('TENANT_MISMATCH', 'tenant_id', legacyTenant, finTenant)
  }

  const legacyQty = Math.max(1, num(legacyRow.quantity, 1) || 1)
  const finQty = num(finRow.quantity_units)
  if (legacyQty !== finQty) {
    return mismatch('AMOUNT_MISMATCH', 'quantity_units', legacyQty, finQty)
  }

  const skew = compareTimestamp(
    legacyRow.occurred_at || legacyRow.created_at,
    finRow.occurred_at,
    'occurred_at',
  )
  if (skew) return skew

  const legacyType = text(legacyRow.action_key || 'unknown')
  const finType = text(finRow.event_type)
  if (legacyType !== finType) {
    return mismatch('FIELD_MISMATCH', 'event_type', legacyType, finType)
  }

  return { ok: true, drift_kind: null, field_diffs: {} }
}

/**
 * commercial.ledger_entries consumption vs fin.rated_usage / usage_events mirror.
 * Amount maps through unitsOf (abs, min 1). Currency must match when both present.
 */
export function compareConsumption(legacyRow, finRow, { environment } = {}) {
  if (!finRow) {
    return { ok: false, drift_kind: 'MISSING_FIN', field_diffs: { fin: null } }
  }
  if (!legacyRow) {
    return { ok: false, drift_kind: 'MISSING_LEGACY', field_diffs: { legacy: null } }
  }
  const envDrift = compareEnvironment(legacyRow, finRow, environment)
  if (envDrift) return envDrift

  const legacyTenant = legacyRow.tenant_id ?? null
  const finTenant = publicTenantOfFin(finRow) ?? finRow.public_tenant_id
  if (legacyTenant != null && finTenant != null && text(legacyTenant) !== text(finTenant)) {
    return mismatch('TENANT_MISMATCH', 'tenant_id', legacyTenant, finTenant)
  }

  const legacyCurrency = legacyRow.currency || legacyRow.billing_currency || null
  const finCurrency = finRow.currency || finRow.billing_currency || null
  if (legacyCurrency && finCurrency && text(legacyCurrency) !== text(finCurrency)) {
    return mismatch('CURRENCY_MISMATCH', 'currency', legacyCurrency, finCurrency)
  }

  const legacyUnits = Math.max(1, Math.abs(Math.round(num(legacyRow.amount, 0))) || 1)
  const finUnits = num(
    finRow.quantity_units ?? finRow.billable_units ?? finRow.measured_units ?? finRow.units,
  )
  if (finUnits && legacyUnits !== finUnits) {
    return mismatch('AMOUNT_MISMATCH', 'units', legacyUnits, finUnits)
  }

  const skew = compareTimestamp(
    legacyRow.created_at,
    finRow.occurred_at || finRow.event_at || finRow.created_at,
    'created_at',
  )
  if (skew) return skew

  const legacyKey = text(legacyRow.quota_key || '')
  const finType = text(finRow.event_type || finRow.quota_key || '')
  if (legacyKey && finType && legacyKey !== finType) {
    return mismatch('FIELD_MISMATCH', 'quota_key', legacyKey, finType)
  }

  return { ok: true, drift_kind: null, field_diffs: {} }
}

/**
 * Hold-shaped commercial payload vs fin.holds.
 */
export function compareHold(legacyRow, finRow, { environment } = {}) {
  if (!finRow) {
    return { ok: false, drift_kind: 'MISSING_FIN', field_diffs: { fin: null } }
  }
  if (!legacyRow) {
    return { ok: false, drift_kind: 'MISSING_LEGACY', field_diffs: { legacy: null } }
  }
  const envDrift = compareEnvironment(legacyRow, finRow, environment)
  if (envDrift) return envDrift

  const legacyUnits = Math.max(1, num(legacyRow.units ?? legacyRow.amount ?? legacyRow.quantity, 1) || 1)
  const finUnits = num(finRow.units)
  if (legacyUnits !== finUnits) {
    return mismatch('AMOUNT_MISMATCH', 'units', legacyUnits, finUnits)
  }

  if (legacyRow.status && finRow.status && text(legacyRow.status) !== text(finRow.status)) {
    return mismatch('FIELD_MISMATCH', 'status', legacyRow.status, finRow.status)
  }

  const skew = compareTimestamp(legacyRow.created_at, finRow.created_at, 'created_at')
  if (skew) return skew

  return { ok: true, drift_kind: null, field_diffs: {} }
}

/**
 * Capture-shaped commercial payload vs fin hold/capture mirror.
 */
export function compareCapture(legacyRow, finRow, { environment } = {}) {
  if (!finRow) {
    return { ok: false, drift_kind: 'MISSING_FIN', field_diffs: { fin: null } }
  }
  if (!legacyRow) {
    return { ok: false, drift_kind: 'MISSING_LEGACY', field_diffs: { legacy: null } }
  }
  const envDrift = compareEnvironment(legacyRow, finRow, environment)
  if (envDrift) return envDrift

  const legacyUnits = num(legacyRow.units ?? legacyRow.amount ?? legacyRow.quantity, null)
  const finUnits = num(finRow.units ?? finRow.quantity_units, null)
  if (legacyUnits != null && finUnits != null && legacyUnits !== finUnits) {
    return mismatch('AMOUNT_MISMATCH', 'units', legacyUnits, finUnits)
  }

  const legacyHold = legacyRow.hold_id || legacyRow.holdId || null
  const finHold = finRow.hold_id || finRow.id || null
  if (legacyHold && finHold && text(legacyHold) !== text(finHold)) {
    return mismatch('FIELD_MISMATCH', 'hold_id', legacyHold, finHold)
  }

  const skew = compareTimestamp(
    legacyRow.captured_at || legacyRow.created_at,
    finRow.updated_at || finRow.created_at,
    'captured_at',
  )
  if (skew) return skew

  return { ok: true, drift_kind: null, field_diffs: {} }
}

export function compareForSource(source, legacyRow, finRow, opts = {}) {
  if (source === SOURCE_USAGE) return compareUsageEvent(legacyRow, finRow, opts)
  if (source === SOURCE_CONSUMPTION) return compareConsumption(legacyRow, finRow, opts)
  if (source === SOURCE_HOLDS) return compareHold(legacyRow, finRow, opts)
  if (source === SOURCE_CAPTURES) return compareCapture(legacyRow, finRow, opts)
  return { ok: false, drift_kind: 'OTHER', field_diffs: { source } }
}

/**
 * Classify a legacy row against 0..N fin mirrors.
 */
export function classifyMirror(source, legacyRow, finRows, opts = {}) {
  const rows = Array.isArray(finRows) ? finRows.filter(Boolean) : (finRows ? [finRows] : [])
  if (!legacyRow && rows.length) {
    return {
      ok: false,
      drift_kind: 'MISSING_LEGACY',
      field_diffs: { legacy: null },
      fin_snapshot: rows[0],
      legacy_snapshot: null,
    }
  }
  if (!legacyRow) {
    return { ok: false, drift_kind: 'OTHER', field_diffs: { empty: true } }
  }
  if (!rows.length) {
    return {
      ok: false,
      drift_kind: 'MISSING_FIN',
      field_diffs: { fin: null },
      fin_snapshot: null,
      legacy_snapshot: legacyRow,
    }
  }
  if (rows.length > 1) {
    return {
      ok: false,
      drift_kind: 'DUPLICATE_FIN',
      field_diffs: { fin_count: rows.length },
      fin_snapshot: rows[0],
      legacy_snapshot: legacyRow,
    }
  }
  const diff = compareForSource(source, legacyRow, rows[0], opts)
  return {
    ...diff,
    fin_snapshot: rows[0],
    legacy_snapshot: legacyRow,
  }
}
