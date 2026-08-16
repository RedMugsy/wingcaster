import { describe, expect, it } from 'vitest'
import { EVENT_KINDS, eventKindForHistory, ALL_EVENT_KINDS } from './events.js'
import { TEMPLATES, interpolate, renderTemplate } from './templates.js'

describe('EVENT_KINDS + eventKindForHistory', () => {
  it('every history event that maps to a notification maps to a real EVENT_KIND', () => {
    const historyEvents = [
      'trial_ended', 'renewed', 'past_due', 'reactivated',
      'cancelled_at_period_end', 'cancelled_immediately', 'expired',
      'paused', 'resumed', 'upgraded', 'downgraded', 'migrated_version',
      'grandfathered',
    ]
    for (const he of historyEvents) {
      const kind = eventKindForHistory(he)
      expect(kind).toBeTruthy()
      expect(ALL_EVENT_KINDS.includes(kind)).toBe(true)
    }
  })

  it('returns null for unknown / non-notified history events', () => {
    expect(eventKindForHistory('created')).toBeNull()
    expect(eventKindForHistory('trial_started')).toBeNull()
    expect(eventKindForHistory('nonsense')).toBeNull()
  })

  it('all EVENT_KINDS are unique strings and use snake_case with a dot prefix', () => {
    const set = new Set(ALL_EVENT_KINDS)
    expect(set.size).toBe(ALL_EVENT_KINDS.length)
    for (const kind of ALL_EVENT_KINDS) {
      expect(kind).toMatch(/^[a-z_]+\.[a-z_]+$/)
    }
  })
})

describe('interpolate', () => {
  it('replaces {{var}} with ctx values', () => {
    expect(interpolate('Hi {{name}}', { name: 'Alice' })).toBe('Hi Alice')
  })

  it('walks nested dotted paths', () => {
    expect(interpolate('{{tenant.name}} on {{plan.name}}', {
      tenant: { name: 'Bob' }, plan: { name: 'Pro' },
    })).toBe('Bob on Pro')
  })

  it('renders missing keys as empty string, not "undefined"', () => {
    expect(interpolate('Hello {{missing}}', {})).toBe('Hello ')
    expect(interpolate('{{a.b.c}}', { a: { b: null } })).toBe('')
  })

  it('tolerates {{ with spaces }}', () => {
    expect(interpolate('{{  name  }}', { name: 'X' })).toBe('X')
  })
})

describe('renderTemplate', () => {
  it('every EVENT_KIND has a template with non-empty subject + body', () => {
    for (const kind of ALL_EVENT_KINDS) {
      const template = TEMPLATES[kind]
      expect(template, `missing template for ${kind}`).toBeTruthy()
      expect(template.subject).toBeTruthy()
      expect(template.body).toBeTruthy()
    }
  })

  it('interpolates the tenant name + plan into a real subject', () => {
    const rendered = renderTemplate(EVENT_KINDS.SUB_TRIAL_ENDING, {
      tenant: { name: 'Alice' },
      plan: { name: 'Pro', price_display: 'USD 99.00', cadence: 'month' },
      trial_ends_at_short: 'Aug 23, 2026',
      days_left: 7,
      app_url: 'https://app.example',
    })
    expect(rendered.subject).toBe('Your Wingcaster trial ends in 7 day(s)')
    expect(rendered.body).toContain('Alice')
    expect(rendered.body).toContain('Pro')
    expect(rendered.body).toContain('USD 99.00')
    expect(rendered.body).toContain('Aug 23, 2026')
    expect(rendered.body).toContain('https://app.example/subscription')
  })

  it('unknown event kinds render a placeholder — no throw', () => {
    const rendered = renderTemplate('never.gonna.happen', {})
    expect(rendered.subject).toBe('[never.gonna.happen]')
    expect(rendered.body).toBe('[never.gonna.happen]')
  })
})
