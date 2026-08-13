/**
 * Data-binding expression engine for template layer bind + show_if fields.
 *
 * Syntax:
 *   {{path.to.value}}                       simple property lookup
 *   {{path.to.value | default: "n/a"}}      default when missing
 *   {{formatPrice listing.price listing.price_unit}}
 *   {{formatArea listing.area listing.area_unit}}
 *   {{upper listing.city}}
 *   {{lower listing.type}}
 *   {{truncate listing.title 40}}
 *   {{coalesce listing.neighborhood listing.city listing.location}}
 *   {{if listing.bedrooms "yes" "no"}}      inline ternary
 *   {{status listing.status}}               normalised label from listing status
 *
 * show_if expressions are single boolean predicates:
 *   listing.bedrooms > 0
 *   listing.status == "archived"
 *   listing.type != "rent"
 *   agent.name
 *
 * The engine is intentionally small — no full JS eval, no arbitrary
 * function calls. Only the helpers below are callable.
 */

import { formatPrice, safeText, truncate } from './shared.js'

const HELPERS = {
  formatPrice: (value, unit) => formatPrice(value, unit),
  formatArea:  (value, unit) => (value == null ? '' : `${value} ${unit || 'sqm'}`),
  upper:       (v) => String(v ?? '').toUpperCase(),
  lower:       (v) => String(v ?? '').toLowerCase(),
  truncate:    (v, n) => truncate(v, Number(n) || 60),
  coalesce:    (...args) => args.find((a) => a != null && a !== '') ?? '',
  status:      (v) => STATUS_LABELS[String(v || '').toLowerCase()] || String(v || ''),
  if:          (cond, yes, no) => (cond ? yes : no),
}

const STATUS_LABELS = {
  draft:       'DRAFT',
  published:   'FOR SALE',
  unpublished: 'OFF MARKET',
  archived:    'SOLD',
  pending:     'PENDING',
}

/**
 * Resolve a dotted path against a context object. Supports array indexing
 * via bracket notation only in a limited form: `listing.photos[0]`.
 * Exported so the SVG renderer can look up bare paths for photo layers.
 */
export function resolvePath(path, ctx) {
  if (!path) return undefined
  const parts = String(path).split('.').flatMap((seg) => {
    const m = seg.match(/^(\w+)(\[(\d+)\])?$/)
    if (!m) return [seg]
    return m[3] != null ? [m[1], Number(m[3])] : [m[1]]
  })
  let cur = ctx
  for (const p of parts) {
    if (cur == null) return undefined
    cur = cur[p]
  }
  return cur
}

function tokenizeExpression(expr) {
  // Splits on whitespace but respects double-quoted string literals.
  const tokens = []
  let i = 0, buf = '', inStr = false
  while (i < expr.length) {
    const c = expr[i]
    if (c === '"' || c === "'") {
      if (!inStr) { inStr = c; buf = ''; i++; continue }
      if (inStr === c) { tokens.push({ kind: 'string', value: buf }); inStr = false; buf = ''; i++; continue }
      buf += c; i++; continue
    }
    if (inStr) { buf += c; i++; continue }
    if (/\s/.test(c)) {
      if (buf) { tokens.push({ kind: 'raw', value: buf }); buf = '' }
      i++; continue
    }
    buf += c; i++
  }
  if (buf) tokens.push({ kind: 'raw', value: buf })
  return tokens
}

function resolveToken(t, ctx) {
  if (t.kind === 'string') return t.value
  const raw = t.value
  if (raw === 'true') return true
  if (raw === 'false') return false
  if (raw === 'null') return null
  if (/^-?\d+(\.\d+)?$/.test(raw)) return Number(raw)
  return resolvePath(raw, ctx)
}

function evaluateBraceExpression(inner, ctx) {
  // Support: value [| default: "fallback"]
  const [expr, ...tail] = inner.split('|').map((s) => s.trim())
  let value

  const tokens = tokenizeExpression(expr)
  if (!tokens.length) return ''

  const head = tokens[0]
  if (head.kind === 'raw' && Object.prototype.hasOwnProperty.call(HELPERS, head.value)) {
    const args = tokens.slice(1).map((t) => resolveToken(t, ctx))
    value = HELPERS[head.value](...args)
  } else {
    value = resolveToken(head, ctx)
  }

  // Optional default: syntax  | default: "n/a"
  for (const modifier of tail) {
    const m = modifier.match(/^default:\s*(.+)$/i)
    if (m) {
      if (value == null || value === '') {
        const raw = m[1].trim()
        if ((raw.startsWith('"') && raw.endsWith('"')) || (raw.startsWith("'") && raw.endsWith("'"))) {
          value = raw.slice(1, -1)
        } else {
          value = raw
        }
      }
    }
  }
  return value
}

