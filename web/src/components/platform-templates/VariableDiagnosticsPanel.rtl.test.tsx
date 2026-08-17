// @vitest-environment jsdom
/**
 * RTL + axe coverage for VariableDiagnosticsPanel.
 *
 * The panel is the admin's answer to "why can't I save this template?" and
 * "what's this weird placeholder in the rendered output?". Tests assert:
 *
 *   * A healthy template renders a green status summary and no blockers.
 *   * A template missing a required variable renders a role=alert summary
 *     naming the count, and lists the missing variable name(s) as
 *     `{{name}}` chips.
 *   * A template with an unknown-referenced variable renders a warning
 *     summary (role=status, amber) and lists the unknown chips.
 *   * Empty sections show a helpful "none" line rather than disappearing.
 *   * axe passes on the loud (blocked) variant — the state most likely
 *     to trip screen-reader compatibility bugs.
 */
import { beforeEach, describe, expect, it } from 'vitest'
import { render, screen, cleanup, within } from '@testing-library/react'
import { axe, toHaveNoViolations } from 'jest-axe'
import { VariableDiagnosticsPanel } from './VariableDiagnosticsPanel'

expect.extend(toHaveNoViolations)

beforeEach(() => cleanup())

const HEALTHY = {
  subject: 'Verify {{code}}',
  html_body: '<p>Hello {{name}}, code is {{code}}</p>',
  text_body: 'Hello {{name}}',
  required_variables: ['code', 'name'],
  optional_variables: ['support_email'],
}

describe('healthy template', () => {
  it('renders a positive status summary and no blockers', () => {
    render(<VariableDiagnosticsPanel template={HEALTHY} />)
    const status = screen.getByRole('status')
    expect(status).toHaveTextContent(/publishable/i)
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })

  it('lists required variables in the Required — present section', () => {
    render(<VariableDiagnosticsPanel template={HEALTHY} />)
    const present = screen.getByRole('region', { name: /required — present/i })
    expect(within(present).getByText('{{code}}')).toBeInTheDocument()
    expect(within(present).getByText('{{name}}')).toBeInTheDocument()
  })

  it('shows optional variables in the Optional — not used section when not referenced', () => {
    render(<VariableDiagnosticsPanel template={HEALTHY} />)
    const notUsed = screen.getByRole('region', { name: /optional — not used/i })
    expect(within(notUsed).getByText('{{support_email}}')).toBeInTheDocument()
  })

  it('renders empty-state text in sections with no items', () => {
    render(<VariableDiagnosticsPanel template={HEALTHY} />)
    const missing = screen.getByRole('region', { name: /required — missing/i })
    expect(within(missing).getByText(/none missing/i)).toBeInTheDocument()
  })

  it('passes axe', async () => {
    const { container } = render(<VariableDiagnosticsPanel template={HEALTHY} />)
    expect(await axe(container)).toHaveNoViolations()
  })
})

describe('template with a missing required variable', () => {
  const BROKEN = {
    subject: 'Hi',
    html_body: '<p>Just a message.</p>',
    text_body: null,
    required_variables: ['code'],
    optional_variables: [],
  }

  it('renders a role=alert summary that names the count', () => {
    render(<VariableDiagnosticsPanel template={BROKEN} />)
    const alert = screen.getByRole('alert')
    expect(alert).toHaveTextContent(/cannot save/i)
    expect(alert).toHaveTextContent(/1 required variable/i)
  })

  it('lists the missing name in the Required — missing section', () => {
    render(<VariableDiagnosticsPanel template={BROKEN} />)
    const missing = screen.getByRole('region', { name: /required — missing/i })
    expect(within(missing).getByText('{{code}}')).toBeInTheDocument()
  })

  it('passes axe in the loud state', async () => {
    const { container } = render(<VariableDiagnosticsPanel template={BROKEN} />)
    expect(await axe(container)).toHaveNoViolations()
  })
})

describe('template with an unknown-referenced variable', () => {
  const UNKNOWN = {
    subject: '{{code}}',
    html_body: '<p>Hi {{mystery_field}}</p>',
    text_body: null,
    required_variables: ['code'],
    optional_variables: [],
  }

  it('renders a warning summary — not an alert', () => {
    render(<VariableDiagnosticsPanel template={UNKNOWN} />)
    const status = screen.getByRole('status')
    expect(status).toHaveTextContent(/unknown variable/i)
    expect(status).toHaveTextContent(/will render blank/i)
    // Warning is a status, not an alert — this differentiation matters
    // for screen readers.
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })

  it('lists the unknown variable in the Referenced — not declared section', () => {
    render(<VariableDiagnosticsPanel template={UNKNOWN} />)
    const unknown = screen.getByRole('region', { name: /referenced — not declared/i })
    expect(within(unknown).getByText('{{mystery_field}}')).toBeInTheDocument()
  })

  it('pluralises the summary correctly for multiple unknowns', () => {
    render(<VariableDiagnosticsPanel template={{
      ...UNKNOWN,
      html_body: '<p>{{mystery_field}} {{another_one}}</p>',
    }} />)
    expect(screen.getByRole('status')).toHaveTextContent(/2 unknown variables/i)
  })

  it('pluralises correctly for a single unknown', () => {
    render(<VariableDiagnosticsPanel template={UNKNOWN} />)
    // Not "1 unknown variables" — must be "1 unknown variable".
    expect(screen.getByRole('status')).toHaveTextContent(/1 unknown variable /i)
  })
})

describe('empty template', () => {
  it('handles a template with no fields and no declared variables', () => {
    render(<VariableDiagnosticsPanel template={{}} />)
    // Empty template has no required missing → shows publishable status.
    expect(screen.getByRole('status')).toHaveTextContent(/publishable/i)
    // Every section shows its empty text.
    expect(screen.getAllByText(/none/i).length).toBeGreaterThan(0)
  })
})
