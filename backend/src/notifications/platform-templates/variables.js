/**
 * Variable extraction, validation, and rendering for platform message
 * templates.
 *
 * Syntax matches the existing billing template convention
 * (billing/notifications/templates.js): `{{name}}` and dotted paths like
 * `{{user.name}}`. Whitespace inside the braces is tolerated. Anything
 * that doesn't match the pattern is left as literal text.
 *
 * Two rendering functions:
 *   - renderText — no escaping, for plain-text bodies and subjects
 *   - renderHtml — HTML-escapes the substituted values, so an admin
 *     entering `Hello {{name}}` cannot be turned into an XSS vector by
 *     a value like `<script>...`
 *
 * Enforcement lives at the service layer (service.js) which calls
 * `assertRequiredVariablesPresent()` before every write. That is the seam
 * that keeps an OTP template from being saved without {{code}}.
 */

const VARIABLE_RE = /\{\{\s*([\w.]+)\s*\}\}/g

/**
 * Extract the unique set of variable names referenced by a template string,
 * in order of first appearance. Dotted paths are treated as a single name
 * (`{{user.name}}` → `user.name`), because that is what a caller must
 * provide in the context object.
 */
export function extractVariables(source) {
  if (source == null || source === '') return []
  const seen = new Set()
  const result = []
  for (const match of String(source).matchAll(VARIABLE_RE)) {
    const name = match[1]
    if (!seen.has(name)) {
      seen.add(name)
      result.push(name)
    }
  }
  return result
}

/**
 * Variable set referenced across every part of a template — subject, html,
 * and text — with duplicates collapsed.
 */
export function extractAllVariables({ subject, html_body, text_body }) {
  const seen = new Set()
  for (const part of [subject, html_body, text_body]) {
    for (const name of extractVariables(part)) seen.add(name)
  }
  return [...seen]
}

/**
 * Check that every required variable is actually referenced by the template.
 * A required variable that is not referenced is a silent breakage: the
 * caller passes a code, we substitute nothing, the recipient sees a blank
 * where their code should have been.
 *
 * Throws with a structured error so the admin UI can highlight exactly
 * which variables are missing without parsing an error message.
 */
export function assertRequiredVariablesPresent(template, required = []) {
  const requiredList = Array.isArray(required) ? required : []
  if (!requiredList.length) return
  const referenced = new Set(extractAllVariables(template))
  const missing = requiredList.filter((name) => !referenced.has(name))
  if (missing.length) {
    const err = new Error(`Template is missing required variable(s): ${missing.join(', ')}`)
    err.code = 'TEMPLATE_MISSING_REQUIRED_VARIABLES'
    err.missing = missing
    throw err
  }
}

/**
 * Variables the template references but that are NOT in either the
 * required or optional set. Non-fatal — the admin UI should show a
 * warning next to unknown variables because they will render blank in
 * production.
 */
export function findUnknownVariables(template, required = [], optional = []) {
  const known = new Set([...(required || []), ...(optional || [])])
  const referenced = new Set(extractAllVariables(template))
  return [...referenced].filter((name) => !known.has(name))
}

// Minimal HTML-escaping. Written by hand so this module has no runtime
// dependency; the character set is fixed and the surface is tiny.
const HTML_ESCAPE = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;',
}
function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (ch) => HTML_ESCAPE[ch])
}

function resolvePath(ctx, dottedName) {
  const parts = dottedName.split('.')
  let cur = ctx
  for (const part of parts) {
    if (cur == null || typeof cur !== 'object') return undefined
    cur = cur[part]
  }
  return cur
}

function interpolate(source, ctx, escape) {
  if (source == null || source === '') return source ?? ''
  return String(source).replace(VARIABLE_RE, (_match, name) => {
    const value = resolvePath(ctx, name)
    if (value == null) return ''
    return escape ? escapeHtml(value) : String(value)
  })
}

/**
 * Render a plain-text template. No escaping — the output is not HTML.
 */
export function renderText(source, ctx = {}) {
  return interpolate(source, ctx, false)
}

/**
 * Render an HTML template. Substituted values are HTML-escaped so an
 * admin who authored `Hello {{name}}` cannot have their template become
 * an XSS vector by a downstream `name` value of `<script>...</script>`.
 *
 * The template itself is NOT escaped — the admin authored the HTML on
 * purpose and can use tags freely. Only the interpolated values are
 * escaped.
 */
export function renderHtml(source, ctx = {}) {
  return interpolate(source, ctx, true)
}

/**
 * Render an entire template in one call. Convenience wrapper for
 * callers that don't want to invoke each part individually.
 */
export function renderTemplate(template, ctx = {}) {
  return {
    subject: renderText(template.subject, ctx),
    html_body: renderHtml(template.html_body, ctx),
    text_body: renderText(template.text_body, ctx),
  }
}
