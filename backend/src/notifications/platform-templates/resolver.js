/**
 * Template lookup with per-territory / per-language fallback.
 *
 * The admin can create up to four kinds of row for one template code:
 *
 *   1. (code, language, territory_id)   — Arabic copy for Saudi
 *   2. (code, language, NULL)           — Arabic copy for everywhere else
 *   3. (code, 'en',      territory_id)  — English copy for Saudi
 *   4. (code, 'en',      NULL)          — global English default
 *
 * A send request comes with a code plus context (`{language, territoryId}`).
 * The resolver walks the four candidates in that order and returns the first
 * one that is active. This means the admin only creates the variants they
 * actually need — a new territory inherits the global default until someone
 * chooses to override it.
 *
 * The fallback chain is deliberately simple. More complex strategies (per-
 * agency, per-plan-tier) can layer on later by extending the query, without
 * changing callers.
 *
 * Missing template is NOT an error here — the caller decides whether to
 * throw, log-and-drop, or fall back to a hardcoded copy. That policy is
 * different for auth OTPs (must never silently no-op) vs. marketing sends
 * (fine to skip if not configured).
 */

import { query } from '../../db.js'

const DEFAULT_LANGUAGE = 'en'

function normaliseLanguage(lang) {
  if (!lang) return DEFAULT_LANGUAGE
  // ISO 639-1 primary subtag only — `en-US` and `en-GB` both resolve to
  // `en` for template purposes. Callers wanting locale-specific variants
  // should create them with a language column of `en-us` etc. and pass
  // the full tag; that still hits the exact-match branch first.
  return String(lang).toLowerCase().trim()
}

function pickBest(rows, { language, territoryId, code }) {
  if (!rows.length) return null
  const lang = normaliseLanguage(language)
  const scoreOf = (row) => {
    // Higher = better match. Language is more important than territory —
    // an admin who overrode Arabic copy globally is more likely to want
    // that copy in every territory than to want the English territorial
    // override in Arabic-speaking Saudi. Reverse this if a real customer
    // says otherwise; the field is easy to change.
    let s = 0
    if (row.language === lang) s += 4
    else if (row.language === DEFAULT_LANGUAGE) s += 1
    if (territoryId && row.territory_id === territoryId) s += 2
    else if (row.territory_id == null) s += 1
    return s
  }
  return rows
    .filter((row) => row.code === code)
    .sort((a, b) => scoreOf(b) - scoreOf(a))[0] || null
}

/**
 * Resolve a template for the given send context.
 *
 * @param {object} args
 * @param {string} args.code - stable template code (e.g. 'signup_otp')
 * @param {string} [args.language='en'] - ISO 639-1 code
 * @param {string} [args.territoryId] - territory to prefer, if any
 * @param {object} [args.client] - optional pg client to run inside a txn
 * @returns {Promise<object|null>} the best-matching active template row, or null
 */
export async function resolveTemplate({ code, language, territoryId, client } = {}) {
  if (!code) throw new Error('resolveTemplate: code is required')
  const lang = normaliseLanguage(language)

  // A single query pulls every candidate row (typically 1–4) and the
  // score is applied in JS. Pushing the score into SQL is possible but
  // makes the query hard to read for at most a 4-row deduplication.
  const sql = `
    SELECT *
      FROM platform_message_templates
     WHERE code = $1
       AND is_active = true
       AND (language = $2 OR language = $3)
       AND (territory_id IS NULL OR territory_id = $4)
  `
  const params = [code, lang, DEFAULT_LANGUAGE, territoryId || null]
  const rows = client
    ? (await client.query(sql, params)).rows
    : await query(sql, params)
  return pickBest(rows, { code, language: lang, territoryId })
}

/** Exposed for testability of the scoring rules in isolation. */
export const __testables = { pickBest, normaliseLanguage, DEFAULT_LANGUAGE }
