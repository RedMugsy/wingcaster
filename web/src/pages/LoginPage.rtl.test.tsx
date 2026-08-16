// @vitest-environment jsdom
/**
 * RTL coverage for the Phase 7f/2 sign-in second-factor branch.
 *
 * The property that matters: a 2FA-enabled account is NOT signed in by the
 * password alone. The page must swap to a code prompt and only navigate once
 * the challenge is redeemed.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { axe, toHaveNoViolations } from 'jest-axe'

expect.extend(toHaveNoViolations)

const navigateMock = vi.hoisted(() => vi.fn())
vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual<typeof import('react-router-dom')>('react-router-dom')
  return { ...actual, useNavigate: () => navigateMock }
})

const authMock = vi.hoisted(() => ({
  login: vi.fn(),
  completeTwoFactor: vi.fn(),
  agent: null as unknown,
  loading: false,
}))
vi.mock('@/context/AuthContext', () => ({ useAuth: () => authMock }))

import { LoginPage } from './LoginPage'

function renderPage() {
  return render(
    <MemoryRouter>
      <LoginPage />
    </MemoryRouter>,
  )
}

async function signIn(user: ReturnType<typeof userEvent.setup>) {
  await user.type(screen.getByLabelText(/^Email$/i), 'agent@example.com')
  await user.type(screen.getByLabelText(/^Password$/i), 'hunter2')
  await user.click(screen.getByRole('button', { name: /^Sign in$/i }))
}

beforeEach(() => {
  vi.clearAllMocks()
  authMock.agent = null
  authMock.loading = false
  authMock.login.mockResolvedValue({ status: 'signed_in' })
  authMock.completeTwoFactor.mockResolvedValue(undefined)
})

describe('LoginPage — no second factor', () => {
  it('navigates straight to the dashboard', async () => {
    const user = userEvent.setup()
    renderPage()
    await signIn(user)

    await waitFor(() => expect(navigateMock).toHaveBeenCalledWith('/dashboard', { replace: true }))
    expect(screen.queryByText(/Two-factor authentication/i)).not.toBeInTheDocument()
  })
})

describe('LoginPage — second factor required', () => {
  beforeEach(() => {
    authMock.login.mockResolvedValue({ status: '2fa_required', challenge_id: 'ch-1', method: 'totp' })
  })

  it('swaps to the code prompt instead of signing in', async () => {
    const user = userEvent.setup()
    renderPage()
    await signIn(user)

    expect(await screen.findByText(/Two-factor authentication/i)).toBeInTheDocument()
    expect(screen.getByLabelText(/Authentication or backup code/i)).toBeInTheDocument()
    // Critically: the password alone did not get them in.
    expect(navigateMock).not.toHaveBeenCalled()
  })

  it('mentions backup codes so a lost phone is not a dead end', async () => {
    const user = userEvent.setup()
    renderPage()
    await signIn(user)
    expect(await screen.findByText(/backup codes/i)).toBeInTheDocument()
  })

  it('redeems the challenge and then navigates', async () => {
    const user = userEvent.setup()
    renderPage()
    await signIn(user)

    await user.type(await screen.findByLabelText(/Authentication or backup code/i), '123456')
    await user.click(screen.getByRole('button', { name: /^Verify$/i }))

    await waitFor(() => expect(authMock.completeTwoFactor).toHaveBeenCalledWith('ch-1', '123456'))
    await waitFor(() => expect(navigateMock).toHaveBeenCalledWith('/dashboard', { replace: true }))
  })

  it('surfaces a rejected code, clears the field and stays put', async () => {
    const user = userEvent.setup()
    authMock.completeTwoFactor.mockRejectedValueOnce(new Error('Invalid code'))
    renderPage()
    await signIn(user)

    const input = await screen.findByLabelText(/Authentication or backup code/i)
    await user.type(input, '000000')
    await user.click(screen.getByRole('button', { name: /^Verify$/i }))

    expect(await screen.findByRole('alert')).toHaveTextContent(/Invalid code/i)
    expect(input).toHaveValue('')
    expect(navigateMock).not.toHaveBeenCalled()
  })

  it('lets the user back out to the password form', async () => {
    const user = userEvent.setup()
    renderPage()
    await signIn(user)

    await user.click(await screen.findByRole('button', { name: /Back to sign in/i }))
    expect(screen.getByLabelText(/^Email$/i)).toBeInTheDocument()
    expect(screen.queryByLabelText(/Authentication or backup code/i)).not.toBeInTheDocument()
  })

  it('labels the emailed-code variant for users without an authenticator', async () => {
    const user = userEvent.setup()
    authMock.login.mockResolvedValue({ status: '2fa_required', challenge_id: 'ch-2', method: 'email' })
    renderPage()
    await signIn(user)

    expect(await screen.findByLabelText(/Emailed code/i)).toBeInTheDocument()
  })

  it('has no axe violations on the challenge step', async () => {
    const user = userEvent.setup()
    const { container } = renderPage()
    await signIn(user)
    await screen.findByLabelText(/Authentication or backup code/i)
    expect(await axe(container)).toHaveNoViolations()
  })
})
