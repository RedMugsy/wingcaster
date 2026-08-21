/**
 * Stage 13a pure legacy -> fin.* translators (DL-175..DL-178).
 * No DB access. Unit-tested with fixtures.
 */

/**
 * commercial.usage_events -> ingestUsageEventWithClient input (DL-175).
 * quantity maps 1:1 into quantity_units; Stage 13b parity may refine scale.
 */
export function usageEventInput(legacyEvent, {
  environment = 'LIVE',
  finTenantId = null,
  holderId = null,
  billingAccountId = null,
  now = null,
} = {}) {
  const occurredAt = legacyEvent?.occurred_at || now
  return {
    environment,
    tenantId: finTenantId || null,
    holderId: holderId || null,
    billingAccountId: billingAccountId || null,
    sourceSystem: 'commercial.usage_events',
    sourceEventId: String(legacyEvent?.id || ''),
    eventType: String(legacyEvent?.action_key || 'unknown'),
    quantityUnits: Math.max(1, Number(legacyEvent?.quantity) || 1),
    dimensions: {
      ...(legacyEvent?.metadata && typeof legacyEvent.metadata === 'object'
        ? legacyEvent.metadata
        : {}),
      channel: legacyEvent?.channel ?? null,
      destination_country: legacyEvent?.destination_country ?? null,
      whatsapp_category: legacyEvent?.whatsapp_category ?? null,
      casts_charged: legacyEvent?.casts_charged ?? null,
      price_minor: legacyEvent?.price_minor ?? null,
      quota_billing_period: legacyEvent?.billing_period ?? null,
      public_tenant_id: legacyEvent?.tenant_id ?? null,
    },
    occurredAt,
    receivedAt: now || occurredAt,
    subjectType: legacyEvent?.conversation_id ? 'CONVERSATION'
      : legacyEvent?.listing_id ? 'LISTING'
        : null,
    subjectId: legacyEvent?.conversation_id || legacyEvent?.listing_id || null,
    eventKind: 'ORIGINAL',
    actorType: 'SYSTEM',
    actorId: null,
    actorEmail: 'cutover-dual-write@fin.local',
    now: now || occurredAt,
  }
}

/**
 * commercial.holds (or hold-shaped payload) -> authorizeUsage input (DL-176).
 */
export function holdAuthorizeInput(legacyHold, {
  environment = 'LIVE',
  finTenantId = null,
  holderId = null,
  bookId = null,
  now = null,
} = {}) {
  const units = Math.max(1, Number(legacyHold?.units ?? legacyHold?.amount ?? legacyHold?.quantity) || 1)
  const id = legacyHold?.id || legacyHold?.hold_id
  return {
    environment,
    tenantId: finTenantId || null,
    holderId,
    bookId,
    unitsRequested: units,
    reasonCode: legacyHold?.reason_code || legacyHold?.reasonCode || 'CUTOVER_DUAL_WRITE_HOLD',
    idempotencyKey: `CUTOVER:HOLD:${id}`,
    actionKey: legacyHold?.action_key || legacyHold?.actionKey || null,
    meterId: legacyHold?.meter_id || legacyHold?.meterId || null,
    ratedUsageId: legacyHold?.rated_usage_id || legacyHold?.ratedUsageId || null,
    subjectId: legacyHold?.subject_id || legacyHold?.subjectId || id || null,
    actorType: 'SYSTEM',
    actorId: null,
    actorEmail: 'cutover-dual-write@fin.local',
    now,
  }
}

/**
 * commercial capture-shaped payload -> captureUsage input (DL-177).
 * Facility captures use captureFacilityInput instead.
 */
export function captureUsageInput(legacyCapture, {
  now = null,
} = {}) {
  const holdId = legacyCapture?.hold_id || legacyCapture?.holdId
  const id = legacyCapture?.id || holdId
  return {
    holdId,
    ratedUsageId: legacyCapture?.rated_usage_id || legacyCapture?.ratedUsageId || null,
    reasonCode: legacyCapture?.reason_code || legacyCapture?.reasonCode || 'CUTOVER_DUAL_WRITE_CAPTURE',
    idempotencyKey: `CUTOVER:CAPTURE:${id}`,
    actorType: 'SYSTEM',
    actorId: null,
    actorEmail: 'cutover-dual-write@fin.local',
    now,
  }
}

/**
 * Facility reservation capture -> captureFacility input (DL-177).
 */
export function captureFacilityInput(legacyCapture, {
  now = null,
} = {}) {
  const reservationId = legacyCapture?.reservation_id || legacyCapture?.reservationId
  const id = legacyCapture?.id || reservationId
  return {
    reservationId,
    units: legacyCapture?.units != null ? Number(legacyCapture.units) : undefined,
    bookId: legacyCapture?.book_id || legacyCapture?.bookId || undefined,
    holderId: legacyCapture?.holder_id || legacyCapture?.holderId || undefined,
    reasonCode: legacyCapture?.reason_code || legacyCapture?.reasonCode || 'CUTOVER_DUAL_WRITE_FACILITY_CAPTURE',
    idempotencyKey: `CUTOVER:FACILITY_CAPTURE:${id}`,
    now,
  }
}

/**
 * commercial refund / credit-note shaped payload -> refundPurchase input (DL-178).
 */
export function refundPurchaseInput(legacyRefund, {
  now = null,
} = {}) {
  const intentId = legacyRefund?.purchase_intent_id
    || legacyRefund?.purchaseIntentId
    || legacyRefund?.intent_id
    || legacyRefund?.intentId
  const id = legacyRefund?.id || intentId
  return {
    intentId,
    amountMinor: legacyRefund?.amount_minor ?? legacyRefund?.amountMinor ?? undefined,
    units: legacyRefund?.units != null ? Number(legacyRefund.units) : undefined,
    provider: legacyRefund?.provider || undefined,
    providerEventId: legacyRefund?.provider_event_id || legacyRefund?.providerEventId || undefined,
    reasonCode: legacyRefund?.reason_code || legacyRefund?.reasonCode || 'CUTOVER_DUAL_WRITE_REFUND',
    idempotencyKey: `CUTOVER:REFUND:${id}`,
    actorType: 'SYSTEM',
    actorId: null,
    actorEmail: 'cutover-dual-write@fin.local',
    now,
  }
}

/**
 * commercial.ledger_entries consumption -> authorizeUsage-shaped input (DL-179).
 * Used when dual-writing quota consumption; missing holder/book yields DLQ.
 */
export function ledgerConsumptionAuthorizeInput(legacyEntry, {
  environment = 'LIVE',
  finTenantId = null,
  holderId = null,
  bookId = null,
  now = null,
} = {}) {
  const amount = Math.abs(Number(legacyEntry?.amount) || 0)
  return holdAuthorizeInput({
    id: legacyEntry?.id,
    units: amount || 1,
    reason_code: 'CUTOVER_DUAL_WRITE_CONSUMPTION',
    action_key: legacyEntry?.quota_key || legacyEntry?.metadata?.action_key || null,
    subject_id: legacyEntry?.source_event_id || legacyEntry?.id,
  }, {
    environment,
    finTenantId,
    holderId,
    bookId,
    now,
  })
}
