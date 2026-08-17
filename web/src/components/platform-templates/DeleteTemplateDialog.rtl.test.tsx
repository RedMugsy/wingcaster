// @vitest-environment jsdom
/**
 * RTL + axe coverage for DeleteTemplateDialog.
 *
 * The properties that matter and are asserted here:
 *   * Seed templates cannot be deleted from this dialog — the primary
 *     button is disabled and a Deactivate hint is shown instead.
 *   * The Delete button stays disabled until the admin types the exact
 *     template code — an anti-muscle-memory guard for an irreversible op.
 *   * On successful delete, the confirm callback is invoked.
 *   * On error, the busy state clears and the error message renders.
 *   * The rendered output passes axe on both the seed and non-seed
 *     variants and after typing.
 */
import { describe, expect, it, vi, beforeEach } from 'vitest'
import { render, screen, waitFor, cleanup } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { axe, toHaveNoViolations } from 'jest-axe'
import { DeleteTemplateDialog } from './DeleteTemplateDialog'
import type { PlatformMessageTemplate } from '@/types/platformTemplates'

expect.extend(toHaveNoViolations)

function template(overrides: Partial<PlatformMessageTemplate> = {}): PlatformMessageTemplate {
  return {
    id: 't-1', code: 'signup_otp', display_name: 'Signup OTP', description: null,
    channel: 'email', category: 'auth',
    language: 'en', territory_id: null,
    subject: null, html_body: null, text_body: null,
    design_json: null, editor_mode: 'raw',
    required_variables: [], optional_variables: [],
    is_active: true, is_seed: false, version: 3,
    created_at: '', updated_at: '', created_by: null, updated_by: null,
    ...overrides,
  }
}

beforeEach(() => cleanup())

describe('DeleteTemplateDialog — non-seed', () => {
  it('keeps Delete disabled until the exact code is typed', async () => {
    const user = userEvent.setup()
    const onConfirm = vi.fn().mockResolvedValue(undefined)

    render(
      <DeleteTemplateDialog
        template={template({ code: 'signup_otp', display_name: 'Signup OTP' })}
        open
        onOpenChange={() => {}}
        onConfirm={onConfirm}
      />,
    )

    const deleteBtn = screen.getByRole('button', { name: /delete template/i })
    expect(deleteBtn).toBeDisabled()

    // Wrong text — still disabled, mismatch hint appears.
    const input = screen.getByLabelText(/type the template code/i)
    await user.type(input, 'signup_ot')
    expect(deleteBtn).toBeDisabled()
    expect(screen.getByText(/type the exact template code/i)).toBeInTheDocument()

    // Complete match — button enables.
    await user.type(input, 'p')
    expect(deleteBtn).toBeEnabled()
  })

  it('trims whitespace when comparing', async () => {
    const user = userEvent.setup()
    render(
      <DeleteTemplateDialog
        template={template({ code: 'signup_otp' })}
        open
        onOpenChange={() => {}}
        onConfirm={vi.fn()}
      />,
    )
    const input = screen.getByLabelText(/type the template code/i)
    await user.type(input, '  signup_otp  ')
    expect(screen.getByRole('button', { name: /delete template/i })).toBeEnabled()
  })

  it('invokes onConfirm and then closes on successful delete', async () => {
    const user = userEvent.setup()
    const onConfirm = vi.fn().mockResolvedValue(undefined)
    const onOpenChange = vi.fn()

    render(
      <DeleteTemplateDialog
        template={template({ code: 'signup_otp' })}
        open
        onOpenChange={onOpenChange}
        onConfirm={onConfirm}
      />,
    )
    await user.type(screen.getByLabelText(/type the template code/i), 'signup_otp')
    await user.click(screen.getByRole('button', { name: /delete template/i }))

    await waitFor(() => expect(onConfirm).toHaveBeenCalledTimes(1))
    await waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false))
  })

  it('surfaces an error and re-enables the button when delete fails', async () => {
    const user = userEvent.setup()
    const onConfirm = vi.fn().mockRejectedValue(new Error('Delete rejected by backend'))
    const onOpenChange = vi.fn()

    render(
      <DeleteTemplateDialog
        template={template({ code: 'signup_otp' })}
        open
        onOpenChange={onOpenChange}
        onConfirm={onConfirm}
      />,
    )
    await user.type(screen.getByLabelText(/type the template code/i), 'signup_otp')
    await user.click(screen.getByRole('button', { name: /delete template/i }))

    await waitFor(() => expect(onConfirm).toHaveBeenCalled())
    expect(await screen.findByRole('alert')).toHaveTextContent(/Delete rejected by backend/)
    // Dialog stayed open so the admin can see the failure.
    expect(onOpenChange).not.toHaveBeenCalledWith(false)
    expect(screen.getByRole('button', { name: /delete template/i })).toBeEnabled()
  })

  it('passes axe with a filled-in confirmation input', async () => {
    const user = userEvent.setup()
    const { container } = render(
      <DeleteTemplateDialog
        template={template({ code: 'signup_otp' })}
        open
        onOpenChange={() => {}}
        onConfirm={vi.fn()}
      />,
    )
    await user.type(screen.getByLabelText(/type the template code/i), 'signup_otp')
    expect(await axe(container)).toHaveNoViolations()
  })
})

describe('DeleteTemplateDialog — seed template', () => {
  it('refuses to enable Delete for a seed template and points the admin at Deactivate', () => {
    render(
      <DeleteTemplateDialog
        template={template({ code: 'signup_otp', is_seed: true })}
        open
        onOpenChange={() => {}}
        onConfirm={vi.fn()}
      />,
    )
    expect(screen.getByRole('button', { name: /delete template/i })).toBeDisabled()
    // No confirmation input at all in the seed variant.
    expect(screen.queryByLabelText(/type the template code/i)).not.toBeInTheDocument()
    // The Deactivate hint is present and refers to the resolver behaviour.
    expect(screen.getByRole('alert')).toHaveTextContent(/inactive/i)
    expect(screen.getByRole('alert')).toHaveTextContent(/fallback/i)
  })

  it('passes axe on the seed variant', async () => {
    const { container } = render(
      <DeleteTemplateDialog
        template={template({ is_seed: true })}
        open
        onOpenChange={() => {}}
        onConfirm={vi.fn()}
      />,
    )
    expect(await axe(container)).toHaveNoViolations()
  })
})

describe('DeleteTemplateDialog — no template', () => {
  it('renders a placeholder and keeps Delete disabled when template is null', () => {
    render(
      <DeleteTemplateDialog template={null} open onOpenChange={() => {}} onConfirm={vi.fn()} />,
    )
    expect(screen.getByRole('button', { name: /delete template/i })).toBeDisabled()
    expect(screen.getByText(/select a template first/i)).toBeInTheDocument()
  })
})
