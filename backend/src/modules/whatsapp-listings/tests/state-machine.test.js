import { describe, it, expect } from 'vitest'
import { transition } from '../domain/state.js'
import { SessionState } from '../domain/types.js'
import { parsePriceAdjustment } from '../application/pipeline.js'

describe('WhatsApp Listing state machine', () => {
  it('transitions IDLE → COLLECTING', () => {
    const next = transition({ state: SessionState.IDLE }, SessionState.COLLECTING)
    expect(next.state).toBe(SessionState.COLLECTING)
  })

  it('transitions COLLECTING → READY_FOR_EXTRACTION', () => {
    const next = transition({ state: SessionState.COLLECTING }, SessionState.READY_FOR_EXTRACTION)
    expect(next.state).toBe(SessionState.READY_FOR_EXTRACTION)
  })

  it('transitions EXTRACTING → AWAITING_APPROVAL', () => {
    const next = transition({ state: SessionState.EXTRACTING }, SessionState.AWAITING_APPROVAL)
    expect(next.state).toBe(SessionState.AWAITING_APPROVAL)
  })

  it('transitions AWAITING_APPROVAL → PUBLISHING', () => {
    const next = transition({ state: SessionState.AWAITING_APPROVAL }, SessionState.PUBLISHING)
    expect(next.state).toBe(SessionState.PUBLISHING)
  })

  it('transitions PUBLISHING → COMPLETED', () => {
    const next = transition({ state: SessionState.PUBLISHING }, SessionState.COMPLETED)
    expect(next.state).toBe(SessionState.COMPLETED)
  })

  it('allows AWAITING_APPROVAL → COLLECTING for edit flow', () => {
    const next = transition({ state: SessionState.AWAITING_APPROVAL }, SessionState.COLLECTING)
    expect(next.state).toBe(SessionState.COLLECTING)
  })

  it('supports price review before returning to approval', () => {
    const awaitingPrice = transition({ state: SessionState.AWAITING_APPROVAL }, SessionState.AWAITING_PRICE_ADJUSTMENT)
    expect(awaitingPrice.state).toBe(SessionState.AWAITING_PRICE_ADJUSTMENT)
    const reviewed = transition(awaitingPrice, SessionState.AWAITING_APPROVAL)
    expect(reviewed.state).toBe(SessionState.AWAITING_APPROVAL)
  })

  it('allows any state → ERROR', () => {
    const next = transition({ state: SessionState.EXTRACTING }, SessionState.ERROR)
    expect(next.state).toBe(SessionState.ERROR)
  })

  it('rejects invalid transitions', () => {
    expect(() => transition({ state: SessionState.COMPLETED }, SessionState.PUBLISHING)).toThrow()
  })
})

describe('WhatsApp price adjustment parser', () => {
  it('accepts positive USD and LBP values with common formatting', () => {
    expect(parsePriceAdjustment('$450,000 USD')).toEqual({ ok: true, price: 450000, currency: 'USD' })
    expect(parsePriceAdjustment('40,500,000,000 lbp')).toEqual({ ok: true, price: 40500000000, currency: 'LBP' })
  })

  it('requires an explicit supported currency and positive amount', () => {
    expect(parsePriceAdjustment('450000').ok).toBe(false)
    expect(parsePriceAdjustment('450000 EUR').ok).toBe(false)
    expect(parsePriceAdjustment('0 USD').ok).toBe(false)
    expect(parsePriceAdjustment('-10 USD').ok).toBe(false)
  })
})
