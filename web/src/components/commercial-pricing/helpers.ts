import type { LaunchStatus } from '../../types/commercialPricing'

export function isValidMultiplier(n: number, min: number, max: number): boolean {
  return Number.isFinite(n) && n >= min && n <= max
}

export function multiplierHint(parsed: number, min: number, max: number): string {
  return isValidMultiplier(parsed, min, max)
    ? `${Math.round(parsed * 100)}% of base rate`
    : 'Enter a valid multiplier'
}

export const LAUNCH_STATUS_CLASSES: Record<LaunchStatus, string> = {
  launched: 'bg-emerald-500/15 text-emerald-700 border-emerald-500/30',
  planned: 'bg-slate-500/15 text-slate-700 border-slate-500/30',
  blocked: 'bg-amber-500/15 text-amber-700 border-amber-500/30',
  sunset: 'bg-rose-500/15 text-rose-700 border-rose-500/30',
}

export const LAUNCH_STATUS_LABELS: Record<LaunchStatus, string> = {
  launched: 'Launched',
  planned: 'Planned',
  blocked: 'Blocked',
  sunset: 'Sunset',
}

export const PREVIEW_ACTIONS: Array<{ key: string; label: string }> = [
  { key: 'publish.meta.facebook', label: 'Facebook publish' },
  { key: 'publish.x.link', label: 'X (link)' },
  { key: 'message.out.whatsapp.utility', label: 'WhatsApp utility' },
  { key: 'render.template.premium', label: 'Premium template render' },
  { key: 'avm.report', label: 'AVM report' },
]

export function formatCurrencyMinor(minor: number, currency: string | null = 'USD'): string {
  const value = minor / 100
  const code = currency || 'USD'
  const digits = value < 1 ? 4 : 2
  return `${code} ${value.toFixed(digits)}`
}
