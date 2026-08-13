/**
 * CmdKpiStrip — Compact KPI bar for Command Center pages.
 * Accepts up to 5 stat cards rendered as a horizontal strip.
 */
import type { ReactNode } from 'react'
import { cn } from '@/lib/utils'

interface KpiItem {
  label: string
  value: ReactNode
  /** e.g. 'text-red-600' to highlight urgent counts */
  valueClass?: string
  icon?: ReactNode
}

interface CmdKpiStripProps {
  items: KpiItem[]
}

export function CmdKpiStrip({ items }: CmdKpiStripProps) {
  return (
    <div className="flex shrink-0 divide-x divide-[#E4E3E0] border-b border-[#E4E3E0] bg-white">
      {items.map((item, i) => (
        <div key={i} className="flex flex-1 items-center gap-3 px-5 py-3">
          {item.icon && (
            <span className="shrink-0 rounded-md bg-[#F0EFED] p-1.5">{item.icon}</span>
          )}
          <div className="min-w-0">
            <p className={cn('text-xl font-bold leading-none', item.valueClass)}>{item.value}</p>
            <p className="mt-0.5 truncate text-[11px] text-muted-foreground">{item.label}</p>
          </div>
        </div>
      ))}
    </div>
  )
}
