/**
 * Pure AccountingPolicy.evaluate* surface (G §2 / Stage 9 plan).
 * No SQL. Callers stamp the returned events via insertAccountingEvent.
 */
import { asMinor, minorString } from './helpers.js'

const DEFAULT_POLICY = {
  recognition: 'ON_CONSUMPTION',
  breakage: 'ON_EXPIRY',
  accounts: {
    DEFERRED_REVENUE_CREATED: 'DEFERRED_REVENUE',
    REVENUE_RECOGNIZED: 'REVENUE',
    RECEIVABLE_CREATED: 'ACCOUNTS_RECEIVABLE',
    BREAKAGE_RECOGNIZED: 'BREAKAGE',
    BAD_DEBT_WRITE_OFF: 'CREDIT_LOSS',
    REFUND_REVENUE_REVERSED: 'REVENUE',
    TRANSFER_INTERNAL: 'CLEARING',
    ADJUSTMENT_REVENUE: 'REVENUE',
    FX_REMEASUREMENT: 'FX',
    TAX_ACCRUED: 'TAX',
    CONSIDERATION_ALLOCATED: 'DEFERRED_REVENUE',
  },
}

export function normalizePolicy(policyDefinition) {
  const raw = policyDefinition && typeof policyDefinition === 'object'
    ? policyDefinition
    : {}
  return {
    recognition: raw.recognition || DEFAULT_POLICY.recognition,
    breakage: raw.breakage || DEFAULT_POLICY.breakage,
    accounts: { ...DEFAULT_POLICY.accounts, ...(raw.accounts || {}) },
  }
}

function event(kind, amountMinor, currency, sourceType, sourceId, memo, policy) {
  const amount = asMinor(amountMinor)
  if (amount <= 0n && kind !== 'TAX_ACCRUED') {
    return null
  }
  return {
    eventKind: kind,
    amountMinor: minorString(amount),
    currency,
    sourceType,
    sourceId,
    memo,
    accountCode: policy.accounts[kind] || kind,
  }
}

function pack(events, groups = [], lines = []) {
  return { events: events.filter(Boolean), groups, lines }
}

export function evaluateFunding(intent, ledgerTx, policyDefinition) {
  const policy = normalizePolicy(policyDefinition)
  const amount = asMinor(intent?.quoted_minor ?? intent?.quotedMinor ?? intent?.consideration_minor)
  const currency = intent?.currency || 'USD'
  const sourceId = intent?.id || intent?.intentId
  return pack([
    event(
      'DEFERRED_REVENUE_CREATED',
      amount,
      currency,
      'PURCHASE_INTENT',
      sourceId,
      `funding:${ledgerTx?.id || ledgerTx?.txId || 'none'}`,
      policy,
    ),
  ], [{
    sourceType: 'PURCHASE_INTENT',
    sourceId,
    obligationKey: 'DEFAULT',
    amountMinor: minorString(amount),
    recognition: policy.recognition,
  }], [{
    amountMinor: minorString(amount),
    recognitionAt: null,
    recognizedAmountMinor: '0',
    status: 'PENDING',
  }])
}

export function evaluateConsumption(hold, capture, ratedUsage, policyDefinition) {
  const policy = normalizePolicy(policyDefinition)
  const amount = asMinor(
    ratedUsage?.amount_minor ?? ratedUsage?.amountMinor ?? capture?.amountMinor,
  )
  const currency = ratedUsage?.currency
    || hold?.currency
    || capture?.currency
    || 'USD'
  const sourceType = ratedUsage?.id || ratedUsage?.ratedUsageId ? 'RATED_USAGE' : 'HOLD'
  const sourceId = ratedUsage?.id || ratedUsage?.ratedUsageId || hold?.id || hold?.holdId
  const postpaid = Boolean(
    hold?.postpaid
    || capture?.postpaid
    || ratedUsage?.postpaid
    || capture?.mode === 'postpaid',
  )
  const recognized = event(
    'REVENUE_RECOGNIZED',
    amount,
    currency,
    sourceType,
    sourceId,
    `capture:${capture?.id || capture?.txId || 'none'}`,
    policy,
  )
  if (!postpaid) return pack([recognized])
  return pack([
    recognized,
    event(
      'RECEIVABLE_CREATED',
      amount,
      currency,
      sourceType,
      sourceId,
      `postpaid-capture:${capture?.id || capture?.txId || 'none'}`,
      policy,
    ),
  ])
}

