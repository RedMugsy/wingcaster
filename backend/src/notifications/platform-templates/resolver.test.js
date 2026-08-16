/**
 * Unit tests for the resolver's scoring rules.
 *
 * The actual database query is trivial — `WHERE code = ? AND is_active`
 * pulls at most a handful of candidates — but the SCORING that picks
 * which candidate wins is the load-bearing bit. Test it in isolation
 * against synthetic rows so a fallback-chain change is caught here
 * before it ships as a subtle "why is the wrong copy being sent"
 * production bug.
 */
import { describe, expect, it } from 'vitest'
import { __testables } from './resolver.js'

const { pickBest, normaliseLanguage, DEFAULT_LANGUAGE } = __testables

function row({ code = 'signup_otp', language = 'en', territory_id = null, id }) {
  return { id: id || `${code}:${language}:${territory_id || 'global'}`, code, language, territory_id }
}

describe('normaliseLanguage', () => {
  it('lowercases and trims', () => {
    expect(normaliseLanguage('EN')).toBe('en')
    expect(normaliseLanguage('  ar  ')).toBe('ar')
  })
  it('falls back to the default when missing', () => {
    expect(normaliseLanguage(null)).toBe(DEFAULT_LANGUAGE)
    expect(normaliseLanguage(undefined)).toBe(DEFAULT_LANGUAGE)
    expect(normaliseLanguage('')).toBe(DEFAULT_LANGUAGE)
  })
})

describe('pickBest', () => {
  const CODE = 'signup_otp'
  const SA = 'territory-sa'
  const LB = 'territory-lb'

  it('returns null when nothing is available', () => {
    expect(pickBest([], { code: CODE, language: 'en', territoryId: SA })).toBeNull()
  })

  it('picks the exact (language, territory) match when it exists', () => {
    const rows = [
      row({ language: 'en', territory_id: null, id: 'global-en' }),
      row({ language: 'ar', territory_id: null, id: 'global-ar' }),
      row({ language: 'ar', territory_id: SA, id: 'sa-ar' }),
    ]
    expect(pickBest(rows, { code: CODE, language: 'ar', territoryId: SA }).id).toBe('sa-ar')
  })

  it('falls back to the language match without a territory', () => {
    const rows = [
      row({ language: 'en', territory_id: null, id: 'global-en' }),
      row({ language: 'ar', territory_id: null, id: 'global-ar' }),
    ]
    expect(pickBest(rows, { code: CODE, language: 'ar', territoryId: SA }).id).toBe('global-ar')
  })

  it('falls back to the default-language territorial override when the language is missing', () => {
    const rows = [
      row({ language: 'en', territory_id: null, id: 'global-en' }),
      row({ language: 'en', territory_id: SA, id: 'sa-en' }),
    ]
    expect(pickBest(rows, { code: CODE, language: 'ar', territoryId: SA }).id).toBe('sa-en')
  })

  it('falls back to the global default when nothing else matches', () => {
    const rows = [row({ language: 'en', territory_id: null, id: 'global-en' })]
    expect(pickBest(rows, { code: CODE, language: 'ar', territoryId: SA }).id).toBe('global-en')
  })

  it('prefers the language match over a territorial default-language override', () => {
    // A locale a business chose to translate is more likely to be what
    // they want everywhere than an English territorial override in a
    // non-English territory. Documented in the resolver's comment so
    // this stays a deliberate choice, not an accident.
    const rows = [
      row({ language: 'ar', territory_id: null, id: 'global-ar' }),
      row({ language: 'en', territory_id: SA, id: 'sa-en' }),
    ]
    expect(pickBest(rows, { code: CODE, language: 'ar', territoryId: SA }).id).toBe('global-ar')
  })

  it('never returns a row whose code does not match', () => {
    // Guardrail — the SQL is scoped by `code`, but a defensive filter here
    // means a caller passing rows from mixed queries cannot accidentally
    // return the wrong template.
    const rows = [row({ code: 'other_template', language: 'en', territory_id: null, id: 'wrong' })]
    expect(pickBest(rows, { code: CODE, language: 'en', territoryId: null })).toBeNull()
  })

  it('does not pick a territorial row belonging to a different territory', () => {
    // This case would be prevented by the SQL, but the score for
    // `territory_id = null` vs `territory_id = SA` when the caller wants
    // LB must not somehow prefer SA.
    const rows = [
      row({ language: 'en', territory_id: null, id: 'global-en' }),
      row({ language: 'en', territory_id: SA, id: 'sa-en' }),
    ]
    // When we ask for LB, the SA row would not even come from the query;
    // but if a caller passes both in, the global row must win over SA.
    expect(pickBest(rows, { code: CODE, language: 'en', territoryId: LB }).id).toBe('global-en')
  })
})
