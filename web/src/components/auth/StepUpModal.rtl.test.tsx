// @vitest-environment jsdom
/**
 * RTL coverage for the Phase 7f/2 step-up modal.
 *
 * The contract that matters: on open it asks the server for a challenge, and
 * on success it stores the elevation token separately from the session before
 * telling the caller to retry.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { axe, toHaveNoViolations } from 'jest-axe'

expect.extend(toHaveNoViolations)

const apiMock = vi.hoisted(() => ({
  stepUp: vi.fn(),
  stepUpVerify: vi.fn(),
}))
const tokenMock = vi.hoisted(() => ({ setElevatedToken: vi.fn() }))
vi.mock('@/api/client', () => ({ api: apiMock, setElevatedToken: tokenMock.setElevatedToken }))

import { StepUpModal } from './StepUpModal'

const TOTP_CHALLENGE = { challenge_id: 'ch-1', method: 'totp' as const, expires_at: '2026-08-16T00:10:00.000Z' }
const EMAIL_CHALLENGE = { challenge_id: 'ch-2', method: 'email' as const, expires_at: '2026-08-16T00:10:00.000Z' }

beforeEach(() => {
  vi.clearAllMocks()
  apiMock.stepUp.mockResolvedValue(TOTP_CHALLENGE)
  apiMock.stepUpVerify.mockResolvedValue({
    elevated_token: 'elevated-jwt',
    expires_in: 900,
    expires_at: '2026-08-16T00:15:00.000Z',
    factor_used: 'totp',
  })
})

describe('StepUpModal', () => {
  it('renders nothing until opened, and requests a challenge on open', async () => {
    const { rerender } = render(<StepUpModal open={false} onCancel={vi.fn()} onElevated={vi.fn()} />)
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(apiMock.stepUp).not.toHaveBeenCalled()

    rerender(<StepUpModal open onCancel={vi.fn()} onElevated={vi.fn()} />)
    expect(await screen.findByRole('dialog')).toBeInTheDocument()
    await waitFor(() => expect(apiMock.stepUp).toHaveBeenCalledTimes(1))
  })

  it('names the action being confirmed when one is supplied', async () => {
    render(<StepUpModal open actionLabel="grant credit" onCancel={vi.fn()} onElevated={vi.fn()} />)
    expect(await screen.findByText(/confirm your identity before you grant credit/i)).toBeInTheDocument()
  })

  it('exchanges the code for an elevation token and hands control back', async () => {
    const user = userEvent.setup()
    const onElevated = vi.fn()
    render(<StepUpModal open onCancel={vi.fn()} onElevated={onElevated} />)

    const input = await screen.findByLabelText(/Authentication or backup code/i)
    await waitFor(() => expect(input).toBeEnabled())
    await user.type(input, '123456')
    await user.click(screen.getByRole('button', { name: /^Verify$/i }))

    await waitFor(() => expect(apiMock.stepUpVerify).toHaveBeenCalledWith('ch-1', '123456'))
    // Stored separately from the session — the Bearer token is untouched.
    expect(tokenMock.setElevatedToken).toHaveBeenCalledWith('elevated-jwt')
    expect(onElevated).toHaveBeenCalledTimes(1)
  })

  it('surfaces a rejected code, clears the field and does not elevate', async () => {
    const user = userEvent.setup()
    const onElevated = vi.fn()
    apiMock.stepUpVerify.mockRejectedValueOnce(new Error('Invalid code'))
    render(<StepUpModal open onCancel={vi.fn()} onElevated={onElevated} />)

    const input = await screen.findByLabelText(/Authentication or backup code/i)
    await waitFor(() => expect(input).toBeEnabled())
    await user.type(input, '000000')
    await user.click(screen.getByRole('button', { name: /^Verify$/i }))

    expect(await screen.findByRole('alert')).toHaveTextContent(/Invalid code/i)
    expect(tokenMock.setElevatedToken).not.toHaveBeenCalled()
    expect(onElevated).not.toHaveBeenCalled()
    expect(input).toHaveValue('')
  })

  it('tells an email-factor user where the code went', async () => {
    apiMock.stepUp.mockResolvedValue(EMAIL_CHALLENGE)
    render(<StepUpModal open onCancel={vi.fn()} onElevated={vi.fn()} />)
    expect(await screen.findByText(/We emailed a code to your account address/i)).toBeInTheDocument()
    expect(screen.getByLabelText(/Emailed code/i)).toBeInTheDocument()
  })

  it('reports a challenge that could not be started, and keeps Verify disabled', async () => {
    apiMock.stepUp.mockRejectedValueOnce(new Error('OTP_TRANSPORT_UNCONFIGURED'))
    render(<StepUpModal open onCancel={vi.fn()} onElevated={vi.fn()} />)

    expect(await screen.findByRole('alert')).toHaveTextContent(/OTP_TRANSPORT_UNCONFIGURED/i)
    expect(screen.getByRole('button', { name: /^Verify$/i })).toBeDisabled()
  })

  it('cancels without elevating', async () => {
    const user = userEvent.setup()
    const onCancel = vi.fn()
    render(<StepUpModal open onCancel={onCancel} onElevated={vi.fn()} />)

    await user.click(await screen.findByRole('button', { name: /^Cancel$/i }))
    expect(onCancel).toHaveBeenCalledTimes(1)
    expect(tokenMock.setElevatedToken).not.toHaveBeenCalled()
  })

  it('has no axe violations', async () => {
    const { container } = render(<StepUpModal open onCancel={vi.fn()} onElevated={vi.fn()} />)
    await screen.findByRole('dialog')
    await waitFor(() => expect(screen.getByLabelText(/Authentication or backup code/i)).toBeEnabled())
    expect(await axe(container)).toHaveNoViolations()
  })
})
