/**
 * meter_versions.filter_definition DSL (A §6.4 / DL-063).
 *
 * Shape:
 *   {
 *     event_types: string[],                 // OR-match; omitted/empty = no constraint
 *     dimensions: { [key]: string | string[] }, // AND-match; array value = IN-match
 *     excludes: { event_types?, dimensions? }   // same matcher; match ⇒ reject
 *   }
 *
 * evaluateFilter (JS) and filterToSql (parameterised WHERE) share this matcher.
 */
import { CATEGORY, finError } from '../errors.js'

const ROOT_KEYS = new Set(['event_types', 'dimensions', 'excludes'])
const CLAUSE_KEYS = new Set(['event_types', 'dimensions'])

function invalid(details) {
  throw finError('FIN_FILTER_INVALID', {
    category: CATEGORY.VALIDATION,
    details: details || null,
  })
}

function assertPlainObject(value, label) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    invalid({ reason: `${label}_not_object` })
  }
}

function assertStringList(value, label) {
  if (!Array.isArray(value) || value.some((item) => typeof item !== 'string')) {
    invalid({ reason: `${label}_not_string_array` })
  }
}

function assertDimensions(value, label) {
  assertPlainObject(value, label)
  for (const [key, entry] of Object.entries(value)) {
    if (typeof key !== 'string' || key.length === 0) {
      invalid({ reason: `${label}_empty_key` })
    }
    if (typeof entry === 'string') continue
    if (Array.isArray(entry) && entry.every((item) => typeof item === 'string')) continue
    invalid({ reason: `${label}_value_not_string_or_string_array`, key })
  }
}

function assertClause(value, label, allowedKeys) {
  assertPlainObject(value, label)
  for (const key of Object.keys(value)) {
    if (!allowedKeys.has(key)) invalid({ reason: 'unknown_key', key, at: label })
  }
  if (Object.prototype.hasOwnProperty.call(value, 'event_types')) {
    assertStringList(value.event_types, `${label}.event_types`)
  }
  if (Object.prototype.hasOwnProperty.call(value, 'dimensions')) {
    assertDimensions(value.dimensions, `${label}.dimensions`)
  }
}

export function validateFilter(definition) {
  if (definition == null) invalid({ reason: 'missing' })
  assertClause(definition, 'root', ROOT_KEYS)
  if (Object.prototype.hasOwnProperty.call(definition, 'excludes')) {
    assertClause(definition.excludes, 'excludes', CLAUSE_KEYS)
  }
  return definition
}

function asText(value) {
  if (value == null) return null
  return String(value)
}

function inList(value, list) {
  const text = asText(value)
  if (text == null) return false
  return list.includes(text)
}

function dimensionMatches(eventDimensions, expected) {
  const dims = eventDimensions && typeof eventDimensions === 'object' && !Array.isArray(eventDimensions)
    ? eventDimensions
    : {}
  for (const [key, entry] of Object.entries(expected || {})) {
    const actual = asText(dims[key])
    if (Array.isArray(entry)) {
      if (!inList(actual, entry)) return false
    } else if (actual !== entry) {
      return false
    }
  }
  return true
}

function clauseMatches(event, clause) {
  if (!clause) return true
  const types = clause.event_types
  if (Array.isArray(types) && types.length > 0) {
    if (!types.includes(event.event_type)) return false
  }
  if (clause.dimensions && Object.keys(clause.dimensions).length > 0) {
    if (!dimensionMatches(event.dimensions, clause.dimensions)) return false
  }
  return true
}

export function hasFilterConstraint(clause) {
  if (!clause || typeof clause !== 'object') return false
  if (Array.isArray(clause.event_types) && clause.event_types.length > 0) return true
  if (clause.dimensions && Object.keys(clause.dimensions).length > 0) return true
  return false
}

export function evaluateFilter(event, definition) {
  const def = validateFilter(definition || {})
  if (!clauseMatches(event, def)) return false
  if (hasFilterConstraint(def.excludes) && clauseMatches(event, def.excludes)) return false
  return true
}

function pushClauseSql(clause, alias, params, startIndex) {
  const parts = []
  let index = startIndex
  if (Array.isArray(clause.event_types) && clause.event_types.length > 0) {
    params.push(clause.event_types)
    parts.push(`${alias}.event_type = ANY($${index}::text[])`)
    index += 1
  }
  for (const [key, entry] of Object.entries(clause.dimensions || {})) {
    params.push(key)
    const keyIdx = index
    index += 1
    if (Array.isArray(entry)) {
      params.push(entry)
      parts.push(`${alias}.dimensions ->> $${keyIdx} = ANY($${index}::text[])`)
      index += 1
    } else {
      params.push(entry)
      parts.push(`${alias}.dimensions ->> $${keyIdx} = $${index}`)
      index += 1
    }
  }
  return { sql: parts.length ? parts.join(' AND ') : 'TRUE', nextIndex: index }
}

export function filterToSql(definition, alias = 'e', startIndex = 1) {
  const def = validateFilter(definition || {})
  const params = []
  const include = pushClauseSql(def, alias, params, startIndex)
  const parts = [include.sql]
  let nextIndex = include.nextIndex
  if (hasFilterConstraint(def.excludes)) {
    const exclude = pushClauseSql(def.excludes, alias, params, nextIndex)
    parts.push(`NOT (${exclude.sql})`)
    nextIndex = exclude.nextIndex
  }
  return {
    where: parts.filter(Boolean).join(' AND ') || 'TRUE',
    params,
  }
}
