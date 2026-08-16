/**
 * Unit tests for platform-template variable extraction, validation and
 * rendering. Pure logic — no database.
 */
import { describe, expect, it } from 'vitest'
import {
  extractVariables,
  extractAllVariables,
  assertRequiredVariablesPresent,
  findUnknownVariables,
  renderText,
  renderHtml,
  renderTemplate,
} from './variables.js'

describe('extractVariables', () => {
  it('finds simple variables in order of first appearance', () => {
    expect(extractVariables('Hi {{name}}, your code is {{code}}'))
      .toEqual(['name', 'code'])
  })

  it('collapses duplicates', () => {
    expect(extractVariables('{{code}} — repeat {{code}} out loud, {{code}}'))
      .toEqual(['code'])
  })

  it('supports dotted paths as single names', () => {
    // The value must be provided as `user.name`, so it is one variable
    // name, not two.
    expect(extractVariables('Hello {{user.name}} from {{user.agency.name}}'))
      .toEqual(['user.name', 'user.agency.name'])
  })

  it('tolerates whitespace inside the braces', () => {
    expect(extractVariables('{{ code }} and {{  user.name  }}'))
      .toEqual(['code', 'user.name'])
  })

  it('ignores malformed patterns', () => {
    // Single braces, empty braces, and braces with punctuation are all
    // rejected. Numeric segments ARE valid — the regex allows them so
    // dotted array access like `{{items.0.name}}` works — so `{{123}}`
    // is a legitimate variable name here, just an unusual one.
    expect(extractVariables('{name} {{ }} {{-bad-}} {{ok}}'))
      .toEqual(['ok'])
    expect(extractVariables('{{items.0.name}}'))
      .toEqual(['items.0.name'])
  })

  it('returns [] for null / undefined / empty', () => {
    expect(extractVariables(null)).toEqual([])
    expect(extractVariables(undefined)).toEqual([])
    expect(extractVariables('')).toEqual([])
  })
})

describe('extractAllVariables', () => {
  it('deduplicates across subject, html_body and text_body', () => {
    const set = extractAllVariables({
      subject: 'Verify {{code}}',
      html_body: '<p>Hi {{name}}, code {{code}}</p>',
      text_body: 'Hi {{name}}, code {{code}}. Support: {{support_email}}',
    })
    expect(new Set(set)).toEqual(new Set(['code', 'name', 'support_email']))
  })

  it('handles missing parts', () => {
    expect(extractAllVariables({ subject: null, html_body: '{{a}}', text_body: undefined }))
      .toEqual(['a'])
  })
})

describe('assertRequiredVariablesPresent', () => {
  it('is a no-op when every required variable is referenced', () => {
    expect(() => assertRequiredVariablesPresent(
      { subject: 'code {{code}}', html_body: 'hi {{name}}', text_body: null },
      ['code', 'name'],
    )).not.toThrow()
  })

  it('throws with a structured error listing every missing variable', () => {
    let caught
    try {
      assertRequiredVariablesPresent(
        { subject: 'hi', html_body: '{{code}}', text_body: null },
        ['code', 'name', 'agency'],
      )
    } catch (err) { caught = err }

    expect(caught).toBeDefined()
    expect(caught.code).toBe('TEMPLATE_MISSING_REQUIRED_VARIABLES')
    expect(caught.missing).toEqual(['name', 'agency'])
  })

  it('is a no-op when no required variables are declared', () => {
    expect(() => assertRequiredVariablesPresent({ subject: 'x', html_body: null, text_body: null }, []))
      .not.toThrow()
    expect(() => assertRequiredVariablesPresent({ subject: 'x', html_body: null, text_body: null }, null))
      .not.toThrow()
  })

  it('accepts a variable referenced in ANY part (subject, html or text)', () => {
    // Required variables live "in the template" as a whole, not per-part —
    // an admin who puts {{code}} in the subject is not missing it just
    // because the html_body does not repeat it.
    expect(() => assertRequiredVariablesPresent(
      { subject: '{{code}}', html_body: 'nothing here', text_body: null },
      ['code'],
    )).not.toThrow()
  })
})

describe('findUnknownVariables', () => {
  it('returns variables that are neither required nor optional', () => {
    const unknown = findUnknownVariables(
      { subject: '{{code}}', html_body: 'hi {{name}} at {{agency}} sent {{ts}}', text_body: null },
      ['code', 'name'],
      ['ts'],
    )
    expect(unknown).toEqual(['agency'])
  })

  it('returns [] when every referenced variable is known', () => {
    expect(findUnknownVariables(
      { subject: '{{code}}', html_body: null, text_body: null },
      ['code'],
    )).toEqual([])
  })
})

describe('renderText', () => {
  it('substitutes simple variables', () => {
    expect(renderText('Hello {{name}}!', { name: 'Ali' })).toBe('Hello Ali!')
  })

  it('resolves dotted paths', () => {
    expect(renderText('{{user.name}} at {{user.agency.name}}', {
      user: { name: 'Ali', agency: { name: 'Wingcaster' } },
    })).toBe('Ali at Wingcaster')
  })

  it('renders missing variables as empty string', () => {
    expect(renderText('code: {{code}}, unknown: {{who}}', { code: '123' }))
      .toBe('code: 123, unknown: ')
  })

  it('does NOT HTML-escape (text bodies are not HTML)', () => {
    expect(renderText('{{content}}', { content: '<b>hi</b>' })).toBe('<b>hi</b>')
  })

  it('coerces non-string values', () => {
    expect(renderText('{{count}} × {{ratio}}', { count: 3, ratio: 1.5 }))
      .toBe('3 × 1.5')
  })

  it('leaves null/undefined source alone', () => {
    expect(renderText(null, {})).toBe('')
    expect(renderText(undefined, {})).toBe('')
    expect(renderText('', {})).toBe('')
  })
})

describe('renderHtml', () => {
  it('HTML-escapes substituted values', () => {
    // THE THING THAT MATTERS: an admin who authored `Hi {{name}}`
    // cannot have their template become an XSS vector by a name value
    // of `<script>alert(1)</script>`.
    expect(renderHtml('Hi {{name}}!', { name: '<script>alert(1)</script>' }))
      .toBe('Hi &lt;script&gt;alert(1)&lt;/script&gt;!')
  })

  it('escapes every dangerous character', () => {
    expect(renderHtml('{{x}}', { x: `& < > " '` }))
      .toBe('&amp; &lt; &gt; &quot; &#39;')
  })

  it('does NOT escape the template markup itself', () => {
    // The admin wrote HTML on purpose. Only the interpolated VALUES
    // get escaped; the template's own tags render as-is.
    expect(renderHtml('<b>{{code}}</b>', { code: '<span>' }))
      .toBe('<b>&lt;span&gt;</b>')
  })

  it('handles missing values without escaping "undefined"', () => {
    expect(renderHtml('code: {{code}}', {})).toBe('code: ')
  })
})

describe('renderTemplate', () => {
  it('renders subject as text, html_body as html, text_body as text', () => {
    const out = renderTemplate({
      subject: 'Verify {{name}}',
      html_body: '<p>Hi {{name}}</p>',
      text_body: 'Hi {{name}}',
    }, { name: '<x>' })

    // subject and text_body: not escaped.
    expect(out.subject).toBe('Verify <x>')
    expect(out.text_body).toBe('Hi <x>')
    // html_body: escaped.
    expect(out.html_body).toBe('<p>Hi &lt;x&gt;</p>')
  })
})
