/**
 * Shared template helpers — text sanitisation, price formatting, truncation.
 * Kept in one place so the three templates share the same normalisation.
 */

export function escapeXml(input) {
  return String(input || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;')
}

export function safeText(input) {
  return String(input || '').replace(/[\r\n\t]+/g, ' ').trim()
}

export function truncate(input, max) {
  const s = safeText(input)
  return s.length <= max ? s : `${s.slice(0, Math.max(0, max - 1))}…`
}

export function formatPrice(value, unit = 'USD') {
  if (value == null || Number.isNaN(Number(value))) return ''
  const n = Number(value)
  const currency = unit || 'USD'
  if (n >= 1_000_000) return `${currency} ${(n / 1_000_000).toFixed(2)}M`
  if (n >= 1_000) return `${currency} ${Math.round(n / 1_000)}K`
  return `${currency} ${n.toLocaleString()}`
}
