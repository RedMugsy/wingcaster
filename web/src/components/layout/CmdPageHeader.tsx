/**
 * CmdPageHeader — Standard Command Center page header.
 * Title + subtitle + right-side action slot.
 */
import type { ReactNode } from 'react'

interface CmdPageHeaderProps {
  title: string
  subtitle?: string
  actions?: ReactNode
}

export function CmdPageHeader({ title, subtitle, actions }: CmdPageHeaderProps) {
  return (
    <div className="flex h-14 shrink-0 items-center justify-between border-b border-[#E4E3E0] bg-white px-6">
      <div className="flex items-center gap-3">
        <h1 className="text-base font-semibold leading-none">{title}</h1>
        {subtitle && (
          <span className="hidden text-sm text-muted-foreground sm:inline">{subtitle}</span>
        )}
      </div>
      {actions && <div className="flex items-center gap-2">{actions}</div>}
    </div>
  )
}
