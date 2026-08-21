/**
 * Spec §107 exception types — frozen 18-key list.
 * Each type is a read-side queue. Resolve commands that do not yet exist
 * return 501 from the write surface (DL-165..DL-169).
 */
import { query } from '../../db.js'

export const EXCEPTION_TYPES = Object.freeze([
  { type: 'RECONCILIATION_DRIFT', dl: null, resolve: 'resolveDrift' },
  { type: 'USAGE_DLQ', dl: 'DL-165', resolve: null },
  { type: 'AUTH_DENIED', dl: 'DL-165', resolve: null },
  { type: 'HOLD_EXPIRED', dl: 'DL-165', resolve: null },
  { type: 'LATE_USAGE', dl: 'DL-165', resolve: null },
  { type: 'DUNNING_OPEN', dl: null, resolve: 'advanceDunning' },
  { type: 'INVOICE_OVERDUE', dl: null, resolve: 'advanceDunning' },
  { type: 'PAYMENT_UNAPPLIED', dl: null, resolve: 'applyPayment' },
  { type: 'APPROVAL_PENDING', dl: 'DL-166', resolve: null },
  { type: 'RATE_NOT_CONFIGURED', dl: 'DL-168', resolve: null },
  { type: 'PERIOD_CLOSE_BLOCKED', dl: null, resolve: 'advanceBillingPeriodClose' },
  { type: 'ENV_ISOLATION', dl: 'DL-165', resolve: null },
  { type: 'IDEMPOTENCY_IN_FLIGHT', dl: 'DL-165', resolve: null },
  { type: 'TAX_MISMATCH', dl: 'DL-169', resolve: null },
  { type: 'ACCOUNTING_HARD_CLOSED', dl: 'DL-165', resolve: null },
  { type: 'FACILITY_LIMIT', dl: null, resolve: 'amendFacilityLimit' },
  { type: 'VENDOR_STATEMENT_DRIFT', dl: 'DL-167', resolve: null },
  { type: 'NEGATIVE_MARGIN', dl: 'DL-167', resolve: null },
])

function n(value) {
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : 0
}

async function count(sql, params) {
  try {
    const rows = await query(sql, params)
    return n(rows?.[0]?.qty)
  } catch {
    return 0
  }
}

export async function loadExceptions({ environment }) {
  const env = environment || 'LIVE'
  const counts = {
    RECONCILIATION_DRIFT: await count(
      `SELECT COUNT(*)::bigint AS qty FROM fin.reconciliation_resolution
        WHERE environment = $1 AND resolved_at IS NULL`,
      [env],
    ),
    USAGE_DLQ: await count(
      `SELECT COUNT(*)::bigint AS qty FROM fin.usage_events_dlq
        WHERE environment = $1`,
      [env],
    ),
    AUTH_DENIED: await count(
      `SELECT COUNT(*)::bigint AS qty FROM fin.authorization_attempts
        WHERE environment = $1 AND result = 'DENIED'`,
      [env],
    ),
    HOLD_EXPIRED: await count(
      `SELECT COUNT(*)::bigint AS qty FROM fin.holds
        WHERE environment = $1 AND status = 'EXPIRED'`,
      [env],
    ),
    LATE_USAGE: await count(
      `SELECT COUNT(*)::bigint AS qty FROM fin.rated_usage
        WHERE environment = $1 AND late_class IN ('POST_INVOICE', 'CLOSED_ACCOUNTING')`,
      [env],
    ),
    DUNNING_OPEN: await count(
      `SELECT COUNT(*)::bigint AS qty FROM fin.dunning_cases
        WHERE environment = $1
          AND status NOT IN ('CURED', 'WRITTEN_OFF', 'CANCELED')`,
      [env],
    ),
    INVOICE_OVERDUE: await count(
      `SELECT COUNT(*)::bigint AS qty FROM fin.invoices
        WHERE environment = $1 AND status IN ('ISSUED', 'PART_PAID')
          AND due_at IS NOT NULL AND due_at < NOW()`,
      [env],
    ),
    PAYMENT_UNAPPLIED: await count(
      `SELECT COUNT(*)::bigint AS qty FROM fin.unapplied_cash
        WHERE environment = $1 AND balance_minor > 0`,
      [env],
    ),
    APPROVAL_PENDING: await count(
      `SELECT COUNT(*)::bigint AS qty FROM fin.approval_requests
        WHERE environment = $1 AND status = 'REQUESTED'`,
      [env],
    ),
    RATE_NOT_CONFIGURED: 0,
    PERIOD_CLOSE_BLOCKED: await count(
      `SELECT COUNT(*)::bigint AS qty FROM fin.billing_periods
        WHERE environment = $1 AND status NOT IN ('OPEN', 'FINAL')`,
      [env],
    ),
    ENV_ISOLATION: await count(
      `SELECT COUNT(*)::bigint AS qty FROM fin.reconciliation_checks
        WHERE environment = $1 AND check_code IN ('R016', 'R090') AND result = 'DRIFT'`,
      [env],
    ),
    IDEMPOTENCY_IN_FLIGHT: await count(
      `SELECT COUNT(*)::bigint AS qty FROM fin.idempotency_keys
        WHERE environment = $1 AND status = 'IN_FLIGHT'`,
      [env],
    ),
    TAX_MISMATCH: await count(
      `SELECT COUNT(*)::bigint AS qty FROM fin.reconciliation_checks
        WHERE environment = $1 AND check_code = 'R073' AND result = 'DRIFT'`,
      [env],
    ),
    ACCOUNTING_HARD_CLOSED: await count(
      `SELECT COUNT(*)::bigint AS qty FROM fin.accounting_periods
        WHERE environment = $1 AND status = 'HARD_CLOSED'`,
      [env],
    ),
    FACILITY_LIMIT: await count(
      `SELECT COUNT(*)::bigint AS qty FROM fin.authorization_attempts
        WHERE environment = $1 AND denial_code = 'FACILITY_LIMIT_EXCEEDED'`,
      [env],
    ),
    VENDOR_STATEMENT_DRIFT: 0,
    NEGATIVE_MARGIN: 0,
  }

  return {
    environment: env,
    types: EXCEPTION_TYPES.map((row) => ({
      ...row,
      count: counts[row.type] ?? 0,
      deferred: Boolean(row.dl && !row.resolve),
    })),
  }
}

export function deferredExceptionPayload(type) {
  const row = EXCEPTION_TYPES.find((item) => item.type === type)
  if (!row?.dl) return null
  return {
    code: 'NOT_IMPLEMENTED',
    dl: row.dl,
    exception_type: type,
    error: `${type} has no domain command yet (${row.dl})`,
  }
}
