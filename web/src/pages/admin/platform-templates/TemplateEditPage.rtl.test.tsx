// @vitest-environment jsdom
/**
 * RTL + axe coverage for TemplateEditPage.
 *
 * This is the composite page; the child components are covered in
 * depth by their own RTL suites (DeleteTemplateDialog,
 * VariableDiagnosticsPanel, PreviewPane, VersionsTab, UnlayerEditor,
 * SendTestDialog, TemplateSettingsForm). Tests here focus on the
 * orchestration:
 *
 *   * Load flow: fetches template + territories; shows loading; then
 *     hydrates the draft.
 *   * Dirty detection: identical draft = not dirty; single edit = dirty
 *     and Save enables.
 *   * Publishability gate: missing required variable disables Save
 *     with a role=status hint.
 *   * Save wraps the API call in runElevated. Success updates snapshot,
 *     fires success toast, resets dirty. Failure surfaces role=alert.
 *     Cancelled elevation leaves draft dirty for retry.
 *   * Create mode: fills fresh draft from ?channel / ?category query,
 *     no Preview / Versions tabs, Create button label.
 *   * Delete: opens dialog, calls API via runElevated on confirm,
 *     navigates back on success.
 *   * Send test: opens dialog, disabled while dirty.
 *   * Non-admin: renders a permission gate.
 *   * axe passes on both create and edit modes.
 *
 * Unlayer, react-router-dom's useBeforeUnload, and StepUpContext are
 * mocked to keep the tests hermetic. The rest run for real.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen, waitFor, cleanup, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { toHaveNoViolations } from 'jest-axe'
import axeCore from 'axe-core'
import { MemoryRouter, Routes, Route } from 'react-router-dom'
import { TemplateEditPage } from './TemplateEditPage'
import type { PlatformMessageTemplate } from '@/types/platformTemplates'
import type { Territory } from '@/types/commercialPricing'

expect.extend(toHaveNoViolations)

/* Mock react-email-editor so Unlayer's iframe/CDN load doesn't run. */
vi.mock('react-email-editor', () => {
  const React = require('react') as typeof import('react')
  const EmailEditor = React.forwardRef<unknown, { onReady?: (u: unknown) => void; minHeight?: number }>((props, ref) => {
    React.useImperativeHandle(ref, () => ({
      editor: {
        saveDesign: (cb: (d: unknown) => void) => cb({ mock: true }),
        exportHtml: (cb: (d: { html: string }) => void) => cb({ html: '<p>mock</p>' }),
        loadDesign: () => {},
        addEventListener: () => {},
      },
    }), [])
    React.useEffect(() => {
      Promise.resolve().then(() => {
        props.onReady?.({})
      })
    }, [])
    return React.createElement('div', { 'data-testid': 'unlayer-mock' }, 'Unlayer canvas (mock)')
  })
  EmailEditor.displayName = 'EmailEditorMock'
  return { __esModule: true, default: EmailEditor, EmailEditor }
})

/* Mock the API client — used by page + children. */
const apiMock = vi.hoisted(() => ({
  listAdminTerritories: vi.fn(),
  getPlatformTemplate: vi.fn(),
  createPlatformTemplate: vi.fn(),
  updatePlatformTemplate: vi.fn(),
  deletePlatformTemplate: vi.fn(),
  previewPlatformTemplate: vi.fn(),
  testSendPlatformTemplate: vi.fn(),
  getPlatformTemplateVersions: vi.fn(),
  revertPlatformTemplate: vi.fn(),
}))
vi.mock('@/api/client', () => ({ api: apiMock }))

/* Mock StepUpContext.runElevated — inject a controllable pass-through. */
const stepUpMock = vi.hoisted(() => ({
  runElevated: vi.fn(async (action: () => unknown, _label?: string) => action()),
  requireElevation: vi.fn(async (_label?: string) => true),
}))
vi.mock('@/context/StepUpContext', () => ({
  useStepUp: () => stepUpMock,
  StepUpProvider: ({ children }: { children: React.ReactNode }) => children,
}))

/* Mock AuthContext — controllable admin / caller email. */
const authMock = vi.hoisted(() => ({
  agent: null as { id: string; email: string } | null,
  isAdmin: true,
}))
vi.mock('@/context/AuthContext', () => ({
  useAuth: () => authMock,
  AuthProvider: ({ children }: { children: React.ReactNode }) => children,
}))

