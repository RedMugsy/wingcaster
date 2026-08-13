import { BarChart3, TrendingUp, AlertCircle } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'

interface MarketContextCardProps {
  analysis: any
  onViewComparables?: () => void
}

function formatPrice(value: number | null | undefined) {
  if (value == null || Number.isNaN(value)) return 'N/A'
  const num = Number(value)
  if (num >= 1_000_000) return `$${(num / 1_000_000).toFixed(2)}M`
  if (num >= 1_000) return `$${(num / 1_000).toFixed(0)}K`
  return `$${num.toLocaleString()}`
}

export function MarketContextCard({ analysis, onViewComparables }: MarketContextCardProps) {
  if (!analysis) {
    return (
      <div className="rounded-xl border bg-white p-5">
        <div className="flex items-center gap-2 text-muted-foreground">
          <BarChart3 className="h-5 w-5" />
          <span className="text-sm">Market analysis not available.</span>
        </div>
      </div>
    )
  }

  const confidenceColor =
    analysis.confidence === 'high' ? 'bg-green-100 text-green-700' :
    analysis.confidence === 'medium' ? 'bg-yellow-100 text-yellow-700' :
    'bg-red-100 text-red-700'

  const position = analysis.target_vs_median
  const positionText = position === 'above' ? 'Above median' : position === 'below' ? 'Below median' : 'At median'
  const positionColor = position === 'above' ? 'text-red-600' : position === 'below' ? 'text-green-600' : 'text-blue-600'

  return (
    <div className="rounded-xl border bg-white p-5 shadow-sm">
      <div className="mb-3 flex items-center justify-between">
        <h3 className="font-semibold flex items-center gap-2">
          <BarChart3 className="h-5 w-5 text-primary" />
          Market Context
        </h3>
        <Badge className={confidenceColor}>
          {analysis.confidence || 'low'} confidence
        </Badge>
      </div>

      {analysis.comparable_count > 0 ? (
        <div className="space-y-3">
          <div className="flex items-end gap-2">
            <span className="text-2xl font-bold">
              {formatPrice(analysis.lowest_price)} – {formatPrice(analysis.highest_price)}
            </span>
            <span className="text-sm text-muted-foreground mb-1">comparable range</span>
          </div>

          <div className="grid grid-cols-2 gap-3 text-sm">
            <div className="rounded-lg bg-muted/50 p-3">
              <p className="text-muted-foreground">Median</p>
              <p className="font-semibold">{formatPrice(analysis.median_price)}</p>
            </div>
            <div className="rounded-lg bg-muted/50 p-3">
              <p className="text-muted-foreground">Your price</p>
              <p className={`font-semibold ${positionColor}`}>
                {positionText}
              </p>
            </div>
          </div>

          <p className="text-xs text-muted-foreground">
            Based on {analysis.comparable_count} similar property{analysis.comparable_count === 1 ? '' : 'ies'}.
          </p>

          {onViewComparables && (
            <Button variant="outline" size="sm" className="w-full" onClick={onViewComparables}>
              View comparables
            </Button>
          )}
        </div>
      ) : (
        <div className="space-y-3">
          <div className="flex items-center gap-2 text-amber-600">
            <AlertCircle className="h-5 w-5" />
            <span className="text-sm font-medium">Low comparable data</span>
          </div>
          <p className="text-sm text-muted-foreground">
            {analysis.confidence_reason || 'Not enough similar listings in this area to provide a reliable range.'}
          </p>
        </div>
      )}
    </div>
  )
}
