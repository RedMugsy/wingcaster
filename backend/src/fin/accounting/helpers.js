import { CATEGORY, finError } from '../errors.js'

export const EVENT_KINDS = [
  'DEFERRED_REVENUE_CREATED',
  'REVENUE_RECOGNIZED',
  'RECEIVABLE_CREATED',
  'BREAKAGE_RECOGNIZED',
  'BAD_DEBT_WRITE_OFF',
  'REFUND_REVENUE_REVERSED',
  'TRANSFER_INTERNAL',
  'ADJUSTMENT_REVENUE',
  'FX_REMEASUREMENT',
  'TAX_ACCRUED',
  'CONSIDERATION_ALLOCATED',
]

export const SOURCE_TYPES = [
  'PURCHASE_INTENT', 'HOLD', 'FACILITY_RESERVATION',
  'LOT', 'INVOICE', 'RATED_USAGE',
]

export function asMinor(value) {
  if (value == null || value === '') return 0n
  return BigInt(value)
}

export function minorString(value) {
  return asMinor(value).toString()
}

export function mapAccountingPgError(error) {
  const message = String(error?.message || '')
  const codes = [
    'ACCOUNTING_PERIOD_HARD_CLOSED',
    'ACCOUNTING_PERIOD_NOT_FOUND',
    'ACCOUNTING_PERIOD_SKIP_TO_HARD',
    'ACCOUNTING_PERIOD_CANNOT_FULLY_REOPEN',
    'ACCOUNTING_PERIOD_REOPEN_WITHOUT_APPROVAL',
    'ACCOUNTING_EVENT_OUTSIDE_PERIOD',
  ]
  for (const code of codes) {
    if (message.includes(code)) {
      return finError(code, { category: CATEGORY.PRECONDITION, httpStatus: 409 })
    }
  }
  return error
}

export function requireEventKind(eventKind) {
  if (!EVENT_KINDS.includes(eventKind)) {
    throw finError('REASON_CODE_REQUIRED', {
      category: CATEGORY.VALIDATION,
      details: { reason: 'unknown_event_kind', eventKind },
    })
  }
}

export function requireSourceType(sourceType) {
  if (!SOURCE_TYPES.includes(sourceType)) {
    throw finError('REASON_CODE_REQUIRED', {
      category: CATEGORY.VALIDATION,
      details: { reason: 'unknown_source_type', sourceType },
    })
  }
}