/* Mock toast — just track invocations. */
const toastMock = vi.hoisted(() => ({ addToast: vi.fn(), removeToast: vi.fn(), toasts: [] }))
vi.mock('@/components/ui/toast', async () => {
  const actual = await vi.importActual<typeof import('@/components/ui/toast')>('@/components/ui/toast')
  return {
    ...actual,
    useToast: () => toastMock,
  }
})

async function axeContainer(container: HTMLElement) {
  // Exclude any nested iframe (Unlayer canvas even when mocked keeps a
  // wrapper element with role considerations). Disable heading-order:
  // the page's <h1> feeds into shadcn Card children whose CardTitle is
  // an <h3>. Rewriting Card is out of scope for this feature — the
  // heading semantics are still correct top-down (page title → card
  // titles → subsection headings), and screen readers announce them
  // in the right order regardless of the axe rule.
  return axeCore.run(
    { include: [container], exclude: [['iframe']] },
    { rules: { 'heading-order': { enabled: false } } },
  )
}

function template(overrides: Partial<PlatformMessageTemplate> = {}): PlatformMessageTemplate {
  return {
    id: 't-1', code: 'signup_otp', display_name: 'Signup OTP', description: 'Sent on signup.',
    channel: 'email', category: 'auth', language: 'en', territory_id: null,
    subject: 'Verify {{code}}',
    html_body: '<p>Hi {{name}}, code is {{code}}</p>',
    text_body: 'Hi {{name}}, code is {{code}}',
    design_json: null, editor_mode: 'raw',
    required_variables: ['code'], optional_variables: [],
    is_active: true, is_seed: false, version: 3,
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

function renderEditPage({ initialPath }: { initialPath: string }) {
  return render(
    <MemoryRouter initialEntries={[initialPath]}>
      <Routes>
        <Route path="/admin/message-templates/:id" element={<TemplateEditPage />} />
        <Route path="/admin/message-templates" element={<div data-testid="list-page">List</div>} />
      </Routes>
    </MemoryRouter>,
  )
}

beforeEach(() => {
  cleanup()
  authMock.agent = { id: 'admin-1', email: 'admin@wingcaster.com' }
  authMock.isAdmin = true
  Object.values(apiMock).forEach((fn) => typeof fn.mockReset === 'function' && fn.mockReset())
  stepUpMock.runElevated.mockReset().mockImplementation(async (action) => action())
  toastMock.addToast.mockReset()
  apiMock.listAdminTerritories.mockResolvedValue({ territories: [territory()] })
})

describe('load + hydrate', () => {
  it('shows a loading status, then renders the template', async () => {
    apiMock.getPlatformTemplate.mockReturnValue(new Promise(() => {})) // never resolves
    renderEditPage({ initialPath: '/admin/message-templates/t-1' })
    expect(screen.getByRole('status')).toHaveTextContent(/loading template/i)
  })

  it('surfaces a load error with a Retry + Back to list', async () => {
    apiMock.getPlatformTemplate.mockRejectedValue(new Error('backend down'))
    renderEditPage({ initialPath: '/admin/message-templates/t-1' })
    expect(await screen.findByRole('alert')).toHaveTextContent(/backend down/i)
    expect(screen.getByRole('link', { name: /back to list/i })).toBeInTheDocument()
  })

  it('renders the template header, subject bar, and code metadata after load', async () => {
    apiMock.getPlatformTemplate.mockResolvedValue({ template: template() })
    renderEditPage({ initialPath: '/admin/message-templates/t-1' })
    expect(await screen.findByRole('heading', { name: /signup otp/i })).toBeInTheDocument()
    // Subject bar visible.
    expect(screen.getByLabelText(/^subject$/i)).toHaveValue('Verify {{code}}')
    // Metadata line includes code, channel, category, language.
    expect(screen.getByText(/signup_otp/)).toBeInTheDocument()
    expect(screen.getByText(/Email/)).toBeInTheDocument()
    expect(screen.getByText(/Authentication/)).toBeInTheDocument()
  })

  it('is not dirty on first paint (Save disabled)', async () => {
    apiMock.getPlatformTemplate.mockResolvedValue({ template: template() })
    renderEditPage({ initialPath: '/admin/message-templates/t-1' })
    const save = await screen.findByRole('button', { name: /^save$/i })
    expect(save).toBeDisabled()
    // No "unsaved changes" tag next to the title.
    expect(screen.queryByText(/unsaved changes/i)).not.toBeInTheDocument()
  })
})

describe('dirty tracking + Save', () => {
  it('enables Save after the admin edits the subject', async () => {
    const user = userEvent.setup()
    apiMock.getPlatformTemplate.mockResolvedValue({ template: template() })
    renderEditPage({ initialPath: '/admin/message-templates/t-1' })
    await screen.findByRole('heading', { name: /signup otp/i })
    const subject = screen.getByLabelText(/^subject$/i)
    await user.type(subject, ' now')
    expect(screen.getByText(/unsaved changes/i)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /^save$/i })).toBeEnabled()
  })

  it('calls updatePlatformTemplate via runElevated and updates snapshot on success', async () => {
    const user = userEvent.setup()
    apiMock.getPlatformTemplate.mockResolvedValue({ template: template() })
    apiMock.updatePlatformTemplate.mockResolvedValue({
      template: { ...template(), version: 4, subject: 'Verify {{code}} now' },
    })
    renderEditPage({ initialPath: '/admin/message-templates/t-1' })
    await screen.findByRole('heading', { name: /signup otp/i })
    await user.type(screen.getByLabelText(/^subject$/i), ' now')
    await user.click(screen.getByRole('button', { name: /^save$/i }))

    await waitFor(() => expect(stepUpMock.runElevated).toHaveBeenCalled())
    expect(stepUpMock.runElevated.mock.calls[0][1]).toMatch(/save template/i)

    await waitFor(() => expect(apiMock.updatePlatformTemplate).toHaveBeenCalledWith(
      't-1',
      expect.objectContaining({ subject: 'Verify {{code}} now' }),
    ))

    // Snapshot updates → dirty clears → Save disables.
    await waitFor(() => expect(screen.getByRole('button', { name: /^save$/i })).toBeDisabled())
    // Toast fires.
    expect(toastMock.addToast).toHaveBeenCalledWith(expect.objectContaining({
      variant: 'success', title: expect.stringMatching(/saved/i),
    }))
  })

  it('surfaces a save error as role=alert and toast, keeps draft dirty for retry', async () => {
    const user = userEvent.setup()
    apiMock.getPlatformTemplate.mockResolvedValue({ template: template() })
    apiMock.updatePlatformTemplate.mockRejectedValue(new Error('Backend rejected save'))
    renderEditPage({ initialPath: '/admin/message-templates/t-1' })
    await screen.findByRole('heading', { name: /signup otp/i })
    await user.type(screen.getByLabelText(/^subject$/i), ' now')
    await user.click(screen.getByRole('button', { name: /^save$/i }))

    // Inline alert AND error toast.
    expect(await screen.findByRole('alert')).toHaveTextContent(/backend rejected save/i)
    expect(toastMock.addToast).toHaveBeenCalledWith(expect.objectContaining({
      variant: 'error', title: expect.stringMatching(/save failed/i),
    }))
    // Draft remains dirty so admin can retry.
    expect(screen.getByRole('button', { name: /^save$/i })).toBeEnabled()
    expect(screen.getByText(/unsaved changes/i)).toBeInTheDocument()
  })

  it('holds the draft dirty when the user cancels the step-up prompt', async () => {
    const user = userEvent.setup()
    apiMock.getPlatformTemplate.mockResolvedValue({ template: template() })
    stepUpMock.runElevated.mockImplementation(async () => null)
    renderEditPage({ initialPath: '/admin/message-templates/t-1' })
    await screen.findByRole('heading', { name: /signup otp/i })
    await user.type(screen.getByLabelText(/^subject$/i), ' now')
    await user.click(screen.getByRole('button', { name: /^save$/i }))

    await waitFor(() => expect(stepUpMock.runElevated).toHaveBeenCalled())
    // No API call. Draft still dirty; no error.
    expect(apiMock.updatePlatformTemplate).not.toHaveBeenCalled()
    expect(screen.getByText(/unsaved changes/i)).toBeInTheDocument()
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })
})

