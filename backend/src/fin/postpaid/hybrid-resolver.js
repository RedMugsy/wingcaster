/**
 * Pure §58 hybrid draw order. No SQL.
 *
 * 1. eligible prepaid lots (Stage 6 lotIsEligible; not PURCHASE / FACILITY_DRAW)
 * 2. committed lots (PURCHASE + contract_id) — DL-108
 * 3. other PURCHASE lots
 * 4. facility shortfall if allow_postpaid_usage && facility ACTIVE
 */
import { lotIsEligible } from '../auth/lot-resolver.js'

function asUnits(value) {
  if (value == null || value === '') return 0n
  return BigInt(value)
}

function remainingOf(lot) {
  return asUnits(lot.remaining_units ?? lot.remainingUnits ?? 0)
}

function sourceKind(lot) {
  return lot.source_kind || lot.sourceKind || ''
}

function contractId(lot) {
  return lot.contract_id || lot.contractId || null
}

function cmpLots(a, b) {
  const dp = Number(a.draw_priority ?? a.drawPriority ?? 0)
    - Number(b.draw_priority ?? b.drawPriority ?? 0)
  if (dp !== 0) return dp
  const ae = Date.parse(a.expires_at ?? a.expiresAt ?? '9999-01-01') || 0
  const be = Date.parse(b.expires_at ?? b.expiresAt ?? '9999-01-01') || 0
  if (ae !== be) return ae - be
  const ai = Date.parse(a.issued_at ?? a.issuedAt ?? 0) || 0
  const bi = Date.parse(b.issued_at ?? b.issuedAt ?? 0) || 0
  if (ai !== bi) return ai - bi
  return String(a.id).localeCompare(String(b.id))
}

function bucket(lot) {
  const kind = sourceKind(lot)
  if (kind === 'FACILITY_DRAW') return null
  if (kind === 'PURCHASE' && contractId(lot)) return 'committed'
  if (kind === 'PURCHASE') return 'purchased'
  return 'prepaid'
}

function drawFrom(lots, outstanding) {
  const allocations = []
  let left = outstanding
  for (const lot of lots) {
    if (left === 0n) break
    const remaining = remainingOf(lot)
    if (remaining <= 0n) continue
    const take = remaining < left ? remaining : left
    allocations.push({ lotId: lot.id, units: take })
    left -= take
  }
  return { allocations, remaining: left }
}

export function resolveHybridPlan({
  lots = [],
  unitsRequested,
  facility = null,
  controls = null,
  amountMinor = null,
  meterId,
  actionKey,
  category,
  vendorId,
  now,
} = {}) {
  const requested = asUnits(unitsRequested)
  const eligible = [...lots]
    .filter((lot) => lotIsEligible(lot, {
      meterId, actionKey, category, vendorId, now,
    }))
    .sort(cmpLots)

  const prepaid = eligible.filter((lot) => bucket(lot) === 'prepaid')
  const committed = eligible.filter((lot) => bucket(lot) === 'committed')
  const purchased = eligible.filter((lot) => bucket(lot) === 'purchased')

  const a = drawFrom(prepaid, requested)
  const b = drawFrom(committed, a.remaining)
  const c = drawFrom(purchased, b.remaining)
  const allocations = [...a.allocations, ...b.allocations, ...c.allocations]
  const shortfallUnits = c.remaining

  const postpaidAllowed = controls?.allow_postpaid_usage !== false
    && controls?.allowPostpaidUsage !== false
  const facilityActive = facility && (facility.status || facility.status) === 'ACTIVE'

  if (shortfallUnits === 0n) {
    return {
      covered: true,
      allocations,
      facilityShortfallUnits: 0n,
      facilityShortfallMinor: 0n,
      denialCode: null,
    }
  }

  if (!postpaidAllowed || !facility) {
    return {
      covered: false,
      allocations,
      facilityShortfallUnits: shortfallUnits,
      facilityShortfallMinor: 0n,
      denialCode: 'INSUFFICIENT_ELIGIBLE_CREDITS',
    }
  }

  if (!facilityActive) {
    return {
      covered: false,
      allocations,
      facilityShortfallUnits: shortfallUnits,
      facilityShortfallMinor: 0n,
      denialCode: 'FACILITY_NOT_ACTIVE',
    }
  }

  const total = requested === 0n ? 0n : requested
  const minor = amountMinor == null
    ? shortfallUnits
    : (shortfallUnits * asUnits(amountMinor)) / (total === 0n ? 1n : total)

  return {
    covered: true,
    allocations,
    facilityShortfallUnits: shortfallUnits,
    facilityShortfallMinor: minor,
    denialCode: null,
  }
}
