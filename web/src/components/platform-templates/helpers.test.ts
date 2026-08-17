/**
 * Unit tests for the platform-template admin helpers.
 * Pure logic — no DOM.
 */
import { describe, expect, it } from 'vitest'
import {
  extractVariables,
  extractAllVariables,
  computeVariableDiagnostics,
  isTemplatePublishable,
  defaultPreviewVariables,
  sortTemplatesForList,
  channelLabel,
  categoryLabel,
} from './helpers'
import type { PlatformMessageTemplate } from '@/types/platformTemplates'

function template(overrides: Partial<PlatformMessageTemplate> = {}): PlatformMessageTemplate {
  return {
    id: 't-1', code: 'x', display_name: 'X', description: null,
    channel: 'email', category: 'auth',
    language: 'en', territory_id: null,
    subject: 'S {{code}}', html_body: '<p>{{code}}</p>', text_body: 'T {{code}}',
    design_json: null, editor_mode: 'raw',
    required_variables: ['code'], optional_variables: [],
    is_active: true, is_seed: false, version: 1,
    created_at: '', updated_at: '', created_by: null, updated_by: null,
    ...overrides,
  }
}

describe('extractVariables', () => {
  it('extracts unique variables in order of first appearance', () => {
    expect(extractVariables('Hi {{name}} {{code}} {{name}}')).toEqual(['name', 'code'])
  })
  it('supports dotted paths as a single name', () => {
    expect(extractVariables('{{user.name}} at {{user.agency}}')).toEqual(['user.name', 'user.agency'])
  })
  it('tolerates whitespace inside braces', () => {
    expect(extractVariables('{{ code }} {{  name  }}')).toEqual(['code', 'name'])
  })
  it('returns [] for null/undefined/empty', () => {
    expect(extractVariables(null)).toEqual([])
    expect(extractVariables(undefined)).toEqual([])
    expect(extractVariables('')).toEqual([])
  })
})

describe('extractAllVariables', () => {
  it('deduplicates across subject / html / text', () => {
    const vars = extractAllVariables({
      subject: '{{a}} {{b}}',
      html_body: '<p>{{b}} {{c}}</p>',
      text_body: '{{c}} {{d}}',
    })
    expect(new Set(vars)).toEqual(new Set(['a', 'b', 'c', 'd']))
  })
})

describe('computeVariableDiagnostics', () => {
  it('categorises correctly for a healthy template', () => {
    const diag = computeVariableDiagnostics({
      subject: 'S {{code}}',
      html_body: '<p>{{code}} {{name}}</p>',
      text_body: 'T {{name}}',
      required_variables: ['code', 'name'],
      optional_variables: ['support_email'],
    })
    expect(diag.required_present).toEqual(['code', 'name'])
    expect(diag.required_missing).toEqual([])
    expect(diag.optional_referenced).toEqual([])
    expect(diag.optional_unreferenced).toEqual(['support_email'])
    expect(diag.unknown_referenced).toEqual([])
  })

  it('flags a required variable that is not referenced', () => {
    const diag = computeVariableDiagnostics({
      subject: 'S', html_body: '<p>hi</p>', text_body: 'T',
      required_variables: ['code'],
    })
    expect(diag.required_present).toEqual([])
    expect(diag.required_missing).toEqual(['code'])
  })

  it('flags variables the template uses but no one declared', () => {
    const diag = computeVariableDiagnostics({
      subject: '{{code}}', html_body: '<p>{{mystery}}</p>', text_body: '',
      required_variables: ['code'],
    })
    expect(diag.unknown_referenced).toEqual(['mystery'])
  })

  it('handles all-nulls without exploding', () => {
    const diag = computeVariableDiagnostics({})
    expect(diag).toEqual({
      required_present: [], required_missing: [],
      optional_referenced: [], optional_unreferenced: [],
      unknown_referenced: [], all_referenced: [],
    })
  })
})

describe('isTemplatePublishable', () => {
  it('is ok when required vars are referenced and body/subject are present', () => {
    const res = isTemplatePublishable({
      subject: 'S {{code}}', html_body: '<p>{{code}}</p>', text_body: null,
      required_variables: ['code'], channel: 'email',
    })
    expect(res.ok).toBe(true)
  })

  it('blocks on a missing required variable', () => {
    const res = isTemplatePublishable({
      subject: 'S', html_body: '<p>hi</p>', text_body: null,
      required_variables: ['code'], channel: 'email',
    })
    expect(res.ok).toBe(false)
    expect(res.reason).toMatch(/code/)
  })

  it('blocks an email template without a subject', () => {
    const res = isTemplatePublishable({
      subject: '', html_body: '<p>hi</p>', text_body: null,
      required_variables: [], channel: 'email',
    })
    expect(res.ok).toBe(false)
    expect(res.reason).toMatch(/subject/i)
  })

  it('blocks when neither html nor text body is present', () => {
    const res = isTemplatePublishable({
      subject: 'S', html_body: null, text_body: null,
      required_variables: [], channel: 'email',
    })
    expect(res.ok).toBe(false)
    expect(res.reason).toMatch(/body/i)
  })

  it('allows a whatsapp template with only text body and no subject', () => {
    const res = isTemplatePublishable({
      subject: null, html_body: null, text_body: 'hi',
      required_variables: [], channel: 'whatsapp',
    })
    expect(res.ok).toBe(true)
  })
})

describe('defaultPreviewVariables', () => {
  it('produces sample values for well-known names', () => {
    const out = defaultPreviewVariables({ required_variables: ['code', 'name'] })
    expect(out.code).toBe('123456')
    expect(out.name).toBe('Ali Achkar')
  })

  it('falls back to angle-bracket placeholder for unknown names', () => {
    const out = defaultPreviewVariables({ required_variables: ['obscure_thing'] })
    expect(out.obscure_thing).toBe('<obscure_thing>')
  })

  it('includes optional variables too so the admin sees full coverage', () => {
    const out = defaultPreviewVariables({ required_variables: ['code'], optional_variables: ['support_email'] })
    expect(out.support_email).toBe('support@wingcaster.com')
  })
})

describe('sortTemplatesForList', () => {
  it('active before inactive, then by code, then language ascending', () => {
    const rows = [
      template({ id: '1', code: 'zeta', is_active: true }),           // active, z
      template({ id: '2', code: 'alpha', is_active: false }),          // inactive
      template({ id: '3', code: 'alpha', is_active: true, language: 'ar' }), // active a/ar
      template({ id: '4', code: 'alpha', is_active: true, language: 'en' }), // active a/en
    ]
    // Active first (3,4,1 in that group by code alpha,alpha,zeta);
    // within alpha, language ar < en. Then inactive (2).
    const sorted = sortTemplatesForList(rows)
    expect(sorted.map((r) => r.id)).toEqual(['3', '4', '1', '2'])
  })

  it('does not mutate the input array', () => {
    const rows = [template({ id: '1' }), template({ id: '2' })]
    const snapshot = [...rows]
    sortTemplatesForList(rows)
    expect(rows).toEqual(snapshot)
  })
})

describe('labels', () => {
  it('channelLabel renders WhatsApp with correct casing', () => {
    expect(channelLabel('whatsapp')).toBe('WhatsApp')
    expect(channelLabel('email')).toBe('Email')
    expect(channelLabel('sms')).toBe('SMS')
  })

  it('categoryLabel expands the enum for display', () => {
    expect(categoryLabel('auth')).toBe('Authentication')
    expect(categoryLabel('billing')).toBe('Billing')
  })
})
