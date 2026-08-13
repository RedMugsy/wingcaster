export function formatStat(n: number): string {
  if (n >= 1000000) return `${(n / 1000000).toFixed(1)}M`
  if (n >= 1000) return `${(n / 1000).toFixed(1)}K`
  return String(n)
}

export function formatPrice(price: number, type: 'sale' | 'rent', unit?: string): string {
  if (type === 'sale') {
    if (price >= 1000000) return `$${(price / 1000000).toFixed(1)}M`
    return `$${(price / 1000).toFixed(0)}K`
  }
  return `$${price.toLocaleString()}/${unit === 'month' ? 'mo' : 'yr'}`
}
