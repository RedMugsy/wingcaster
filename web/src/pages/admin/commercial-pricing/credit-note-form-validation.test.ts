import { describe, expect, it } from 'vitest'
import { validateCreditNoteForm } from './CreditNoteFormDialog'
import type { CreditNoteType } from '@/types/commercialPricing'

const valid = {
  tenant_id: 'agent-42',
  subscription_id: '',
  type: 'courtesy' as CreditNoteType,
  amount_minor: 500,
  currency: 'USD',
  reason: '',
  expires_at: '',
}

describe('validateCreditNoteForm', () => {
  it('accepts a well-formed payload', () => {
    expect(validateCreditNoteForm(valid)).toBeNull()
  })

  it('rejects blank tenant_id', () => {
    expect(validateCreditNoteForm({ ...valid, tenant_id: '   ' })).toMatch(/tenant_id/)
  })

  it('accepts negative amount (debit owed by tenant)', () => {
    expect(validateCreditNoteForm({ ...valid, amount_minor: -1000 })).toBeNull()
  })

  it('rejects zero amount', () => {
    expect(validateCreditNoteForm({ ...valid, amount_minor: 0 })).toMatch(/non-zero/)
  })

  it('rejects bad currency', () => {
    expect(validateCreditNoteForm({ ...valid, currency: 'us' })).toMatch(/3-letter/)
    expect(validateCreditNoteForm({ ...valid, currency: 'USDT' })).toMatch(/3-letter/)
  })

  it('accepts all UI-selectable types', () => {
    const types: CreditNoteType[] = ['courtesy', 'refund', 'promo', 'manual_adjustment']
    for (const t of types) {
      expect(validateCreditNoteForm({ ...valid, type: t })).toBeNull()
    }
  })

  it('accepts backend-issued proration types when passed through', () => {
    // The UI select doesn't offer these but the validator must not reject them
    // if a caller somehow constructs one (e.g. an admin re-issue path).
    expect(validateCreditNoteForm({ ...valid, type: 'proration_credit' as CreditNoteType })).toBeNull()
    expect(validateCreditNoteForm({ ...valid, type: 'proration_debit' as CreditNoteType })).toBeNull()
  })
})
