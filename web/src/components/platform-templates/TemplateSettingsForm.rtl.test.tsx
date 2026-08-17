// @vitest-environment jsdom
/**
 * RTL + axe coverage for TemplateSettingsForm.
 *
 * The form is CONTROLLED — the parent owns state and save. Tests focus
 * on the properties that keep the surface trustworthy:
 *
 *   * Code is immutable in edit mode (backend enforces this too).
 *   * Seed templates lock every classification field the resolver
 *     depends on, but leave the copy fields (name, description, active,
 *     variables) editable.
 *   * Field-level validation surfaces inline errors and blocks bad
 *     saves at the source (invalid code, duplicate variables,
 *     required∩optional overlap).
 *   * Chip editor adds on Enter and comma, removes on Backspace when
 *     empty (matches GitHub / Notion muscle memory), and rejects
 *     malformed variable names.
 *   * axe passes on both create and edit shapes.
 */
import { useState } from 'react'
import { beforeEach, describe, expect, it } from 'vitest'
import { render, screen, cleanup, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { toHaveNoViolations } from 'jest-axe'
import axeCore from 'axe-core'
import {
  TemplateSettingsForm,
  draftFromTemplate,
  validateSettings,
  type TemplateSettingsDraft,
} from './TemplateSettingsForm'
import type { PlatformMessageTemplate } from '@/types/platformTemplates'
import type { Territory } from '@/types/commercialPricing'

expect.extend(toHaveNoViolations)

async function axeContainer(container: HTMLElement) {
  return axeCore.run({ include: [container], exclude: [] })
}

function template(overrides: Partial<PlatformMessageTemplate> = {}): PlatformMessageTemplate {
  return {
    id: 't-1', code: 'signup_otp', display_name: 'Signup OTP', description: null,
    channel: 'email', category: 'auth',
    language: 'en', territory_id: null,
    subject: 'Your code: {{code}}', html_body: null, text_body: null,
    design_json: null, editor_mode: 'raw',
    required_variables: ['code'], optional_variables: [],
    is_active: true, is_seed: false, version: 1,
    created_at: '', updated_at: '', created_by: null, updated_by: null,
    ...overrides,
  }
}

function territory(overrides: Partial<Territory> = {}): Territory {
  return {
    id: 't-lb', code: 'LB', name: 'Lebanon', currency: 'USD',
    pricing_multiplier: 1, launch_status: 'launched', launch_wave: null,
    data_residency_required: false, billing_mode: 'card', vat_percent: 0,
    regulator_id_type: null, default_zone_id: null,
    payment_gateway_primary: null, payment_gateway_secondary: null,
    sort_order: 0, active: true, created_at: '', updated_at: '',
    ...overrides,
  }
}

/**
 * Controlled harness — captures onChange patches so a single "type X in
 * field Y → assert onChange called with { Y: X }" test is trivial, and
 * multi-step scenarios can inspect the accumulated draft.
 */
function Harness({
  initial,
  mode,
  isSeed = false,
  territories = [],
}: {
  initial: TemplateSettingsDraft
  mode: 'create' | 'edit'
  isSeed?: boolean
  territories?: Territory[]
}) {
  const [draft, setDraft] = useState<TemplateSettingsDraft>(initial)
  return (
    <TemplateSettingsForm
      mode={mode}
      value={draft}
      onChange={(patch) => setDraft((prev) => ({ ...prev, ...patch }))}
      territories={territories}
      isSeed={isSeed}
    />
  )
}

beforeEach(() => cleanup())

describe('validateSettings', () => {
  const base = draftFromTemplate(template())

  it('accepts a well-formed draft', () => {
    expect(validateSettings(base, 'create')).toEqual({})
    expect(validateSettings(base, 'edit')).toEqual({})
  })

  it('requires a code on create only', () => {
    expect(validateSettings({ ...base, code: '' }, 'create')).toMatchObject({ code: expect.any(String) })
    // On edit the code is immutable, so validation doesn't require it.
    expect(validateSettings({ ...base, code: '' }, 'edit')).not.toHaveProperty('code')
  })

  it('rejects a code that is not lowercase snake_case', () => {
    expect(validateSettings({ ...base, code: 'SignupOTP' }, 'create')).toHaveProperty('code')
    expect(validateSettings({ ...base, code: '1signup' }, 'create')).toHaveProperty('code')
    expect(validateSettings({ ...base, code: 'signup otp' }, 'create')).toHaveProperty('code')
    expect(validateSettings({ ...base, code: 'signup-otp' }, 'create')).toHaveProperty('code')
    expect(validateSettings({ ...base, code: 'signup_otp' }, 'create')).not.toHaveProperty('code')
  })

  it('requires a display name', () => {
    expect(validateSettings({ ...base, display_name: '' }, 'create')).toHaveProperty('display_name')
    expect(validateSettings({ ...base, display_name: '   ' }, 'create')).toHaveProperty('display_name')
  })

  it('caps display name at 200 characters', () => {
    expect(validateSettings({ ...base, display_name: 'x'.repeat(201) }, 'create')).toHaveProperty('display_name')
  })

  it('caps description at 1000 characters', () => {
    expect(validateSettings({ ...base, description: 'x'.repeat(1001) }, 'create')).toHaveProperty('description')
  })

  it('flags duplicate variables', () => {
    const dupe = { ...base, required_variables: ['code', 'code'] }
    expect(validateSettings(dupe, 'create').variables).toMatch(/duplicate/i)
  })

  it('flags required∩optional overlap', () => {
    const overlap = { ...base, required_variables: ['code', 'name'], optional_variables: ['name'] }
    expect(validateSettings(overlap, 'create').variables).toMatch(/cannot be both/i)
  })
})

describe('create mode', () => {
  it('renders the code field editable and prompts for lowercase snake_case', () => {
    render(<Harness initial={draftFromTemplate(null)} mode="create" />)
    const code = screen.getByLabelText(/template code/i)
    expect(code).not.toBeDisabled()
    expect(code).toHaveAttribute('placeholder', 'signup_otp')
    expect(screen.getByText(/lowercase snake_case/i)).toBeInTheDocument()
  })

  it('surfaces the code validation error inline', async () => {
    const user = userEvent.setup()
    render(<Harness initial={draftFromTemplate(null)} mode="create" />)
    const code = screen.getByLabelText(/template code/i)
    await user.type(code, 'BadCode')
    // Inline error under the field explains why.
    expect(screen.getByText(/lowercase letters, digits, and underscores/i)).toBeInTheDocument()
    expect(code).toHaveAttribute('aria-invalid', 'true')
  })

  it('accepts a valid code and clears the error', async () => {
    const user = userEvent.setup()
    render(<Harness initial={draftFromTemplate(null)} mode="create" />)
    const code = screen.getByLabelText(/template code/i)
    await user.type(code, 'welcome_email')
    expect(code).toHaveAttribute('aria-invalid', 'false')
    expect(screen.queryByText(/lowercase letters, digits/i)).not.toBeInTheDocument()
  })

  it('shows all channel options', () => {
    render(<Harness initial={draftFromTemplate(null)} mode="create" />)
    const channel = screen.getByLabelText(/^channel/i)
    expect(channel).not.toBeDisabled()
    const opts = within(channel as HTMLSelectElement).getAllByRole('option')
    expect(opts.map((o) => o.textContent)).toEqual(['Email', 'WhatsApp', 'SMS'])
  })

  it('exposes territory options by name and code', () => {
    render(
      <Harness
        initial={draftFromTemplate(null)}
        mode="create"
        territories={[territory({ id: 't-lb', code: 'LB', name: 'Lebanon' }), territory({ id: 't-sa', code: 'SA', name: 'Saudi Arabia' })]}
      />,
    )
    const terr = screen.getByLabelText(/territory/i)
    const opts = within(terr as HTMLSelectElement).getAllByRole('option')
    expect(opts[0].textContent).toMatch(/global default/i)
    expect(opts.map((o) => o.textContent).join('|')).toMatch(/Lebanon.*LB/)
    expect(opts.map((o) => o.textContent).join('|')).toMatch(/Saudi Arabia.*SA/)
  })
})

describe('edit mode', () => {
  it('locks the code field and shows the immutability hint', () => {
    render(<Harness initial={draftFromTemplate(template())} mode="edit" />)
    const code = screen.getByLabelText(/template code/i)
    expect(code).toBeDisabled()
    expect(screen.getByText(/immutable after create/i)).toBeInTheDocument()
  })

  it('locks the channel field and shows the immutability hint', () => {
    render(<Harness initial={draftFromTemplate(template())} mode="edit" />)
    expect(screen.getByLabelText(/^channel/i)).toBeDisabled()
    expect(screen.getByText(/channel is immutable/i)).toBeInTheDocument()
  })

  it('keeps display name and description editable', async () => {
    const user = userEvent.setup()
    render(<Harness initial={draftFromTemplate(template())} mode="edit" />)
    const name = screen.getByLabelText(/display name/i)
    await user.clear(name)
    await user.type(name, 'Signup verification code')
    expect(name).toHaveValue('Signup verification code')
  })
})

describe('seed template', () => {
  it('shows the seed notice and locks classification fields', () => {
    render(<Harness initial={draftFromTemplate(template({ is_seed: true }))} mode="edit" isSeed />)
    // Notice is a status role so screen readers announce it non-urgently.
    const notice = screen.getByRole('status')
    expect(notice).toHaveTextContent(/seed/i)
    // Classification is locked.
    expect(screen.getByLabelText(/category/i)).toBeDisabled()
    expect(screen.getByLabelText(/^language/i)).toBeDisabled()
    expect(screen.getByLabelText(/territory/i)).toBeDisabled()
  })

  it('keeps display name, description, active toggle, and variables editable on a seed', async () => {
    const user = userEvent.setup()
    render(<Harness initial={draftFromTemplate(template({ is_seed: true }))} mode="edit" isSeed />)
    expect(screen.getByLabelText(/display name/i)).not.toBeDisabled()
    expect(screen.getByLabelText(/description/i)).not.toBeDisabled()
    expect(screen.getByLabelText(/^active/i)).not.toBeDisabled()
    // Chip editors are always editable — variables ARE the copy contract.
    // Two exist (required + optional); scope to Required by test id.
    const requiredEditor = screen.getByTestId('variable-editor-required')
    const input = within(requiredEditor).getByPlaceholderText(/add a variable/i)
    await user.type(input, 'signup_link{enter}')
    expect(within(requiredEditor).getByText('{{signup_link}}')).toBeInTheDocument()
  })
})

describe('variable chip editor', () => {
  const initial = draftFromTemplate(template({ required_variables: [], optional_variables: [] }))

  it('commits a variable on Enter and clears the input', async () => {
    const user = userEvent.setup()
    render(<Harness initial={initial} mode="edit" />)
    // Find the "Required variables" input specifically by scoping to its section.
    const requiredEditor = screen.getByTestId('variable-editor-required')
    const input = within(requiredEditor).getByPlaceholderText(/add a variable/i)
    await user.type(input, 'code{enter}')
    expect(within(requiredEditor).getByText('{{code}}')).toBeInTheDocument()
    expect(input).toHaveValue('')
  })

  it('commits on comma too', async () => {
    const user = userEvent.setup()
    render(<Harness initial={initial} mode="edit" />)
    const requiredEditor = screen.getByTestId('variable-editor-required')
    const input = within(requiredEditor).getByPlaceholderText(/add a variable/i)
    await user.type(input, 'first,second,')
    expect(within(requiredEditor).getByText('{{first}}')).toBeInTheDocument()
    expect(within(requiredEditor).getByText('{{second}}')).toBeInTheDocument()
  })

  it('removes the last chip on empty Backspace', async () => {
    const user = userEvent.setup()
    render(
      <Harness
        initial={{ ...initial, required_variables: ['first', 'second'] }}
        mode="edit"
      />,
    )
    const requiredEditor = screen.getByTestId('variable-editor-required')
    const input = within(requiredEditor).getByPlaceholderText(/add a variable/i)
    await user.click(input)
    await user.keyboard('{Backspace}')
    // Last chip ({{second}}) is gone; {{first}} remains.
    expect(within(requiredEditor).queryByText('{{second}}')).not.toBeInTheDocument()
    expect(within(requiredEditor).getByText('{{first}}')).toBeInTheDocument()
  })

  it('rejects a variable name with invalid characters', async () => {
    const user = userEvent.setup()
    render(<Harness initial={initial} mode="edit" />)
    const requiredEditor = screen.getByTestId('variable-editor-required')
    const input = within(requiredEditor).getByPlaceholderText(/add a variable/i)
    await user.type(input, 'bad name{enter}')
    // The chip should NOT appear; an inline error surfaces instead.
    expect(within(requiredEditor).queryByText('{{bad name}}')).not.toBeInTheDocument()
    expect(within(requiredEditor).getByRole('alert')).toHaveTextContent(/invalid variable name/i)
  })

  it('rejects a duplicate within the same list', async () => {
    const user = userEvent.setup()
    render(
      <Harness initial={{ ...initial, required_variables: ['code'] }} mode="edit" />,
    )
    const requiredEditor = screen.getByTestId('variable-editor-required')
    const input = within(requiredEditor).getByPlaceholderText(/add a variable/i)
    await user.type(input, 'code{enter}')
    expect(within(requiredEditor).getByRole('alert')).toHaveTextContent(/already in the list/i)
  })

  it('removes a chip when the X button is clicked', async () => {
    const user = userEvent.setup()
    render(
      <Harness initial={{ ...initial, required_variables: ['code', 'name'] }} mode="edit" />,
    )
    const requiredEditor = screen.getByTestId('variable-editor-required')
    await user.click(within(requiredEditor).getByLabelText('Remove code'))
    expect(within(requiredEditor).queryByText('{{code}}')).not.toBeInTheDocument()
    expect(within(requiredEditor).getByText('{{name}}')).toBeInTheDocument()
  })
})

describe('language custom code', () => {
  it('reveals a custom-input field when Other is selected', async () => {
    const user = userEvent.setup()
    render(<Harness initial={draftFromTemplate(null)} mode="create" />)
    const language = screen.getByLabelText(/^language/i)
    await user.selectOptions(language, '__other__')
    const custom = await screen.findByLabelText(/custom language code/i)
    await user.type(custom, 'ja')
    expect(custom).toHaveValue('ja')
  })
})

describe('accessibility', () => {
  it('passes axe on a healthy create form', async () => {
    const { container } = render(<Harness initial={draftFromTemplate(null)} mode="create" />)
    expect(await axeContainer(container)).toHaveNoViolations()
  })

  it('passes axe on an edit form with seed lock and required-variable chips', async () => {
    const { container } = render(
      <Harness
        initial={draftFromTemplate(template({ is_seed: true, required_variables: ['code', 'name'] }))}
        mode="edit"
        isSeed
        territories={[territory()]}
      />,
    )
    expect(await axeContainer(container)).toHaveNoViolations()
  })
})
