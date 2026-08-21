/**
 * Fast suite — legacy -> fin.* translators.
 */
import { describe, expect, it } from 'vitest'
import {
  usageEventInput,
  holdAuthorizeInput,
  captureUsageInput,
  captureFacilityInput,
  refundPurchaseInput,
  ledgerConsumptionAuthorizeInput,
} from './mapping.js'

const NOW = '2026-08-21T12:00:00.000Z'

describe('cutover mapping', () => {
  it('usageEventInput maps commercial.usage_events shape', () => {
    const input = usageEventInput({
      id: 'evt-1',
      tenant_id: 'pt-a',
      action_key: 'message.out.whatsapp.utility',
      quantity: 3,
      channel: 'whatsapp',
      destination_country: 'SA',
      whatsapp_category: 'utility_service',
      casts_charged: 2,
      price_minor: 40,
      billing_period: '2026-08',
      conversation_id: 'c-1',
      metadata: { foo: 'bar' },
      occurred_at: NOW,
    }, {
      environment: 'LIVE',
      finTenantId: '11111111-1111-1111-1111-111111111111',
      holderId: '22222222-2222-2222-2222-222222222222',
      billingAccountId: '33333333-3333-3333-3333-333333333333',
      now: NOW,
    })
    expect(input).toMatchObject({
      environment: 'LIVE',
      tenantId: '11111111-1111-1111-1111-111111111111',
      sourceSystem: 'commercial.usage_events',
      sourceEventId: 'evt-1',
      eventType: 'message.out.whatsapp.utility',
      quantityUnits: 3,
      subjectType: 'CONVERSATION',
      subjectId: 'c-1',
      eventKind: 'ORIGINAL',
    })
    expect(input.dimensions).toMatchObject({
      foo: 'bar',
      channel: 'whatsapp',
      casts_charged: 2,
      public_tenant_id: 'pt-a',
    })
  })

  it('holdAuthorizeInput maps hold-shaped payloads', () => {
    const input = holdAuthorizeInput({
      id: 'hold-1',
      units: 5,
      action_key: 'ai.chat.turn',
      reason_code: 'TEST_HOLD',
    }, {
      environment: 'LIVE',
      finTenantId: 't1',
      holderId: 'h1',
      bookId: 'b1',
      now: NOW,
    })
    expect(input).toMatchObject({
      unitsRequested: 5,
      reasonCode: 'TEST_HOLD',
      idempotencyKey: 'CUTOVER:HOLD:hold-1',
      holderId: 'h1',
      bookId: 'b1',
      actionKey: 'ai.chat.turn',
    })
  })

  it('captureUsageInput and captureFacilityInput', () => {
    expect(captureUsageInput({
      id: 'cap-1',
      hold_id: 'hold-9',
      rated_usage_id: 'ru-1',
    }, { now: NOW })).toMatchObject({
      holdId: 'hold-9',
      ratedUsageId: 'ru-1',
      idempotencyKey: 'CUTOVER:CAPTURE:cap-1',
      reasonCode: 'CUTOVER_DUAL_WRITE_CAPTURE',
    })
    expect(captureFacilityInput({
      reservation_id: 'res-1',
      units: 2,
      book_id: 'b1',
      holder_id: 'h1',
    }, { now: NOW })).toMatchObject({
      reservationId: 'res-1',
      units: 2,
      bookId: 'b1',
      holderId: 'h1',
      idempotencyKey: 'CUTOVER:FACILITY_CAPTURE:res-1',
    })
  })

  it('refundPurchaseInput maps refund-shaped payloads', () => {
    expect(refundPurchaseInput({
      id: 'rf-1',
      purchase_intent_id: 'pi-1',
      amount_minor: 500,
      provider: 'STRIPE',
      provider_event_id: 'evt_1',
    }, { now: NOW })).toMatchObject({
      intentId: 'pi-1',
      amountMinor: 500,
      provider: 'STRIPE',
      providerEventId: 'evt_1',
      idempotencyKey: 'CUTOVER:REFUND:rf-1',
    })
  })

  it('ledgerConsumptionAuthorizeInput uses abs(amount)', () => {
    const input = ledgerConsumptionAuthorizeInput({
      id: 'le-1',
      amount: -4,
      quota_key: 'outbound_whatsapp',
      source_event_id: 'evt-9',
    }, {
      environment: 'LIVE',
      finTenantId: 't1',
      holderId: 'h1',
      bookId: 'b1',
      now: NOW,
    })
    expect(input.unitsRequested).toBe(4)
    expect(input.idempotencyKey).toBe('CUTOVER:HOLD:le-1')
    expect(input.reasonCode).toBe('CUTOVER_DUAL_WRITE_CONSUMPTION')
  })
})
