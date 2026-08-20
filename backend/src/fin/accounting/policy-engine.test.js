import { describe, expect, it } from 'vitest'
import {
  evaluateConsumption,
  evaluateExpiry,
  evaluateFunding,
  evaluatePostpaidCapture,
  evaluateRefund,
  evaluateWriteOff,
  normalizePolicy,
} from './policy-engine.js'

const POLICY = normalizePolicy({
  recognition: 'ON_CONSUMPTION',
  breakage: 'ON_EXPIRY',
  accounts: { REVENUE_RECOGNIZED: 'REVENUE' },
})

describe('policy-engine evaluate*', () => {
  it('evaluateFunding emits DEFERRED_REVENUE_CREATED for quoted_minor', () => {
    const out = evaluateFunding(
      { id: '11111111-1111-1111-1111-111111111111', quoted_minor: 5000, currency: 'USD' },
      { id: 'tx' },
      POLICY,
    )
    expect(out.events).toHaveLength(1)
    expect(out.events[0].eventKind).toBe('DEFERRED_REVENUE_CREATED')
    expect(out.events[0].amountMinor).toBe('5000')
    expect(out.events[0].accountCode).toBe('DEFERRED_REVENUE')
    expect(out.groups).toHaveLength(1)
  })

  it('evaluateConsumption prepaid emits only REVENUE_RECOGNIZED', () => {
    const out = evaluateConsumption(
      { id: 'hold' },
      { txId: 'cap' },
      { id: 'rated', amount_minor: 300, currency: 'USD' },
      POLICY,
    )
    expect(out.events.map((e) => e.eventKind)).toEqual(['REVENUE_RECOGNIZED'])
    expect(out.events[0].amountMinor).toBe('300')
  })

  it('evaluateConsumption postpaid emits REVENUE_RECOGNIZED + RECEIVABLE_CREATED', () => {
    const out = evaluateConsumption(
      { id: 'hold', postpaid: true },
      { txId: 'cap', postpaid: true },
      { id: 'rated', amount_minor: 300, currency: 'USD' },
      POLICY,
    )
    expect(out.events.map((e) => e.eventKind).sort()).toEqual([
      'RECEIVABLE_CREATED', 'REVENUE_RECOGNIZED',
    ])
    expect(out.events.every((e) => e.amountMinor === '300')).toBe(true)
  })

  it('evaluatePostpaidCapture emits both events for the same units', () => {
    const out = evaluatePostpaidCapture(
      { id: 'res', reserved_minor: 800, currency: 'USD' },
      { txId: 'cap' },
      { amount_minor: 800 },
      POLICY,
    )
    expect(out.events).toHaveLength(2)
    expect(out.events[0].eventKind).toBe('RECEIVABLE_CREATED')
    expect(out.events[1].eventKind).toBe('REVENUE_RECOGNIZED')
    expect(out.events[0].amountMinor).toBe(out.events[1].amountMinor)
  })

  it('evaluateExpiry ON_EXPIRY emits BREAKAGE_RECOGNIZED via integer arithmetic', () => {
    const out = evaluateExpiry({
      id: 'lot',
      granted_units: 3,
      remaining_units: 1,
      consideration_minor: 100,
      currency: 'USD',
    }, POLICY)
    expect(out.events).toHaveLength(1)
    expect(out.events[0].eventKind).toBe('BREAKAGE_RECOGNIZED')
    expect(out.events[0].amountMinor).toBe('33')
  })

  it('evaluateExpiry PROPORTIONAL_EXPECTED_BREAKAGE schedules lines and no immediate event', () => {
    const out = evaluateExpiry({
      id: 'lot',
      granted_units: 10,
      remaining_units: 4,
      consideration_minor: 100,
      expires_at: '2026-12-01T00:00:00.000Z',
    }, { breakage: 'PROPORTIONAL_EXPECTED_BREAKAGE' })
    expect(out.events).toEqual([])
    expect(out.lines).toHaveLength(1)
    expect(out.lines[0].status).toBe('PENDING')
  })

  it('evaluateExpiry skips bonus lots (consideration 0)', () => {
    const out = evaluateExpiry({
      id: 'lot', granted_units: 10, remaining_units: 10, consideration_minor: 0,
    }, POLICY)
    expect(out.events).toEqual([])
  })

  it('evaluateRefund reverses only the recognized subset', () => {
    const out = evaluateRefund(
      { id: 'pi', recognizedMinor: 40, refundMinor: 100, currency: 'USD' },
      { txId: 'ref' },
      POLICY,
    )
    expect(out.events[0].eventKind).toBe('REFUND_REVENUE_REVERSED')
    expect(out.events[0].amountMinor).toBe('40')
  })

  it('evaluateWriteOff emits BAD_DEBT_WRITE_OFF and never a revenue reversal (spec §73)', () => {
    const out = evaluateWriteOff({
      id: 'inv', amountMinor: 1200, currency: 'USD',
    }, POLICY)
    expect(out.events.map((e) => e.eventKind)).toEqual(['BAD_DEBT_WRITE_OFF'])
    expect(out.events.some((e) => e.eventKind === 'REFUND_REVENUE_REVERSED')).toBe(false)
    expect(out.events.some((e) => e.eventKind === 'REVENUE_RECOGNIZED')).toBe(false)
  })
})