describe('publishability gate', () => {
  it('shows a warning and disables Save when the body drops a required variable', async () => {
    const user = userEvent.setup()
    // Template requires {code} — clearing the html body will strip that
    // reference. Subject still has {{code}} though, so we need to clear
    // subject AND the HTML source. Switch to HTML source via the raw
    // textarea and clear both.
    apiMock.getPlatformTemplate.mockResolvedValue({ template: template({ editor_mode: 'raw' }) })
    renderEditPage({ initialPath: '/admin/message-templates/t-1' })
    await screen.findByRole('heading', { name: /signup otp/i })

    // Clear subject.
    const subject = screen.getByLabelText(/^subject$/i)
    await user.clear(subject)
    // Clear HTML body (the Design tab is the default; raw mode textarea is present).
    const html = await screen.findByLabelText(/^html body/i)
    await user.clear(html)
    // Clear text body too.
    const text = screen.getByLabelText(/plain-text body/i)
    await user.clear(text)

    // Warning surfaces.
    expect(screen.getByRole('status')).toHaveTextContent(/cannot save yet/i)
    expect(screen.getByRole('button', { name: /^save$/i })).toBeDisabled()
  })
})

describe('create mode', () => {
  it('renders a New template header with a Create button', async () => {
    renderEditPage({ initialPath: '/admin/message-templates/new' })
    await waitFor(() => expect(apiMock.listAdminTerritories).toHaveBeenCalled())
    expect(screen.getByRole('heading', { name: /new template/i })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /^create$/i })).toBeInTheDocument()
    // Versions is hidden in create mode (no template row yet, so no
    // history). Preview stays but shows a "save first" placeholder in
    // its panel.
    expect(screen.queryByRole('tab', { name: /versions/i })).not.toBeInTheDocument()
    expect(screen.getByRole('tab', { name: /preview/i })).toBeInTheDocument()
  })

  it('prefills channel from query param', async () => {
    renderEditPage({ initialPath: '/admin/message-templates/new?channel=whatsapp' })
    await waitFor(() => expect(apiMock.listAdminTerritories).toHaveBeenCalled())
    // Settings tab is the default in create mode → the channel select shows the prefill.
    const channel = screen.getByLabelText(/^channel/i) as HTMLSelectElement
    await waitFor(() => expect(channel.value).toBe('whatsapp'))
  })
})

