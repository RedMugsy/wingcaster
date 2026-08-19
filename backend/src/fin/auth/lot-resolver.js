/**
 * Pure lot selection (A §5.2 / C §4). No SQL, no rating, no locks.
 * Arithmetic is BIGINT. Facility fallback is Stage 8 — shortfall stays uncovered.
 */

function asUnits(value) {
  if (value == null || value === '') return 0n
  return BigInt(value)
}

function epochMs(value) {
  if (value == null || value === '') return null
  if (value instanceof Date) return value.getTime()
  const ms = Date.parse(value)
  return Number.isFinite(ms) ? ms : null
}

function rulesOf(lot) {
  return lot.rules
    || lot.applicability_rules
    || lot.applicabilityRules
    || []
}

function ruleKind(rule) {
  return rule.rule_kind || rule.ruleKind
}

const DIMENSIONS = [
  { allow: 'ALLOW_METER', deny: 'DENY_METER', key: 'meterId' },
  { allow: 'ALLOW_ACTION', deny: 'DENY_ACTION', key: 'actionKey' },
  { allow: 'ALLOW_CATEGORY', deny: 'DENY_CATEGORY', key: 'category' },
  { allow: 'ALLOW_VENDOR', deny: 'DENY_VENDOR', key: 'vendorId' },
]

function matcherEquals(rule, value) {
  if (value == null || value === '') return false
  return String(rule.matcher) === String(value)
}

export function lotIsEligible(lot, {
  meterId, actionKey, category, vendorId, now,
} = {}) {
  if ((lot.status || 'ACTIVE') !== 'ACTIVE') return false
  const nowMs = epochMs(now)
  const expiresMs = epochMs(lot.expires_at ?? lot.expiresAt)
  if (expiresMs != null && nowMs != null && expiresMs <= nowMs) return false

  const ctx = { meterId, actionKey, category, vendorId }
  const rules = rulesOf(lot)
  for (const dim of DIMENSIONS) {
    const allows = rules.filter((rule) => ruleKind(rule) === dim.allow)
    const denies = rules.filter((rule) => ruleKind(rule) === dim.deny)
    const value = ctx[dim.key]
    if (denies.some((rule) => matcherEquals(rule, value))) return false
    if (allows.length > 0 && !allows.some((rule) => matcherEquals(rule, value))) {
      return false
    }
  }
  return true
}

function cmpLots(a, b) {
  const dp = Number(a.draw_priority ?? a.drawPriority ?? 0)
    - Number(b.draw_priority ?? b.drawPriority ?? 0)
  if (dp !== 0) return dp

  const ae = epochMs(a.expires_at ?? a.expiresAt)
  const be = epochMs(b.expires_at ?? b.expiresAt)
  const aExp = ae == null ? Number.POSITIVE_INFINITY : ae
  const bExp = be == null ? Number.POSITIVE_INFINITY : be
  if (aExp !== bExp) return aExp - bExp

  const ai = epochMs(a.issued_at ?? a.issuedAt)
  const bi = epochMs(b.issued_at ?? b.issuedAt)
  const aIss = ai == null ? Number.POSITIVE_INFINITY : ai
  const bIss = bi == null ? Number.POSITIVE_INFINITY : bi
  if (aIss !== bIss) return aIss - bIss

  return String(a.id).localeCompare(String(b.id))
}

export function resolveDrawPlan({
  lots = [],
  meterId,
  actionKey,
  category,
  vendorId,
  unitsRequested,
  now,
} = {}) {
  const outstandingRequested = asUnits(unitsRequested)
  let outstanding = outstandingRequested
  if (outstanding < 0n) outstanding = 0n

  const eligible = [...lots]
    .filter((lot) => lotIsEligible(lot, {
      meterId, actionKey, category, vendorId, now,
    }))
    .sort(cmpLots)

  const allocations = []
  for (const lot of eligible) {
    if (outstanding === 0n) break
    const remaining = asUnits(lot.remaining_units ?? lot.remainingUnits ?? 0)
    if (remaining <= 0n) continue
    const take = remaining < outstanding ? remaining : outstanding
    allocations.push({ lotId: lot.id, units: take })
    outstanding -= take
  }

  return {
    covered: outstanding === 0n,
    allocations,
    shortfall: outstanding,
  }
}
