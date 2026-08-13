import { ArrowUpRight, ArrowDownRight, Minus } from 'lucide-react'

interface TrendMiniChartProps {
  snapshots: any[]
}

function formatPrice(value: number | null | undefined) {
  if (value == null || Number.isNaN(value)) return 'N/A'
  const num = Number(value)
  if (num >= 1_000_000) return `$${(num / 1_000_000).toFixed(1)}M`
  if (num >= 1_000) return `$${(num / 1_000).toFixed(0)}K`
  return `$${num.toLocaleString()}`
}

function formatChange(value: number | null | undefined) {
  if (value == null || Number.isNaN(value)) return null
  const num = Number(value)
  const sign = num > 0 ? '+' : ''
  return `${sign}${num.toFixed(1)}%`
}

export function TrendMiniChart({ snapshots }: TrendMiniChartProps) {
  if (!snapshots || snapshots.length === 0) {
    return <p className="text-sm text-muted-foreground">No trend data available.</p>
  }

  const values = snapshots.map((s) => Number(s.median_price || 0)).filter((v) => v > 0)
  if (values.length === 0) {
    return <p className="text-sm text-muted-foreground">No median price data to display.</p>
  }

  const max = Math.max(...values)
  const min = Math.min(...values)
  const range = max - min || 1

  return (
    <div className="space-y-2">
      <div className="flex h-32 items-end justify-between gap-1">
        {snapshots.map((s, i) => {
          const val = Number(s.median_price || 0)
          const height = val > 0 ? Math.max(((val - min) / range) * 100, 5) : 0
          const label = `${s.year}-Q${s.quarter}`
          const change = formatChange(s.change_from_prev_quarter_percent)
          const changeNum = Number(s.change_from_prev_quarter_percent || 0)
          const changeColor = changeNum > 0 ? 'text-green-600' : changeNum < 0 ? 'text-red-600' : 'text-muted-foreground'
          const ChangeIcon = changeNum > 0 ? ArrowUpRight : changeNum < 0 ? ArrowDownRight : Minus

          return (
            <div key={i} className="group flex flex-1 flex-col items-center gap-1">
              <div className="relative w-full">
                <div
                  className="w-full rounded-t bg-primary/80 transition-all group-hover:bg-primary"
                  style={{ height: `${height}%` }}
                />
                <div className="absolute -top-10 left-1/2 hidden -translate-x-1/2 whitespace-nowrap rounded bg-black px-2 py-1 text-xs text-white group-hover:block">
                  {formatPrice(val)}
                </div>
              </div>
              <span className="text-[10px] text-muted-foreground">{label}</span>
              {change ? (
                <div className={`flex items-center gap-0.5 text-[10px] font-medium ${changeColor}`}>
                  <ChangeIcon className="h-3 w-3" />
                  {change}
                </div>
              ) : (
                <span className="text-[10px] text-muted-foreground">—</span>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}