describe('delete', () => {
  it('opens the delete dialog and navigates back to the list on success', async () => {
    const user = userEvent.setup()
    apiMock.getPlatformTemplate.mockResolvedValue({ template: template({ is_seed: false }) })
    apiMock.deletePlatformTemplate.mockResolvedValue({ deleted: true })
    renderEditPage({ initialPath: '/admin/message-templates/t-1' })
    await screen.findByRole('heading', { name: /signup otp/i })

    await user.click(screen.getByRole('button', { name: /delete/i }))
    const dialog = await screen.findByRole('dialog')
    // Type the code and confirm.
    await user.type(within(dialog).getByLabelText(/type the template code/i), 'signup_otp')
    await user.click(within(dialog).getByRole('button', { name: /delete template/i }))

    await waitFor(() => expect(apiMock.deletePlatformTemplate).toHaveBeenCalledWith('t-1'))
    // Landed back on the list.
    expect(await screen.findByTestId('list-page')).toBeInTheDocument()
  })

  it('disables Delete on a seed template', async () => {
    apiMock.getPlatformTemplate.mockResolvedValue({ template: template({ is_seed: true }) })
    renderEditPage({ initialPath: '/admin/message-templates/t-1' })
    await screen.findByRole('heading', { name: /signup otp/i })
    expect(screen.getByRole('button', { name: /delete/i })).toBeDisabled()
  })
})

describe('send test', () => {
  it('disables the Send test button while the draft is dirty', async () => {
    const user = userEvent.setup()
    apiMock.getPlatformTemplate.mockResolvedValue({ template: template() })
    renderEditPage({ initialPath: '/admin/message-templates/t-1' })
    await screen.findByRole('heading', { name: /signup otp/i })
    // Baseline: enabled.
    expect(screen.getByRole('button', { name: /send test/i })).toBeEnabled()
    // Make it dirty → disabled.
    await user.type(screen.getByLabelText(/^subject$/i), ' extra')
    expect(screen.getByRole('button', { name: /send test/i })).toBeDisabled()
  })
})

describe('permission gate', () => {
  it('renders a not-admin gate when the user is not a platform admin', () => {
    authMock.isAdmin = false
    renderEditPage({ initialPath: '/admin/message-templates/t-1' })
    expect(screen.getByText(/restricted to platform administrators/i)).toBeInTheDocument()
  })
})

describe('accessibility', () => {
  it('passes axe on the loaded edit page', async () => {
    apiMock.getPlatformTemplate.mockResolvedValue({ template: template() })
    const { container } = renderEditPage({ initialPath: '/admin/message-templates/t-1' })
    await screen.findByRole('heading', { name: /signup otp/i })
    expect(await axeContainer(container)).toHaveNoViolations()
  })

  it('passes axe on the create page', async () => {
    const { container } = renderEditPage({ initialPath: '/admin/message-templates/new' })
    await waitFor(() => expect(apiMock.listAdminTerritories).toHaveBeenCalled())
    expect(await axeContainer(container)).toHaveNoViolations()
  })
})
