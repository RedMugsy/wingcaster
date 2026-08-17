// @vitest-environment jsdom
/**
 * RTL + axe coverage for SendTestDialog.
 *
 * Properties that matter:
 *   * Recipient is locked to the caller's own email — surfaces the
 *     backend's self-only rule up-front rather than after an API 403.
 *   * Non-email channels refuse to open the send flow (defensive: the
 *     parent already gates the button).
 *   * Variables form seeds from the template's declared vars +
 *     defaultPreviewVariables samples so the admin sees rendered
 *     output on the first send without typing.
 *   * Sending wraps the API call in runElevated when supplied; a null
 *     result (cancelled step-up) leaves the dialog interactive with
 *     no result and no busy indicator.
 *   * Success shows a role=status message naming the provider + message
 *     id, and re-locks the Send button so the admin doesn't accidentally
 *     spam themselves with the same test.
 *   * Failure shows a role=alert with the error code preserved.
 *   * axe passes on the interactive form state.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen, cleanup, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { toHaveNoViolations } from 'jest-axe'
import axeCore from 'axe-core'
import { SendTestDialog } from './SendTestDialog'
import type { PlatformMessageTemplate } from '@/types/platformTemplates'

expect.extend(toHaveNoViolations)

const apiMock = vi.hoisted(() => ({
  testSendPlatformTemplate: vi.fn(),
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
    html_body: '<p>Hi {{name}}, code {{code}}</p>',
    text_body: 'Hi {{name}}, code {{code}}',
    design_json: null, editor_mode: 'raw',
    required_variables: ['code', 'name'], optional_variables: [],
    is_active: true, is_seed: false, version: 1,
    created_at: '', updated_at: '', created_by: null, updated_by: null,
    ...overrides,
  }
}

beforeEach(() => {
  cleanup()
  apiMock.testSendPlatformTemplate.mockReset()
})

describe('layout', () => {
  it('locks the recipient input to the caller email', () => {
    render(
      <SendTestDialog
        template={template()}
        open
        onOpenChange={vi.fn()}
        callerEmail="admin@wingcaster.com"
      />,
    )
    const to = screen.getByLabelText(/deliver to/i)
    expect(to).toHaveValue('admin@wingcaster.com')
    expect(to).toBeDisabled()
    expect(screen.getByText(/refuses any other recipient/i)).toBeInTheDocument()
  })

  it('seeds variable inputs with the template samples', () => {
    render(
      <SendTestDialog
        template={template()}
        open
        onOpenChange={vi.fn()}
        callerEmail="admin@wingcaster.com"
      />,
    )
    expect(screen.getByLabelText('{{code}}')).toHaveValue('123456')
    expect(screen.getByLabelText('{{name}}')).toHaveValue('Ali Achkar')
  })

  it('refuses non-email channels with an alert', () => {
    render(
      <SendTestDialog
        template={template({ channel: 'whatsapp' })}
        open
        onOpenChange={vi.fn()}
        callerEmail="admin@wingcaster.com"
      />,
    )
    expect(screen.getByRole('alert')).toHaveTextContent(/only implemented for email/i)
    expect(screen.getByRole('button', { name: /send test/i })).toBeDisabled()
  })

  it('renders a placeholder body when no template is provided', () => {
    render(
      <SendTestDialog
        template={null}
        open
        onOpenChange={vi.fn()}
        callerEmail="admin@wingcaster.com"
      />,
    )
    expect(screen.getByText(/select a template first/i)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /send test/i })).toBeDisabled()
  })
})

describe('sending', () => {
  it('calls testSendPlatformTemplate with the template id, caller email, and variables', async () => {
    const user = userEvent.setup()
    apiMock.testSendPlatformTemplate.mockResolvedValue({
      sent: true, provider: 'graph', provider_message_id: 'g-abc',
    })
    render(
      <SendTestDialog
        template={template()}
        open
        onOpenChange={vi.fn()}
        callerEmail="admin@wingcaster.com"
      />,
    )
    // Change one variable so we can prove the map is threaded through.
    await user.clear(screen.getByLabelText('{{code}}'))
    await user.type(screen.getByLabelText('{{code}}'), '999000')

    await user.click(screen.getByRole('button', { name: /send test/i }))

    await waitFor(() => expect(apiMock.testSendPlatformTemplate).toHaveBeenCalledWith(
      't-1',
      'admin@wingcaster.com',
      expect.objectContaining({ code: '999000' }),
    ))
  })

  it('surfaces a success status naming the provider + message id', async () => {
    const user = userEvent.setup()
    apiMock.testSendPlatformTemplate.mockResolvedValue({
      sent: true, provider: 'graph', provider_message_id: 'g-abc',
    })
    render(
      <SendTestDialog
        template={template()}
        open
        onOpenChange={vi.fn()}
        callerEmail="admin@wingcaster.com"
      />,
    )
    await user.click(screen.getByRole('button', { name: /send test/i }))
    const status = await screen.findByRole('status')
    expect(status).toHaveTextContent(/graph/)
    expect(status).toHaveTextContent(/g-abc/)
    // Send button re-labels to "Sent" and is disabled to prevent re-fires.
    expect(screen.getByRole('button', { name: /sent/i })).toBeDisabled()
  })

  it('surfaces a failure as role=alert preserving the error code', async () => {
    const user = userEvent.setup()
    apiMock.testSendPlatformTemplate.mockRejectedValue(
      Object.assign(new Error('Graph tenant refused'), { code: 'TEST_SEND_UPSTREAM_ERROR' }),
    )
    render(
      <SendTestDialog
        template={template()}
        open
        onOpenChange={vi.fn()}
        callerEmail="admin@wingcaster.com"
      />,
    )
    await user.click(screen.getByRole('button', { name: /send test/i }))
    const alert = await screen.findByRole('alert')
    expect(alert).toHaveTextContent(/graph tenant refused/i)
    expect(alert).toHaveTextContent(/TEST_SEND_UPSTREAM_ERROR/)
    // Send button remains enabled so admin can retry once they fix the issue.
    expect(screen.getByRole('button', { name: /send test/i })).toBeEnabled()
  })

  it('wraps the API call in runElevated when supplied', async () => {
    const user = userEvent.setup()
    // Widen the return type so the mock matches the generic
    // `<T>(action: () => Promise<T>, ...) => Promise<T | null>` signature.
    const runElevated = vi.fn(async <T,>(action: () => Promise<T>, _label?: string): Promise<T | null> => action())
    apiMock.testSendPlatformTemplate.mockResolvedValue({
      sent: true, provider: 'graph', provider_message_id: null,
    })
    render(
      <SendTestDialog
        template={template()}
        open
        onOpenChange={vi.fn()}
        callerEmail="admin@wingcaster.com"
        runElevated={runElevated as never}
      />,
    )
    await user.click(screen.getByRole('button', { name: /send test/i }))
    await waitFor(() => expect(runElevated).toHaveBeenCalled())
    expect(runElevated.mock.calls[0][1]).toMatch(/test email/i)
  })

  it('closes silently when the user cancels the step-up (runElevated returns null)', async () => {
    const user = userEvent.setup()
    const runElevated = vi.fn(async () => null)
    render(
      <SendTestDialog
        template={template()}
        open
        onOpenChange={vi.fn()}
        callerEmail="admin@wingcaster.com"
        runElevated={runElevated as never}
      />,
    )
    await user.click(screen.getByRole('button', { name: /send test/i }))
    await waitFor(() => expect(runElevated).toHaveBeenCalled())
    // No status, no alert — just idle.
    expect(screen.queryByRole('status')).not.toBeInTheDocument()
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    // Send button re-enabled so the admin can try again.
    expect(screen.getByRole('button', { name: /send test/i })).toBeEnabled()
  })

  it('preserves the recipient case sent to the backend as the caller email (lowercase happens server-side)', async () => {
    // The backend lowercases both sides before comparing, so the dialog
    // can pass the caller email verbatim. Test that we do not
    // over-normalise on the client (in case the caller email has a
    // capital letter, we don't want to eagerly rewrite it).
    const user = userEvent.setup()
    apiMock.testSendPlatformTemplate.mockResolvedValue({
      sent: true, provider: 'graph', provider_message_id: null,
    })
    render(
      <SendTestDialog
        template={template()}
        open
        onOpenChange={vi.fn()}
        callerEmail="Admin@Wingcaster.COM"
      />,
    )
    await user.click(screen.getByRole('button', { name: /send test/i }))
    await waitFor(() => expect(apiMock.testSendPlatformTemplate).toHaveBeenCalledWith(
      't-1', 'Admin@Wingcaster.COM', expect.any(Object),
    ))
  })
})

describe('accessibility', () => {
  it('passes axe on the send form', async () => {
    const { container } = render(
      <SendTestDialog
        template={template()}
        open
        onOpenChange={vi.fn()}
        callerEmail="admin@wingcaster.com"
      />,
    )
    expect(await axeContainer(container)).toHaveNoViolations()
  })

  it('passes axe on the non-email refusal', async () => {
    const { container } = render(
      <SendTestDialog
        template={template({ channel: 'whatsapp' })}
        open
        onOpenChange={vi.fn()}
        callerEmail="admin@wingcaster.com"
      />,
    )
    expect(await axeContainer(container)).toHaveNoViolations()
  })
})