export function evaluateExpiry(lot, policyDefinition) {
  const policy = normalizePolicy(policyDefinition)
  const granted = asMinor(lot?.granted_units ?? lot?.grantedUnits)
  const remaining = asMinor(lot?.remaining_units ?? lot?.remainingUnits)
  const consideration = asMinor(lot?.consideration_minor ?? lot?.considerationMinor)
  if (consideration <= 0n || granted <= 0n || remaining <= 0n) {
    return pack([])
  }
  const breakageMinor = (consideration * remaining) / granted
  const sourceId = lot?.id || lot?.lotId
  if (policy.breakage === 'PROPORTIONAL_EXPECTED_BREAKAGE') {
    return pack([], [{
      sourceType: 'LOT',
      sourceId,
      obligationKey: 'BREAKAGE',
      amountMinor: minorString(breakageMinor),
      recognition: 'PROPORTIONAL_EXPECTED_BREAKAGE',
    }], [{
      amountMinor: minorString(breakageMinor),
      recognitionAt: lot?.expires_at || lot?.expiresAt || null,
      recognizedAmountMinor: '0',
      status: 'PENDING',
    }])
  }
  return pack([
    event(
      'BREAKAGE_RECOGNIZED',
      breakageMinor,
      lot?.currency || 'USD',
      'LOT',
      sourceId,
      `expiry:${lot?.id || lot?.lotId}`,
      policy,
    ),
  ])
}

export function evaluateRefund(purchase, refundTx, policyDefinition) {
  const policy = normalizePolicy(policyDefinition)
  const recognized = asMinor(purchase?.recognized_minor ?? purchase?.recognizedMinor)
  const requested = asMinor(purchase?.refund_minor ?? purchase?.refundMinor ?? refundTx?.amountMinor)
  // Revenue reversal is independent of lot remaining_units (DL-144). Fully
  // consumed purchases still reverse min(requested, recognized).
  const amount = requested < recognized ? requested : recognized
  if (amount <= 0n) return pack([])
  return {
    events: [{
      eventKind: 'REFUND_REVENUE_REVERSED',
      amountMinor: minorString(amount),
      currency: purchase?.currency || 'USD',
      sourceType: purchase?.sourceType || 'PURCHASE_INTENT',
      sourceId: purchase?.id || purchase?.purchaseId || purchase?.intentId,
      memo: `refund:${refundTx?.id || refundTx?.txId || 'none'}`,
      accountCode: policy.accounts.REFUND_REVENUE_REVERSED || 'REVENUE',
    }],
    groups: [],
    lines: [],
  }
}

export function evaluatePostpaidCapture(reservation, captureTx, ratedUsage, policyDefinition) {
  const policy = normalizePolicy(policyDefinition)
  const amount = asMinor(
    ratedUsage?.amount_minor
    ?? ratedUsage?.amountMinor
    ?? reservation?.reserved_minor
    ?? reservation?.reservedMinor
    ?? captureTx?.amountMinor,
  )
  const currency = reservation?.currency || ratedUsage?.currency || 'USD'
  const sourceId = reservation?.id || reservation?.reservationId
  return pack([
    event(
      'RECEIVABLE_CREATED',
      amount,
      currency,
      'FACILITY_RESERVATION',
      sourceId,
      `facility-capture:${captureTx?.id || captureTx?.txId || 'none'}`,
      policy,
    ),
    event(
      'REVENUE_RECOGNIZED',
      amount,
      currency,
      'FACILITY_RESERVATION',
      sourceId,
      `facility-capture:${captureTx?.id || captureTx?.txId || 'none'}`,
      policy,
    ),
  ], [{
    sourceType: 'FACILITY_RESERVATION',
    sourceId,
    obligationKey: 'DEFAULT',
    amountMinor: minorString(amount),
    recognition: 'ON_CONSUMPTION',
  }], [{
    amountMinor: minorString(amount),
    recognitionAt: null,
    recognizedAmountMinor: minorString(amount),
    status: 'RECOGNIZED',
  }])
}

export function evaluateWriteOff(invoice, policyDefinition) {
  const policy = normalizePolicy(policyDefinition)
  const amount = asMinor(invoice?.amount_minor ?? invoice?.amountMinor ?? invoice?.total_minor)
  return pack([
    event(
      'BAD_DEBT_WRITE_OFF',
      amount,
      invoice?.currency || 'USD',
      'INVOICE',
      invoice?.id || invoice?.invoiceId,
      'credit-loss; not a revenue reversal (spec §73)',
      policy,
    ),
  ])
}
