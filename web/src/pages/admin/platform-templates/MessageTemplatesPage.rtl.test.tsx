// @vitest-environment jsdom
/**
 * RTL + axe coverage for MessageTemplatesPage (the list).
 *
 * Tests the properties admins depend on:
 *   * Loading / error / empty-page / empty-filter states each render
 *     the right role and copy.
 *   * Client-side filtering: search matches code / name / description;
 *     channel chip narrows; category chip narrows; multiple chips
 *     narrow together (AND across dimensions, OR within).
 *   * includeInactive re-fetches with includeInactive=true (the only
 *     filter that changes the backend response set).
 *   * "New template" link carries active single chips through as
 *     query params so the create page lands on the right filter.
 *   * Rows link to the edit page.
 *   * Seed vs Active/Inactive badges render correctly per row.
 *   * Non-admins get a permission gate.
 *   * axe passes on both the populated list and the empty-page state.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen, waitFor, cleanup, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { toHaveNoViolations } from 'jest-axe'
import axeCore from 'axe-core'
import { MemoryRouter } from 'react-router-dom'
import { MessageTemplatesPage } from './MessageTemplatesPage'
import type { PlatformMessageTemplate } from '@/types/platformTemplates'

expect.extend(toHaveNoViolations)

const apiMock = vi.hoisted(() => ({
  listPlatformTemplates: vi.fn(),
}))
vi.mock('@/api/client', () => ({ api: apiMock }))

const authMock = vi.hoisted(() => ({ agent: null as unknown, isAdmin: true }))
vi.mock('@/context/AuthContext', () => ({
  useAuth: () => authMock,
  AuthProvider: ({ children }: { children: React.ReactNode }) => children,
}))

async function axeContainer(container: HTMLElement) {
  return axeCore.run(
    { include: [container], exclude: [] },
    // Same heading-order allowance as TemplateEditPage — shadcn Card
    // uses h3 CardTitle.
    { rules: { 'heading-order': { enabled: false } } },
  )
}

function template(overrides: Partial<PlatformMessageTemplate> = {}): PlatformMessageTemplate {
  return {
    // Fixture defaults deliberately have NO description — tests set
    // per-row descriptions when they need one. A shared "Sent on signup"
    // default would pollute every search filter test.
    id: 't-1', code: 'signup_otp', display_name: 'Signup OTP', description: null,
    channel: 'email', category: 'auth', language: 'en', territory_id: null,
    subject: null, html_body: null, text_body: null,
    design_json: null, editor_mode: 'raw',
    required_variables: [], optional_variables: [],
    is_active: true, is_seed: true, version: 1,
    created_at: '', updated_at: '', created_by: null, updated_by: null,
    ...overrides,
  }
}

const SEED_ROWS: PlatformMessageTemplate[] = [
  template({ id: 't-1', code: 'signup_otp', display_name: 'Signup OTP', channel: 'email', category: 'auth', is_seed: true }),
  template({ id: 't-2', code: 'welcome', display_name: 'Welcome email', channel: 'email', category: 'onboarding', is_seed: true }),
  template({ id: 't-3', code: 'whatsapp_welcome', display_name: 'WhatsApp welcome', channel: 'whatsapp', category: 'onboarding', is_seed: true, description: 'First-tenant-message copy.' }),
]

const SEED_ROWS_WITH_INACTIVE: PlatformMessageTemplate[] = [
  ...SEED_ROWS,
  template({ id: 't-4', code: 'invoice_late', display_name: 'Invoice past due', channel: 'email', category: 'billing', is_seed: false, is_active: false }),
]

function renderPage() {
  return render(
    <MemoryRouter>
      <MessageTemplatesPage />
    </MemoryRouter>,
  )
}

beforeEach(() => {
  cleanup()
  authMock.isAdmin = true
  apiMock.listPlatformTemplates.mockReset()
})

describe('loading and error states', () => {
  it('shows a status while loading', () => {
    apiMock.listPlatformTemplates.mockReturnValue(new Promise(() => {}))
    renderPage()
    expect(screen.getByRole('status')).toHaveTextContent(/loading templates/i)
  })

  it('surfaces a load error with a Retry button that re-fetches', async () => {
    const user = userEvent.setup()
    apiMock.listPlatformTemplates
      .mockRejectedValueOnce(new Error('backend down'))
      .mockResolvedValueOnce({ templates: SEED_ROWS })
    renderPage()
    expect(await screen.findByRole('alert')).toHaveTextContent(/backend down/i)
    await user.click(screen.getByRole('button', { name: /retry/i }))
    // After retry, the table renders.
    expect(await screen.findByText('Signup OTP')).toBeInTheDocument()
  })
})

describe('populated list', () => {
  beforeEach(() => {
    apiMock.listPlatformTemplates.mockResolvedValue({ templates: SEED_ROWS })
  })

  it('renders every template with code, name, channel, category, and version', async () => {
    renderPage()
    await screen.findByText('Signup OTP')
    // SEED_ROWS has 3 templates; table renders 1 header + 3 data rows.
    expect(screen.getAllByRole('row')).toHaveLength(4)
    // Row content: display_name, code, channel, category, version.
    const row = screen.getByText('Signup OTP').closest('tr')!
    expect(within(row).getByText('signup_otp')).toBeInTheDocument()
    expect(within(row).getByText('Email')).toBeInTheDocument()
    expect(within(row).getByText('Authentication')).toBeInTheDocument()
    expect(within(row).getByText('v1')).toBeInTheDocument()
  })

  it('renders Seed badge for seed rows', async () => {
    renderPage()
    await screen.findByText('Signup OTP')
    const row = screen.getByText('Signup OTP').closest('tr')!
    expect(within(row).getByText(/seed/i)).toBeInTheDocument()
  })

  it('rows link to the edit page for that template id', async () => {
    renderPage()
    await screen.findByText('Signup OTP')
    const link = screen.getByRole('link', { name: /signup otp/i })
    expect(link).toHaveAttribute('href', '/admin/message-templates/t-1')
  })
})

describe('filtering', () => {
  beforeEach(() => {
    apiMock.listPlatformTemplates.mockResolvedValue({ templates: SEED_ROWS })
  })

  it('search matches code / name / description', async () => {
    const user = userEvent.setup()
    renderPage()
    await screen.findByText('Signup OTP')

    // "signup" matches by code.
    await user.type(screen.getByLabelText(/search templates/i), 'signup')
    expect(screen.getByText('Signup OTP')).toBeInTheDocument()
    expect(screen.queryByText('Welcome email')).not.toBeInTheDocument()

    // Clear and search by description.
    await user.clear(screen.getByLabelText(/search templates/i))
    await user.type(screen.getByLabelText(/search templates/i), 'first-tenant')
    expect(screen.getByText('WhatsApp welcome')).toBeInTheDocument()
    expect(screen.queryByText('Signup OTP')).not.toBeInTheDocument()
  })

  it('channel chip narrows the list; multiple channels are OR', async () => {
    const user = userEvent.setup()
    renderPage()
    await screen.findByText('Signup OTP')

    await user.click(screen.getByRole('button', { name: 'Email' }))
    // Two email rows (signup_otp, welcome — invoice_late is inactive).
    expect(screen.getByText('Signup OTP')).toBeInTheDocument()
    expect(screen.getByText('Welcome email')).toBeInTheDocument()
    expect(screen.queryByText('WhatsApp welcome')).not.toBeInTheDocument()

    // Adding WhatsApp broadens the OR set.
    await user.click(screen.getByRole('button', { name: 'WhatsApp' }))
    expect(screen.getByText('WhatsApp welcome')).toBeInTheDocument()
  })

  it('category and channel filters combine as AND across dimensions', async () => {
    const user = userEvent.setup()
    renderPage()
    await screen.findByText('Signup OTP')

    await user.click(screen.getByRole('button', { name: 'Email' }))
    await user.click(screen.getByRole('button', { name: 'Onboarding' }))
    // Only welcome email matches both.
    expect(screen.getByText('Welcome email')).toBeInTheDocument()
    expect(screen.queryByText('Signup OTP')).not.toBeInTheDocument()
    expect(screen.queryByText('WhatsApp welcome')).not.toBeInTheDocument()
  })

  it('empty-filter state offers Clear all filters', async () => {
    const user = userEvent.setup()
    renderPage()
    await screen.findByText('Signup OTP')

    await user.type(screen.getByLabelText(/search templates/i), 'xxxxxx')
    expect(screen.getByText(/no templates match/i)).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: /clear all filters/i }))
    expect(screen.getByText('Signup OTP')).toBeInTheDocument()
  })
})

describe('includeInactive', () => {
  it('re-fetches with includeInactive=true when the checkbox is ticked', async () => {
    const user = userEvent.setup()
    apiMock.listPlatformTemplates.mockResolvedValue({ templates: SEED_ROWS })
    renderPage()
    await screen.findByText('Signup OTP')
    // Initial call is includeInactive: false.
    expect(apiMock.listPlatformTemplates).toHaveBeenLastCalledWith({ includeInactive: false })

    await user.click(screen.getByLabelText(/include inactive/i))
    await waitFor(() => {
      expect(apiMock.listPlatformTemplates).toHaveBeenLastCalledWith({ includeInactive: true })
    })
  })

  it('surfaces an Inactive badge when inactive rows are in the result', async () => {
    // First load (includeInactive=false) returns only active rows.
    // The re-fetch after ticking the checkbox returns the with-inactive set.
    apiMock.listPlatformTemplates
      .mockResolvedValueOnce({ templates: SEED_ROWS })
      .mockResolvedValueOnce({ templates: SEED_ROWS_WITH_INACTIVE })
    const user = userEvent.setup()
    renderPage()
    await screen.findByText('Signup OTP')
    await user.click(screen.getByLabelText(/include inactive/i))
    await waitFor(() => expect(screen.getByText('Invoice past due')).toBeInTheDocument())
    const row = screen.getByText('Invoice past due').closest('tr')!
    expect(within(row).getByText(/inactive/i)).toBeInTheDocument()
  })
})

describe('New template link', () => {
  beforeEach(() => {
    apiMock.listPlatformTemplates.mockResolvedValue({ templates: SEED_ROWS })
  })

  it('links to /admin/message-templates/new by default', async () => {
    renderPage()
    await screen.findByText('Signup OTP')
    const link = screen.getByRole('link', { name: /new template/i })
    expect(link).toHaveAttribute('href', '/admin/message-templates/new')
  })

  it('carries a SINGLE channel filter through as ?channel=', async () => {
    const user = userEvent.setup()
    renderPage()
    await screen.findByText('Signup OTP')
    await user.click(screen.getByRole('button', { name: 'WhatsApp' }))
    const link = screen.getByRole('link', { name: /new template/i })
    expect(link).toHaveAttribute('href', '/admin/message-templates/new?channel=whatsapp')
  })

  it('does NOT carry the channel filter when multiple channels are selected', async () => {
    const user = userEvent.setup()
    renderPage()
    await screen.findByText('Signup OTP')
    await user.click(screen.getByRole('button', { name: 'Email' }))
    await user.click(screen.getByRole('button', { name: 'WhatsApp' }))
    const link = screen.getByRole('link', { name: /new template/i })
    // Multi-channel is ambiguous → no prefill.
    expect(link).toHaveAttribute('href', '/admin/message-templates/new')
  })
})

describe('empty page', () => {
  it('renders a seed suggestion when the database has zero templates', async () => {
    apiMock.listPlatformTemplates.mockResolvedValue({ templates: [] })
    renderPage()
    expect(await screen.findByText(/no platform templates yet/i)).toBeInTheDocument()
    // Points at the specific migration so an admin can check deploy logs.
    expect(screen.getByText(/migration 044/i)).toBeInTheDocument()
  })
})

describe('permission gate', () => {
  it('renders a gate when the user is not a platform admin', () => {
    authMock.isAdmin = false
    apiMock.listPlatformTemplates.mockResolvedValue({ templates: SEED_ROWS })
    renderPage()
    expect(screen.getByText(/restricted to platform administrators/i)).toBeInTheDocument()
    // API is not called.
    expect(apiMock.listPlatformTemplates).not.toHaveBeenCalled()
  })
})

describe('accessibility', () => {
  it('passes axe on the populated list', async () => {
    apiMock.listPlatformTemplates.mockResolvedValue({ templates: SEED_ROWS })
    const { container } = renderPage()
    await screen.findByText('Signup OTP')
    expect(await axeContainer(container)).toHaveNoViolations()
  })

  it('passes axe on the empty state', async () => {
    apiMock.listPlatformTemplates.mockResolvedValue({ templates: [] })
    const { container } = renderPage()
    await screen.findByText(/no platform templates yet/i)
    expect(await axeContainer(container)).toHaveNoViolations()
  })
})
