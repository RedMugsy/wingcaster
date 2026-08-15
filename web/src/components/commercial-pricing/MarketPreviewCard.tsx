import { useEffect, useState } from 'react'
import { api } from '@/api/client'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { PREVIEW_ACTIONS, formatCurrencyMinor } from './helpers'
import type { MarketContext } from '@/types/commercialPricing'

interface MarketPreviewCardProps {
  territoryId?: string
  zoneId?: string
  city?: string
  countryCode?: string
}

interface Row {
  action: string
  label: string
  casts: number
  priceMinor: number
}

export function MarketPreviewCard({ territoryId, zoneId, city, countryCode }: MarketPreviewCardProps) {
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [context, setContext] = useState<MarketContext | null>(null)
  const [effectiveCastValue, setEffectiveCastValue] = useState<number | null>(null)
  const [rows, setRows] = useState<Row[]>([])

  useEffect(() => {
    let cancelled = false
    setError(null)
    if (!territoryId && !zoneId && !city && !countryCode) {
      setContext(null)
      setRows([])
      setEffectiveCastValue(null)
      return
    }
    setLoading(true)
    const timer = setTimeout(async () => {
      try {
        const first = await api.previewCommercialPrice({
          territory_id: territoryId,
          zone_id: zoneId,
          city,
          country_code: countryCode,
          action_key: PREVIEW_ACTIONS[0].key,
          quantity: 1,
        })
        if (cancelled) return
        setContext(first.context)
        setEffectiveCastValue(first.price.effective_cast_value_minor)

        const rest = await Promise.all(
          PREVIEW_ACTIONS.slice(1).map(async (a) => {
            const result = await api.previewCommercialPrice({
              territory_id: territoryId,
              zone_id: zoneId,
              city,
              country_code: countryCode,
              action_key: a.key,
              quantity: 1,
            })
            return { action: a.key, label: a.label, casts: result.price.casts_charged, priceMinor: result.price.price_minor }
          }),
        )
        if (cancelled) return
        setRows([
          { action: PREVIEW_ACTIONS[0].key, label: PREVIEW_ACTIONS[0].label, casts: first.price.casts_charged, priceMinor: first.price.price_minor },
          ...rest,
        ])
      } catch (err: any) {
        if (!cancelled) setError(err?.message || 'Failed to load preview')
      } finally {
        if (!cancelled) setLoading(false)
      }
    }, 300)
    return () => {
      cancelled = true
      clearTimeout(timer)
    }
  }, [territoryId, zoneId, city, countryCode])

  const currency = context?.territory?.currency || 'USD'

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-sm">Market preview</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3 text-sm">
        {loading ? (
          <p className="text-muted-foreground">Loading…</p>
        ) : error ? (
          <p className="text-red-700">{error}</p>
        ) : !context ? (
          <p className="text-muted-foreground">Pick a market to preview effective pricing.</p>
        ) : (
          <>
            <div className="space-y-0.5">
              <div className="font-medium">
                {context.territory?.name || context.territory?.code || '—'}
                {context.zone ? <span className="text-muted-foreground"> · {context.zone.name}</span> : null}
              </div>
              <div className="text-xs text-muted-foreground">
                Source: {context.source}
                {effectiveCastValue != null ? (
                  <>
                    <span className="mx-1">·</span>
                    Effective cast value {formatCurrencyMinor(effectiveCastValue, currency)}
                  </>
                ) : null}
              </div>
            </div>
            <table className="w-full text-xs">
              <thead>
                <tr className="text-left text-muted-foreground">
                  <th className="py-1 font-normal">Action</th>
                  <th className="py-1 pr-1 text-right font-normal">Casts</th>
                  <th className="py-1 text-right font-normal">Price</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <tr key={row.action} className="border-t border-border/50">
                    <td className="py-1">{row.label}</td>
                    <td className="py-1 pr-1 text-right tabular-nums">{row.casts}</td>
                    <td className="py-1 text-right tabular-nums">{formatCurrencyMinor(row.priceMinor, currency)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </>
        )}
      </CardContent>
    </Card>
  )
}
