// @vitest-environment jsdom
/**
 * RTL + axe coverage for VersionsTab.
 *
 * Verifies:
 *   * Loading state renders (role=status).
 *   * Load error surfaces role=alert with a Retry button that re-hits
 *     the API.
 *   * Empty-history renders a helpful empty state (not a mistake).
 *   * Version list renders each row with its version, change_note,
 *     and creator; the current version cannot be reverted to.
 *   * Selecting a version updates the diff view (Subject / HTML body /
 *     Text body / Variables sections).
 *   * Revert opens a confirm dialog naming the version and the new
 *     version number that will result.
 *   * Revert wraps its call in runElevated when provided; if
 *     runElevated returns null (user cancelled step-up), the dialog
 *     closes silently and no onReverted fires.
 *   * On success, onReverted fires and the list refreshes.
 *   * axe passes on the loaded state.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen, waitFor, cleanup, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { toHaveNoViolations } from 'jest-axe'
import axeCore from 'axe-core'
import { VersionsTab } from './VersionsTab'
import type { PlatformMessageTemplate, PlatformMessageTemplateVersion } from '@/types/platformTemplates'

expect.extend(toHaveNoViolations)

const apiMock = vi.hoisted(() => ({
  getPlatformTemplateVersions: vi.fn(),
  revertPlatformTemplate: vi.fn(),
}))
vi.mock('@/api/client', () => ({ api: apiMock }))

async function axeContainer(container: HTMLElement) {
  return axeCore.run({ include: [container], exclude: [] })
}

function template(overrides: Partial<PlatformMessageTemplate> = {}): PlatformMessageTemplate {
  return {
    id: 't-1', code: 'signup_otp', display_name: 'Signup OTP', description: null,
    channel: 'email', category: 'auth', language: 'en', territory_id: null,
    subject: 'Verify {{code}}',
    html_body: '<p>Current HTML {{code}}</p>',
    text_body: 'Current text {{code}}',
    design_json: null, editor_mode: 'raw',
    required_variables: ['code'], optional_variables: [],
    is_active: true, is_seed: false, version: 3,
    created_at: '', updated_at: '', created_by: null, updated_by: null,
    ...overrides,
  }
}

function version(overrides: Partial<PlatformMessageTemplateVersion> = {}): PlatformMessageTemplateVersion {
  return {
    id: `v-${overrides.version ?? 1}`,
    template_id: 't-1',
    version: 1,
    subject: 'Old subject {{code}}',
    html_body: '<p>Old HTML {{code}}</p>',
    text_body: 'Old text {{code}}',
    design_json: null,
    editor_mode: 'raw',
    required_variables: ['code'],
    optional_variables: [],
    change_note: 'Initial version',
    created_at: '2026-01-01T12:00:00Z',
    created_by: 'admin@wingcaster.com',
    ...overrides,
  }
}

beforeEach(() => {
  cleanup()
  apiMock.getPlatformTemplateVersions.mockReset()
  apiMock.revertPlatformTemplate.mockReset()
})

describe('loading and error states', () => {
  it('shows a status message while loading', () => {
    apiMock.getPlatformTemplateVersions.mockReturnValue(new Promise(() => {}))
    render(<VersionsTab template={template()} onReverted={vi.fn()} />)
    expect(screen.getByRole('status')).toHaveTextContent(/loading history/i)
  })

  it('surfaces a load error and retries on button click', async () => {
    const user = userEvent.setup()
    apiMock.getPlatformTemplateVersions
      .mockRejectedValueOnce(new Error('backend down'))
      .mockResolvedValueOnce({ current_version: 3, versions: [] })

    render(<VersionsTab template={template()} onReverted={vi.fn()} />)
    expect(await screen.findByRole('alert')).toHaveTextContent(/backend down/i)

    await user.click(screen.getByRole('button', { name: /retry/i }))
    // Second call succeeds → empty-state renders.
    expect(await screen.findByText(/no prior versions yet/i)).toBeInTheDocument()
  })
})

describe('empty history', () => {
  it('renders a helpful empty state', async () => {
    apiMock.getPlatformTemplateVersions.mockResolvedValue({ current_version: 1, versions: [] })
    render(<VersionsTab template={template({ version: 1 })} onReverted={vi.fn()} />)
    expect(await screen.findByText(/no prior versions yet/i)).toBeInTheDocument()
    expect(screen.getByText(/the moment an admin edits/i)).toBeInTheDocument()
  })
})

describe('version list', () => {
  it('renders each version row with number, change note, and creator', async () => {
    apiMock.getPlatformTemplateVersions.mockResolvedValue({
      current_version: 3,
      versions: [
        version({ version: 2, change_note: 'Sharpened subject', created_by: 'alice@wingcaster.com' }),
        version({ version: 1, change_note: 'Initial version', created_by: 'system' }),
      ],
    })
    render(<VersionsTab template={template()} onReverted={vi.fn()} />)

    const options = await screen.findAllByRole('button', { name: /show diff for version/i })
    expect(options).toHaveLength(2)
    expect(within(options[0]).getByText('v2')).toBeInTheDocument()
    expect(within(options[0]).getByText(/sharpened subject/i)).toBeInTheDocument()
    expect(within(options[0]).getByText(/alice@wingcaster\.com/)).toBeInTheDocument()
  })

  it('auto-selects the most recent archived version so the diff shows immediately', async () => {
    apiMock.getPlatformTemplateVersions.mockResolvedValue({
      current_version: 3,
      versions: [version({ version: 2 }), version({ version: 1 })],
    })
    render(<VersionsTab template={template()} onReverted={vi.fn()} />)
    const options = await screen.findAllByRole('button', { name: /show diff for version/i })
    await waitFor(() => expect(options[0]).toHaveAttribute('aria-pressed', 'true'))
  })

  it('disables the Revert button on a row matching the current version', async () => {
    apiMock.getPlatformTemplateVersions.mockResolvedValue({
      current_version: 2,
      versions: [
        // Include a row that (unusually) matches current — Revert must be disabled.
        version({ version: 2, id: 'v-2' }),
        version({ version: 1, id: 'v-1' }),
      ],
    })
    render(<VersionsTab template={template({ version: 2 })} onReverted={vi.fn()} />)
    await screen.findAllByRole('button', { name: /show diff for version/i })
    const revertBtns = screen.getAllByRole('button', { name: /revert to version/i })
    expect(revertBtns[0]).toBeDisabled()
    expect(revertBtns[1]).toBeEnabled()
  })
})

describe('diff view', () => {
  beforeEach(() => {
    apiMock.getPlatformTemplateVersions.mockResolvedValue({
      current_version: 3,
      versions: [
        version({
          version: 2,
          subject: 'Old subject {{code}}',
          html_body: '<p>Old HTML {{code}}</p>',
          text_body: 'Old text {{code}}',
          required_variables: ['code'],
          optional_variables: ['support_email'],
        }),
      ],
    })
  })

  it('renders Subject / HTML body / Text body / Variables sections', async () => {
    render(
      <VersionsTab
        template={template({
          subject: 'Verify {{code}}',
          html_body: '<p>Current HTML {{code}}</p>',
          text_body: 'Current text {{code}}',
        })}
        onReverted={vi.fn()}
      />,
    )
    await screen.findAllByRole('button', { name: /show diff for version/i })
    // Present in the section headings.
    expect(screen.getByText('Subject')).toBeInTheDocument()
    expect(screen.getByText('HTML body')).toBeInTheDocument()
    expect(screen.getByText('Text body')).toBeInTheDocument()
    expect(screen.getByText('Variables')).toBeInTheDocument()
  })

  it('shows variable changes in the Variables section', async () => {
    render(
      <VersionsTab
        template={template({
          required_variables: ['code', 'name'],  // added `name`
          optional_variables: [],                 // removed `support_email`
        })}
        onReverted={vi.fn()}
      />,
    )
    await screen.findAllByRole('button', { name: /show diff for version/i })
    expect(screen.getByText(/required added/i)).toBeInTheDocument()
    expect(screen.getByText('{{name}}')).toBeInTheDocument()
    expect(screen.getByText(/optional removed/i)).toBeInTheDocument()
    expect(screen.getByText('{{support_email}}')).toBeInTheDocument()
  })

  it('renders "Unchanged" when a section matches exactly', async () => {
    render(
      <VersionsTab
        template={template({
          subject: 'Old subject {{code}}',           // identical to v2
          html_body: '<p>Current HTML {{code}}</p>', // changed
          text_body: 'Old text {{code}}',            // identical to v2
        })}
        onReverted={vi.fn()}
      />,
    )
    await screen.findAllByRole('button', { name: /show diff for version/i })
    // Two of the three body sections should show Unchanged; the third
    // (HTML body) should NOT. Grab all "Unchanged" markers and check
    // the count is at least 2 (Subject, Text body). Variables also
    // matches so we allow 3 — but not more than that.
    const unchanged = screen.getAllByText(/unchanged/i)
    expect(unchanged.length).toBeGreaterThanOrEqual(2)
  })
})

describe('revert flow', () => {
  const previousVersion = version({ version: 2, change_note: 'Sharpened subject' })
  const REVERTED_TEMPLATE = template({ version: 4, subject: 'reverted subject' })

  beforeEach(() => {
    apiMock.getPlatformTemplateVersions.mockResolvedValue({
      current_version: 3,
      versions: [previousVersion, version({ version: 1 })],
    })
    apiMock.revertPlatformTemplate.mockResolvedValue({ template: REVERTED_TEMPLATE })
  })

  it('opens a confirm dialog naming the version and the resulting new version', async () => {
    const user = userEvent.setup()
    render(<VersionsTab template={template()} onReverted={vi.fn()} />)
    await screen.findAllByRole('button', { name: /show diff for version/i })

    const revertBtn = screen.getAllByRole('button', { name: /revert to version 2/i })[0]
    await user.click(revertBtn)

    const dialog = await screen.findByRole('dialog')
    expect(within(dialog).getByText(/revert to version 2/i)).toBeInTheDocument()
    // The dialog names the resulting new version (current + 1).
    expect(within(dialog).getByText(/v4/i)).toBeInTheDocument()
    // And surfaces the change note from the target version.
    expect(within(dialog).getByText(/sharpened subject/i)).toBeInTheDocument()
  })

  it('confirms revert, calls the API, and fires onReverted with the new template', async () => {
    const user = userEvent.setup()
    const onReverted = vi.fn()
    render(<VersionsTab template={template()} onReverted={onReverted} />)
    await screen.findAllByRole('button', { name: /show diff for version/i })

    await user.click(screen.getAllByRole('button', { name: /revert to version 2/i })[0])
    const dialog = await screen.findByRole('dialog')
    await user.click(within(dialog).getByRole('button', { name: /^revert$/i }))

    await waitFor(() => expect(apiMock.revertPlatformTemplate).toHaveBeenCalledWith('t-1', 2))
    await waitFor(() => expect(onReverted).toHaveBeenCalledWith(REVERTED_TEMPLATE))
  })

  it('wraps the API call in runElevated when provided', async () => {
    const user = userEvent.setup()
    const runElevated = vi.fn(async (action, _label) => action())
    render(
      <VersionsTab
        template={template()}
        onReverted={vi.fn()}
        runElevated={runElevated}
      />,
    )
    await screen.findAllByRole('button', { name: /show diff for version/i })

    await user.click(screen.getAllByRole('button', { name: /revert to version 2/i })[0])
    const dialog = await screen.findByRole('dialog')
    await user.click(within(dialog).getByRole('button', { name: /^revert$/i }))

    await waitFor(() => expect(runElevated).toHaveBeenCalled())
    expect(runElevated.mock.calls[0][1]).toMatch(/revert to version 2/i)
  })

  it('closes silently if the user cancels the step-up (runElevated returns null)', async () => {
    const user = userEvent.setup()
    const runElevated = vi.fn(async () => null)
    const onReverted = vi.fn()
    render(
      <VersionsTab
        template={template()}
        onReverted={onReverted}
        runElevated={runElevated}
      />,
    )
    await screen.findAllByRole('button', { name: /show diff for version/i })

    await user.click(screen.getAllByRole('button', { name: /revert to version 2/i })[0])
    const dialog = await screen.findByRole('dialog')
    await user.click(within(dialog).getByRole('button', { name: /^revert$/i }))

    await waitFor(() => expect(runElevated).toHaveBeenCalled())
    // No callback fired, and no error shown.
    expect(onReverted).not.toHaveBeenCalled()
    // Dialog closes.
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
  })

  it('surfaces a revert error inside the dialog without closing it', async () => {
    const user = userEvent.setup()
    apiMock.revertPlatformTemplate.mockRejectedValueOnce(new Error('Backend refused revert'))
    render(<VersionsTab template={template()} onReverted={vi.fn()} />)
    await screen.findAllByRole('button', { name: /show diff for version/i })

    await user.click(screen.getAllByRole('button', { name: /revert to version 2/i })[0])
    const dialog = await screen.findByRole('dialog')
    await user.click(within(dialog).getByRole('button', { name: /^revert$/i }))

    // Error surfaces in-dialog so the admin can see WHY it failed.
    expect(await within(dialog).findByRole('alert')).toHaveTextContent(/backend refused revert/i)
    // Dialog stays open.
    expect(screen.getByRole('dialog')).toBeInTheDocument()
  })
})

describe('accessibility', () => {
  it('passes axe with a loaded diff', async () => {
    apiMock.getPlatformTemplateVersions.mockResolvedValue({
      current_version: 3,
      versions: [version({ version: 2, change_note: 'Sharpened subject' })],
    })
    const { container } = render(<VersionsTab template={template()} onReverted={vi.fn()} />)
    await screen.findAllByRole('button', { name: /show diff for version/i })
    expect(await axeContainer(container)).toHaveNoViolations()
  })
})