/**
 * Interpolate a string that may contain multiple {{ ... }} tokens.
 * Returns the fully resolved string.
 */
export function interpolate(input, ctx) {
  if (typeof input !== 'string') return input
  if (!input.includes('{{')) return input
  return input.replace(/\{\{([^}]+)\}\}/g, (_, inner) => {
    const v = evaluateBraceExpression(inner.trim(), ctx)
    return v == null ? '' : String(v)
  })
}

/**
 * Evaluate a show_if boolean expression. Supports simple binary comparisons
 * (==, !=, >, <, >=, <=) and truthiness of a single path.
 */
export function evaluateCondition(expr, ctx) {
  if (!expr) return true
  const trimmed = String(expr).trim()

  const cmpMatch = trimmed.match(/^(.+?)\s*(==|!=|>=|<=|>|<)\s*(.+)$/)
  if (cmpMatch) {
    const [, lhsRaw, op, rhsRaw] = cmpMatch
    const lhsTok = tokenizeExpression(lhsRaw.trim())[0]
    const rhsTok = tokenizeExpression(rhsRaw.trim())[0]
    const lhs = lhsTok ? resolveToken(lhsTok, ctx) : undefined
    const rhs = rhsTok ? resolveToken(rhsTok, ctx) : undefined
    switch (op) {
      case '==': return lhs == rhs // eslint-disable-line eqeqeq
      case '!=': return lhs != rhs // eslint-disable-line eqeqeq
      case '>':  return Number(lhs) >  Number(rhs)
      case '<':  return Number(lhs) <  Number(rhs)
      case '>=': return Number(lhs) >= Number(rhs)
      case '<=': return Number(lhs) <= Number(rhs)
      default:   return true
    }
  }

  // Truthiness of a single path or literal.
  const tok = tokenizeExpression(trimmed)[0]
  const v = tok ? resolveToken(tok, ctx) : undefined
  return Boolean(v) && !(typeof v === 'string' && v.trim() === '')
}

/**
 * Build the standard context object passed to bind + show_if resolution.
 * Kept minimal on purpose — no whole DB objects, only the fields templates
 * are allowed to reference. This is also what the frontend editor uses to
 * populate the "bind picker" dropdown.
 */
export function buildBindingContext({ listing, agent, brand, distribution, extras }) {
  return {
    listing: listing ? {
      id: listing.id,
      title: listing.title,
      description: listing.description,
      type: listing.type,
      property_type: listing.property_type,
      price: listing.price,
      price_unit: listing.price_unit,
      bedrooms: listing.bedrooms,
      bathrooms: listing.bathrooms,
      area: listing.area,
      area_unit: listing.area_unit,
      location: listing.location,
      city: listing.city,
      neighborhood: listing.neighborhood,
      address: listing.address,
      status: listing.status,
      reference: listing.reference,
      permit_number: listing.permit_number,
      photos: listing.photos || [],
    } : {},
    agent: agent ? {
      id: agent.id, name: agent.name, phone: agent.phone, email: agent.email,
      photo: agent.photo, agency_name: agent.agency_name, specialization: agent.specialization,
    } : {},
    brand: brand ? {
      name: brand.name, tagline: brand.tagline,
      logo_url: brand.logoUrl, icon_url: brand.iconUrl,
      primary_color: brand.primaryColor, accent_color: brand.accentColor,
    } : {},
    distribution: distribution ? {
      platform: distribution.platform, external_id: distribution.external_id,
      landing_page: distribution.landing_page,
    } : {},
    extras: extras || {},
  }
}

/**
 * List of all bindable paths — used by the frontend to populate the
 * "insert binding" dropdown in the template editor without needing a live
 * listing to introspect.
 */
export const BINDABLE_PATHS = [
  'listing.title', 'listing.description', 'listing.type', 'listing.property_type',
  'listing.price', 'listing.price_unit', 'listing.bedrooms', 'listing.bathrooms',
  'listing.area', 'listing.area_unit', 'listing.location', 'listing.city',
  'listing.neighborhood', 'listing.address', 'listing.status', 'listing.reference',
  'listing.photos[0]', 'listing.photos[1]', 'listing.photos[2]',
  'agent.name', 'agent.phone', 'agent.email', 'agent.photo', 'agent.agency_name',
  'brand.name', 'brand.logo_url', 'brand.icon_url', 'brand.primary_color', 'brand.accent_color',
]
