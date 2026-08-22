// @vitest-environment jsdom
import type { ReactElement } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen, cleanup } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import {
  ApprovalsPage, AuditPage, ConfigurationPage, ContractsPage, CreditsPage,
  ExceptionsPage, FacilitiesPage, HoldsPage, InvoicesPage, OverviewPage,
  ParityPage, PricingPage, ReconciliationPage, TenantsPage, UsagePage, VendorCostsPage,
} from './index'

const apiMock = vi.hoisted(() => ({
  finGet: vi.fn(async () => ({
    tiles: {}, keys: [], tenants: [], rows: [], lots: [], holds: [],
    facilities: [], contracts: [], invoices: [], runs: [], types: [],
    approvals: [], events: [], vendors: [], stage11: false,
    dunning_policies: [], simulator: { amount_minor: '0' },
    reports: [], attestation: { eligible_to_sign: false },
  })),
  finPost: vi.fn(async () => ({})),
}))
vi.mock('@/api/client', () => ({ api: apiMock }))

const authMock = vi.hoisted(() => ({ isAdmin: true }))
vi.mock('@/context/AuthContext', () => ({
  useAuth: () => authMock,
}))

function wrap(ui: ReactElement) {
  return render(<MemoryRouter>{ui}</MemoryRouter>)
}

describe('admin/fin pages', () => {
  beforeEach(() => {
    cleanup()
    authMock.isAdmin = true
    apiMock.finGet.mockClear()
  })

  const pages: Array<[string, () => ReactElement]> = [
    ['Overview', () => <OverviewPage />],
    ['Tenants', () => <TenantsPage />],
    ['Usage drill', () => <UsagePage />],
    ['Credit lots', () => <CreditsPage />],
    ['Holds', () => <HoldsPage />],
    ['Facilities', () => <FacilitiesPage />],
    ['Contracts', () => <ContractsPage />],
    ['Pricing simulator', () => <PricingPage />],
    ['Invoices', () => <InvoicesPage />],
    ['Vendor costs', () => <VendorCostsPage />],
    ['Reconciliation', () => <ReconciliationPage />],
    ['Parity', () => <ParityPage />],
    ['Exceptions', () => <ExceptionsPage />],
    ['Approvals', () => <ApprovalsPage />],
    ['Audit', () => <AuditPage />],
    ['Configuration', () => <ConfigurationPage />],
  ]

  it.each(pages)('%s renders for a platform admin', (title, Page) => {
    const { container } = wrap(<Page />)
    expect(container.querySelector('h1')?.textContent).toBe(title)
  })

  it('Overview is gated for non-admins', () => {
    authMock.isAdmin = false
    wrap(<OverviewPage />)
    expect(screen.getByText('Platform admin required')).toBeTruthy()
  })

  it('Overview surfaces a Cutover readiness tile', async () => {
    wrap(<OverviewPage />)
    expect(await screen.findByText('Cutover readiness')).toBeTruthy()
  })

  it('Vendor costs shows Stage 11 empty state', async () => {
    wrap(<VendorCostsPage />)
    expect(await screen.findByText(/Stage 11 not merged/)).toBeTruthy()
  })
})
