import type {
  CreditNoteStatus,
  CreditNoteType,
  ProductStatus,
  SubscriptionStatus,
  TierStatus,
} from '../../types/commercialPricing'

export const SUBSCRIPTION_STATUS_CLASSES: Record<SubscriptionStatus, string> = {
  trialing: 'bg-indigo-500/15 text-indigo-700 border-indigo-500/30',
  active: 'bg-emerald-500/15 text-emerald-700 border-emerald-500/30',
  past_due: 'bg-amber-500/15 text-amber-700 border-amber-500/30',
  paused: 'bg-slate-500/15 text-slate-700 border-slate-500/30',
  cancelled: 'bg-rose-500/15 text-rose-700 border-rose-500/30',
  expired: 'bg-neutral-500/15 text-neutral-700 border-neutral-500/30',
}

export const SUBSCRIPTION_STATUS_LABELS: Record<SubscriptionStatus, string> = {
  trialing: 'Trialing',
  active: 'Active',
  past_due: 'Past due',
  paused: 'Paused',
  cancelled: 'Cancelled',
  expired: 'Expired',
}

export const PRODUCT_STATUS_CLASSES: Record<ProductStatus, string> = {
  draft: 'bg-slate-500/15 text-slate-700 border-slate-500/30',
  active: 'bg-emerald-500/15 text-emerald-700 border-emerald-500/30',
  deprecated: 'bg-amber-500/15 text-amber-700 border-amber-500/30',
  retired: 'bg-neutral-500/15 text-neutral-700 border-neutral-500/30',
}

export const PRODUCT_STATUS_LABELS: Record<ProductStatus, string> = {
  draft: 'Draft',
  active: 'Active',
  deprecated: 'Deprecated',
  retired: 'Retired',
}

export const TIER_STATUS_CLASSES: Record<TierStatus, string> = PRODUCT_STATUS_CLASSES
export const TIER_STATUS_LABELS: Record<TierStatus, string> = PRODUCT_STATUS_LABELS

export const CREDIT_NOTE_STATUS_CLASSES: Record<CreditNoteStatus, string> = {
  pending: 'bg-indigo-500/15 text-indigo-700 border-indigo-500/30',
  applied: 'bg-emerald-500/15 text-emerald-700 border-emerald-500/30',
  expired: 'bg-neutral-500/15 text-neutral-700 border-neutral-500/30',
  voided: 'bg-rose-500/15 text-rose-700 border-rose-500/30',
}

export const CREDIT_NOTE_STATUS_LABELS: Record<CreditNoteStatus, string> = {
  pending: 'Pending',
  applied: 'Applied',
  expired: 'Expired',
  voided: 'Voided',
}

export const CREDIT_NOTE_TYPE_LABELS: Record<CreditNoteType, string> = {
  proration_credit: 'Proration credit',
  proration_debit: 'Proration debit',
  refund: 'Refund',
  courtesy: 'Courtesy',
  promo: 'Promo',
  manual_adjustment: 'Manual adjustment',
}

export function formatMoneyMinor(minor: number | null | undefined, currency: string | null = 'USD'): string {
  if (minor == null) return '—'
  const value = Number(minor) / 100
  const code = currency || 'USD'
  const digits = Math.abs(value) < 1 && value !== 0 ? 4 : 2
  const sign = value < 0 ? '−' : ''
  return `${sign}${code} ${Math.abs(value).toFixed(digits)}`
}

/**
 * Signed formatter for credit-note tables. Positive → "credit" (owed to
 * tenant); negative → "owed" (owed by tenant). Sign shown explicitly.
 */
export function formatCreditNoteAmount(minor: number, currency: string): { text: string; direction: 'credit' | 'debit' | 'zero' } {
  if (!minor) return { text: `${currency} 0.00`, direction: 'zero' }
  const abs = Math.abs(minor) / 100
  const digits = abs < 1 ? 4 : 2
  const formatted = `${currency} ${abs.toFixed(digits)}`
  return {
    text: minor > 0 ? `+${formatted}` : `−${formatted}`,
    direction: minor > 0 ? 'credit' : 'debit',
  }
}

export function formatRelativeIso(iso: string | null | undefined): string {
  if (!iso) return '—'
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return '—'
  return date.toLocaleString(undefined, {
    dateStyle: 'medium',
    timeStyle: 'short',
  })
}

export function formatShortIso(iso: string | null | undefined): string {
  if (!iso) return '—'
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return '—'
  return date.toLocaleDateString(undefined, { dateStyle: 'medium' })
}

/**
 * Whole days from `now` until `iso`. Returns null when iso is invalid,
 * null/undefined, or already past. Rounded up (a 12-hour remainder still
 * reads as 1 day left, matching the "your trial ends in N day(s)" UX).
 */
export function daysUntilIso(iso: string | null | undefined, now: Date = new Date()): number | null {
  if (!iso) return null
  const target = new Date(iso).getTime()
  if (Number.isNaN(target)) return null
  const ms = target - now.getTime()
  if (ms <= 0) return null
  return Math.ceil(ms / (24 * 60 * 60 * 1000))
}

/**
 * Compute how many minor units per DAY a plan costs, given period bounds.
 * Used by the admin subscription-detail proration preview.
 */
export function dailyRateMinor(priceMinor: number | null | undefined, periodStartIso: string | null, periodEndIso: string | null): number | null {
  if (priceMinor == null || !periodStartIso || !periodEndIso) return null
  const start = new Date(periodStartIso).getTime()
  const end = new Date(periodEndIso).getTime()
  const days = (end - start) / (24 * 60 * 60 * 1000)
  if (!(days > 0)) return null
  return Math.round(Number(priceMinor) / days)
}

/**
 * Which subscription actions the current status permits. Drives which
 * buttons the admin detail page shows enabled.
 */
export function permittedActions(status: SubscriptionStatus): {
  cancel: boolean
  expire: boolean
  markPastDue: boolean
  resolvePastDue: boolean
  pause: boolean
  resume: boolean
  migrate: boolean
} {
  return {
    cancel: ['trialing', 'active', 'past_due', 'paused'].includes(status),
    expire: status !== 'expired',
    markPastDue: ['trialing', 'active'].includes(status),
    resolvePastDue: status === 'past_due',
    pause: status === 'active',
    resume: status === 'paused',
    migrate: ['trialing', 'active', 'past_due', 'paused'].includes(status),
  }
}
