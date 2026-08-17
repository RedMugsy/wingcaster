// @vitest-environment jsdom
/**
 * RTL + axe coverage for PreviewPane.
 *
 * The properties that keep the pane trustworthy:
 *   * Uses the backend preview endpoint by default (server-side render
 *     is authoritative — the admin sees what the recipient will get).
 *   * Uses the client renderer when useServer=false (offline mode).
 *   * Renders the HTML in a sandbox="" iframe — the containment
 *     boundary for admin-authored templates. MUST stay in place.
 *   * Debounces preview requests so scrubbing variable inputs doesn't
 *     flood the server.
 *   * Surfaces a network error as role=alert without crashing.
 *   * Passes axe (excluding the sandboxed iframe — axe cannot
 *     introspect a sandbox="" frame; the iframe's static attributes
 *     are asserted directly).
 *
 * Real timers throughout — the debounce is short (250ms) and mixing
 * fake timers with async React + userEvent + axe reliably deadlocks.
 * Real timers keep the tests readable and behaviour identical to prod.
 */
import { describe, expect, it, vi, beforeEach } from 'vitest'
import { render, screen, waitFor, cleanup } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { toHaveNoViolations } from 'jest-axe'
import axeCore from 'axe-core'
import { PreviewPane } from './PreviewPane'
import type { PlatformMessageTemplate } from '@/types/platformTemplates'

expect.extend(toHaveNoViolations)

const apiMock = vi.hoisted(() => ({
  previewPlatformTemplate: vi.fn(),
}))
vi.mock('@/api/client', () => ({ api: apiMock }))

function template(overrides: Partial<PlatformMessageTemplate> = {}): PlatformMessageTemplate {
  return {
    id: 't-1', code: 'signup_otp', display_name: 'Signup OTP', description: null,
    channel: 'email', category: 'auth',
    language: 'en', territory_id: null,
    subject: 'Your code: {{code}}',
    html_body: '<p>Hi {{name}}, code is {{code}}</p>',
    text_body: 'Hi {{name}}, code is {{code}}',
    design_json: null, editor_mode: 'raw',
    required_variables: ['code', 'name'], optional_variables: [],
    is_active: true, is_seed: false, version: 1,
    created_at: '', updated_at: '', created_by: null, updated_by: null,
    ...overrides,
  }
}

function preview(overrides: Partial<{ subject: string; html_body: string; text_body: string }> = {}) {
  return {
    template_id: 't-1',
    rendered: {
      subject: 'Your code: 123456',
      html_body: '<p>Hi Ali Achkar, code is 123456</p>',
      text_body: 'Hi Ali Achkar, code is 123456',
      ...overrides,
    },
    all_variables: ['code', 'name'],
    unknown_variables: [],
    required_variables: ['code', 'name'],
    optional_variables: [],
  }
}

/**
 * Axe cannot introspect a sandbox="" iframe (postMessage across the
 * boundary fails with "Respondable target must be a frame in the
 * current window"). Exclude the iframe outright — its static attributes
 * (sandbox, title, aria-label) are asserted directly in other tests, so
 * accessible naming for it is covered.
 */
/**
 * Call axe-core directly (bypassing jest-axe's wrapper) so we can pass a
 * context object with `exclude` — the sandboxed iframe cannot be
 * introspected and would otherwise error the scan out. Return shape
 * matches jest-axe's contract so `toHaveNoViolations()` still applies.
 */
async function axeExcludingPreviewFrame(container: HTMLElement) {
  return axeCore.run({
    include: [container],
    exclude: [['iframe[title="Rendered HTML preview"]']],
  })
}

beforeEach(() => {
  cleanup()
  apiMock.previewPlatformTemplate.mockReset().mockResolvedValue(preview())
})

