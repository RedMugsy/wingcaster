interface UsageChartProps {
  data: { label: string; value: number }[]
  title?: string
}

export function UsageChart({ data, title }: UsageChartProps) {
  const max = Math.max(1, ...data.map((d) => d.value))
  return (
    <div className="space-y-2">
      {title && <h4 className="text-sm font-semibold">{title}</h4>}
      {data.length === 0 && <p className="text-sm text-muted-foreground">No data yet.</p>}
      {data.map((d) => (
        <div key={d.label} className="flex items-center gap-2">
          <span className="w-24 shrink-0 text-xs text-muted-foreground">{d.label}</span>
          <div className="h-4 flex-1 rounded bg-muted">
            <div
              className="h-4 rounded bg-primary"
              style={{ width: `${Math.round((d.value / max) * 100)}%` }}
              aria-label={`${d.label}: ${d.value}`}
            />
          </div>
          <span className="w-8 text-right text-xs font-medium">{d.value}</span>
        </div>
      ))}
    </div>
  )
}
