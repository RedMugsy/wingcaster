/**
 * CmdEmptyState — Standardized empty state used across all CRM pages.
 */
import type { ReactNode } from 'react'
import { cn } from '@/lib/utils'

interface CmdEmptyStateProps {
  icon: ReactNode
  title: string
  description?: string
  action?: ReactNode
  className?: string
}

export function CmdEmptyState({ icon, title, description, action, className }: CmdEmptyStateProps) {
  return (
    <div className={cn('flex flex-col items-center justify-center py-20 text-center', className)}>
      <span className="mb-4 rounded-xl bg-muted p-4 text-muted-foreground">{icon}</span>
      <h3 className="text-base font-semibold">{title}</h3>
      {description && <p className="mt-1.5 max-w-xs text-sm text-muted-foreground">{description}</p>}
      {action && <div className="mt-5">{action}</div>}
    </div>
  )
}
