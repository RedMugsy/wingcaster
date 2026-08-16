// @vitest-environment jsdom
/**
 * RTL coverage for the Phase 7f/2 two-factor settings page.
 *
 * The whole point of this page is that a secret becomes a credential only
 * after the user proves they scanned it, and that the backup codes are shown
 * exactly once. Both are asserted here.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { axe, toHaveNoViolations } from 'jest-axe'

expect.extend(toHaveNoViolations)

const apiMock = vi.hoisted(() => ({
  twoFactorStatus: vi.fn(),
  totpSetup: vi.fn(),
  totpVerify: vi.fn(),
  totpDisable: vi.fn(),
}))
vi.mock('@/api/client', () => ({ api: apiMock }))

// jsdom has no canvas, so the real qrcode library cannot render here.
vi.mock('qrcode', () => ({
  default: { toDataURL: vi.fn(async () => 'data:image/png;base64,stub') },
}))

import { TotpSettingsPage } from './TotpSettingsPage'

const DISABLED = { totp_enabled: false as const, preferred_2fa: 'email' as const, totp_enrolled_at: null, backup_codes_remaining: 0 }
const ENABLED = { totp_enabled: true as const, preferred_2fa: 'totp' as const, totp_enrolled_at: '2026-08-16T00:00:00.000Z', backup_codes_remaining: 10 }
const SETUP = {
  secret: 'JBSWY3DPEHPK3PXPJBSWY3DPEHPK3PXP',
  provisioning_uri: 'otpauth://totp/Wingcaster:a%40b.com?secret=JBSWY3DPEHPK3PXPJBSWY3DPEHPK3PXP&issuer=Wingcaster',
  issuer: 'Wingcaster',
  account: 'a@b.com',
}
const BACKUP_CODES = Array.from({ length: 10 }, (_, i) => `CODE${i}-ABCDE`)

beforeEach(() => {
  vi.clearAllMocks()
  apiMock.twoFactorStatus.mockResolvedValue(DISABLED)
  apiMock.totpSetup.mockResolvedValue(SETUP)
  apiMock.totpVerify.mockResolvedValue({
    totp_enabled: true,
    totp_enrolled_at: '2026-08-16T00:00:00.000Z',
    backup_codes: BACKUP_CODES,
    backup_codes_remaining: 10,
  })
  apiMock.totpDisable.mockResolvedValue({ totp_enabled: false, token: 'new-token' })
})

describe('TotpSettingsPage — enrolment', () => {
  it('shows the off state and offers setup when TOTP is not enrolled', async () => {
    render(<TotpSettingsPage />)
    expect(await screen.findByText(/Authenticator app is off/i)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Set up authenticator app/i })).toBeInTheDocument()
  })

  it('requires the current password before issuing a secret', async () => {
    const user = userEvent.setup()
    render(<TotpSettingsPage />)

    await user.click(await screen.findByRole('button', { name: /Set up authenticator app/i }))
    expect(screen.getByLabelText(/Confirm your password/i)).toBeInTheDocument()
    // No secret has been requested merely by opening the form.
    expect(apiMock.totpSetup).not.toHaveBeenCalled()

    await user.type(screen.getByLabelText(/Confirm your password/i), 'hunter2')
    await user.click(screen.getByRole('button', { name: /^Continue$/i }))

    await waitFor(() => expect(apiMock.totpSetup).toHaveBeenCalledWith('hunter2'))
  })

  it('renders the QR code and the manual key, then enrols on a valid code', async () => {
    const user = userEvent.setup()
    render(<TotpSettingsPage />)

    await user.click(await screen.findByRole('button', { name: /Set up authenticator app/i }))
    await user.type(screen.getByLabelText(/Confirm your password/i), 'hunter2')
    await user.click(screen.getByRole('button', { name: /^Continue$/i }))

    const qr = await screen.findByAltText(/QR code for setting up your authenticator app/i)
    expect(qr).toHaveAttribute('src', 'data:image/png;base64,stub')
    // The manual-entry fallback matters when a camera isn't available.
    expect(screen.getByText(SETUP.secret)).toBeInTheDocument()

    await user.type(screen.getByLabelText(/Enter the 6-digit code/i), '123456')
    await user.click(screen.getByRole('button', { name: /Turn on/i }))

    await waitFor(() => expect(apiMock.totpVerify).toHaveBeenCalledWith(SETUP.secret, '123456'))
  })

  it('surfaces a rejected code and clears the field without enrolling', async () => {
    const user = userEvent.setup()
    apiMock.totpVerify.mockRejectedValueOnce(new Error('Invalid code'))
    render(<TotpSettingsPage />)

    await user.click(await screen.findByRole('button', { name: /Set up authenticator app/i }))
    await user.type(screen.getByLabelText(/Confirm your password/i), 'hunter2')
    await user.click(screen.getByRole('button', { name: /^Continue$/i }))
    await screen.findByAltText(/QR code/i)

    await user.type(screen.getByLabelText(/Enter the 6-digit code/i), '000000')
    await user.click(screen.getByRole('button', { name: /Turn on/i }))

    expect(await screen.findByRole('alert')).toHaveTextContent(/Invalid code/i)
    expect(screen.getByLabelText(/Enter the 6-digit code/i)).toHaveValue('')
    expect(screen.queryByText(/Save your backup codes/i)).not.toBeInTheDocument()
  })

  it('shows the backup codes once and gates dismissal on acknowledgement', async () => {
    const user = userEvent.setup()
    render(<TotpSettingsPage />)

    await user.click(await screen.findByRole('button', { name: /Set up authenticator app/i }))
    await user.type(screen.getByLabelText(/Confirm your password/i), 'hunter2')
    await user.click(screen.getByRole('button', { name: /^Continue$/i }))
    await screen.findByAltText(/QR code/i)
    await user.type(screen.getByLabelText(/Enter the 6-digit code/i), '123456')
    await user.click(screen.getByRole('button', { name: /Turn on/i }))

    expect(await screen.findByText(/Save your backup codes/i)).toBeInTheDocument()
    for (const code of BACKUP_CODES) {
      expect(screen.getByText(code)).toBeInTheDocument()
    }

    // The user cannot dismiss the only copy of the codes by accident.
    const done = screen.getByRole('button', { name: /^Done$/i })
    expect(done).toBeDisabled()
    await user.click(screen.getByRole('checkbox'))
    expect(done).toBeEnabled()
  })
})

describe('TotpSettingsPage — disable', () => {
  it('shows remaining backup codes and requires a factor to turn off', async () => {
    const user = userEvent.setup()
    apiMock.twoFactorStatus.mockResolvedValue(ENABLED)
    render(<TotpSettingsPage />)

    expect(await screen.findByText(/Authenticator app is on/i)).toBeInTheDocument()
    expect(screen.getByText(/10 backup codes remaining/i)).toBeInTheDocument()

    await user.type(screen.getByLabelText(/Authentication or backup code/i), '123456')
    await user.click(screen.getByRole('button', { name: /Turn off two-factor/i }))

    await waitFor(() => expect(apiMock.totpDisable).toHaveBeenCalledWith('123456'))
    expect(await screen.findByRole('status')).toHaveTextContent(/every other signed-in session was signed out/i)
  })

  it('pluralises a single remaining backup code', async () => {
    apiMock.twoFactorStatus.mockResolvedValue({ ...ENABLED, backup_codes_remaining: 1 })
    render(<TotpSettingsPage />)
    expect(await screen.findByText(/1 backup code remaining/i)).toBeInTheDocument()
  })
})

describe('TotpSettingsPage — accessibility', () => {
  it('has no axe violations in the disabled state', async () => {
    const { container } = render(<TotpSettingsPage />)
    await screen.findByText(/Authenticator app is off/i)
    expect(await axe(container)).toHaveNoViolations()
  })

  it('has no axe violations on the scan step', async () => {
    const user = userEvent.setup()
    const { container } = render(<TotpSettingsPage />)
    await user.click(await screen.findByRole('button', { name: /Set up authenticator app/i }))
    await user.type(screen.getByLabelText(/Confirm your password/i), 'hunter2')
    await user.click(screen.getByRole('button', { name: /^Continue$/i }))
    await screen.findByAltText(/QR code/i)
    expect(await axe(container)).toHaveNoViolations()
  })

  it('has no axe violations in the enrolled state', async () => {
    apiMock.twoFactorStatus.mockResolvedValue(ENABLED)
    const { container } = render(<TotpSettingsPage />)
    await screen.findByText(/Authenticator app is on/i)
    expect(await axe(container)).toHaveNoViolations()
  })
})
