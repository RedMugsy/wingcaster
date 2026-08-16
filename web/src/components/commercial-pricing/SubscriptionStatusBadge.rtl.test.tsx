// @vitest-environment jsdom
/**
 * First RTL + jest-axe test in the codebase — serves as both a smoke
 * test for the new web-infra setup AND a copy-paste template for
 * every component test going forward.
 *
 * What this proves:
 *   1. jsdom environment activates via the file directive above
 *   2. React renders inside vitest
 *   3. @testing-library/jest-dom matchers are available on `expect`
 *   4. @testing-library/user-event works for interaction (unused
 *      here — no interactive component — but the import compiles)
 *   5. jest-axe runs against the rendered output without violations
 *   6. cleanup() from setup file prevents DOM leak between cases
 */
import { describe, expect, it } from 'vitest'
import { render, screen } from '@testing-library/react'
import { axe, toHaveNoViolations } from 'jest-axe'
import userEvent from '@testing-library/user-event'
import { SubscriptionStatusBadge } from './SubscriptionStatusBadge'
import type { SubscriptionStatus } from '@/types/commercialPricing'

expect.extend(toHaveNoViolations)

describe('SubscriptionStatusBadge (RTL)', () => {
  const statuses: SubscriptionStatus[] = ['trialing', 'active', 'past_due', 'paused', 'cancelled', 'expired']

  it.each(statuses)('renders the Title-Case label for status=%s', (status) => {
    render(<SubscriptionStatusBadge status={status} />)
    // Labels: Trialing / Active / Past due / Paused / Cancelled / Expired
    // Regex match tolerates the future addition of surrounding text.
    const expected = new RegExp(status === 'past_due' ? 'Past due' : status[0].toUpperCase() + status.slice(1), 'i')
    expect(screen.getByText(expected)).toBeInTheDocument()
  })

  it('accepts a custom className without dropping the status colour classes', () => {
    render(<SubscriptionStatusBadge status="active" className="ml-4 custom-caller-class" />)
    const el = screen.getByText(/Active/i)
    expect(el).toHaveClass('custom-caller-class')
    expect(el).toHaveClass('text-emerald-700')
  })

  it('is accessible under axe with default rules', async () => {
    const { container } = render(<SubscriptionStatusBadge status="active" />)
    const results = await axe(container)
    expect(results).toHaveNoViolations()
  })

  it('user-event surface loads without error', async () => {
    // No interactive component here; this only proves the import is
    // wired so future click/keyboard tests compile. Actual interactions
    // land in the 7f/2 sign-in 2FA + step-up modal tests.
    const user = userEvent.setup()
    expect(user).toBeDefined()
  })
})