describe('server render (default)', () => {
  it('calls the backend preview endpoint with the seeded sample variables', async () => {
    render(<PreviewPane template={template()} />)
    await waitFor(() => expect(apiMock.previewPlatformTemplate).toHaveBeenCalled())

    expect(apiMock.previewPlatformTemplate).toHaveBeenCalledTimes(1)
    const [id, vars] = apiMock.previewPlatformTemplate.mock.calls[0]
    expect(id).toBe('t-1')
    // defaultPreviewVariables seeds code/name with sample values.
    expect(vars).toMatchObject({ code: '123456', name: 'Ali Achkar' })
  })

  it('renders the rendered subject in the Subject tab', async () => {
    const user = userEvent.setup()
    render(<PreviewPane template={template()} />)
    await waitFor(() => expect(apiMock.previewPlatformTemplate).toHaveBeenCalled())

    await user.click(screen.getByRole('tab', { name: /subject/i }))
    expect(await screen.findByText('Your code: 123456')).toBeInTheDocument()
  })

  it('renders the rendered plain text in the Plain text tab', async () => {
    const user = userEvent.setup()
    render(<PreviewPane template={template()} />)
    await waitFor(() => expect(apiMock.previewPlatformTemplate).toHaveBeenCalled())

    await user.click(screen.getByRole('tab', { name: /plain text/i }))
    expect(await screen.findByText(/Hi Ali Achkar, code is 123456/)).toBeInTheDocument()
  })

  it('renders the HTML preview inside a sandboxed iframe (sandbox="")', async () => {
    const { container } = render(<PreviewPane template={template()} />)
    await waitFor(() => expect(apiMock.previewPlatformTemplate).toHaveBeenCalled())

    const iframe = container.querySelector('iframe')
    expect(iframe).not.toBeNull()
    // sandbox="" is the strongest sandbox — no scripts, no forms, no
    // same-origin. Containment boundary for admin HTML; MUST stay in place.
    expect(iframe?.getAttribute('sandbox')).toBe('')
    expect(iframe?.getAttribute('title')).toBe('Rendered HTML preview')
  })

  it('debounces preview requests: many keystrokes collapse to one additional call', async () => {
    const user = userEvent.setup()
    render(<PreviewPane template={template()} />)
    await waitFor(() => expect(apiMock.previewPlatformTemplate).toHaveBeenCalledTimes(1))

    const input = screen.getByLabelText('{{code}}')
    // Six keystrokes in quick succession — must collapse to a single
    // additional request thanks to the pane's 250ms debounce.
    await user.clear(input)
    await user.type(input, '999999')

    // Wait past the debounce window plus a small margin.
    await new Promise((r) => setTimeout(r, 400))

    // Initial mount = 1 call, then one more after debounce.
    expect(apiMock.previewPlatformTemplate).toHaveBeenCalledTimes(2)
    const [, latestVars] = apiMock.previewPlatformTemplate.mock.calls[1]
    expect(latestVars.code).toBe('999999')
  })

  it('surfaces a network error as role=alert without crashing', async () => {
    apiMock.previewPlatformTemplate
      .mockReset()
      .mockRejectedValueOnce(new Error('backend down'))
      // Any follow-up debounces resolve OK so no unhandled rejection.
      .mockResolvedValue(preview())

    render(<PreviewPane template={template()} />)

    expect(await screen.findByRole('alert')).toHaveTextContent(/backend down/i)
  })

  it('uses the draft field when supplied instead of the template field', async () => {
    render(
      <PreviewPane
        template={template()}
        draft={{ subject: 'Draft subject {{code}}' }}
      />,
    )
    await waitFor(() => expect(apiMock.previewPlatformTemplate).toHaveBeenCalled())

    // Backend still gets called; sample variables from the merged
    // template drive the seed values.
    const [, vars] = apiMock.previewPlatformTemplate.mock.calls[0]
    expect(vars.code).toBe('123456')
  })
})

describe('client render (useServer=false)', () => {
  it('does not call the backend and renders substituted subject client-side', async () => {
    const user = userEvent.setup()
    render(<PreviewPane template={template()} useServer={false} />)

    await waitFor(() => {
      expect(screen.queryByText(/rendering/i)).not.toBeInTheDocument()
    }, { timeout: 2000 })

    // Wait a short interval past the debounce, then assert no network.
    await new Promise((r) => setTimeout(r, 400))
    expect(apiMock.previewPlatformTemplate).not.toHaveBeenCalled()

    await user.click(screen.getByRole('tab', { name: /subject/i }))
    expect(await screen.findByText(/Your code: 123456/)).toBeInTheDocument()
  })
})

describe('accessibility', () => {
  it('passes axe with a rendered preview (iframe traversal disabled)', async () => {
    const { container } = render(<PreviewPane template={template()} />)
    await waitFor(() => expect(apiMock.previewPlatformTemplate).toHaveBeenCalled())
    expect(await axeExcludingPreviewFrame(container)).toHaveNoViolations()
  })
})
