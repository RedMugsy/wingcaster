type BarItem = { label: string; value: number; id?: string }

export function HorizontalBarChart({
  items,
  onSelect,
  valueSuffix = '',
  emptyLabel = 'No data yet',
}: {
  items: BarItem[]
  onSelect?: (item: BarItem) => void
  valueSuffix?: string
  emptyLabel?: string
}) {
  const max = Math.max(...items.map((i) => i.value), 1)
  if (!items.length) {
    return <p className="py-6 text-center text-sm text-muted-foreground">{emptyLabel}</p>
  }
  return (
    <div className="space-y-3">
      {items.map((item) => {
        const pct = Math.round((item.value / max) * 100)
        const clickable = !!onSelect
        const RowTag = clickable ? 'button' : 'div'
        return (
          <RowTag
            key={item.id || item.label}
            {...(clickable ? { type: 'button' as const, onClick: () => onSelect?.(item) } : {})}
            className={`w-full text-left ${clickable ? 'group rounded-md p-1 -mx-1 hover:bg-muted/50 transition-colors' : ''}`}
          >
            <div className="mb-1 flex items-center justify-between gap-3 text-sm">
              <span className={`truncate font-medium ${clickable ? 'group-hover:underline' : ''}`}>{item.label}</span>
              <span className="shrink-0 tabular-nums text-muted-foreground">
                {item.value.toLocaleString()}
                {valueSuffix}
              </span>
            </div>
            <div className="h-2.5 overflow-hidden rounded-full bg-muted">
              <div
                className="h-full rounded-full bg-[#0F0F0F] transition-all duration-500"
                style={{ width: `${pct}%` }}
              />
            </div>
          </RowTag>
        )
      })}
    </div>
  )
}
