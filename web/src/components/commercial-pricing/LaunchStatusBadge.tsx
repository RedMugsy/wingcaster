import { Badge } from '@/components/ui/badge'
import { cn } from '@/lib/utils'
import { LAUNCH_STATUS_CLASSES, LAUNCH_STATUS_LABELS } from './helpers'
import type { LaunchStatus } from '@/types/commercialPricing'

interface LaunchStatusBadgeProps {
  status: LaunchStatus
  className?: string
}

export function LaunchStatusBadge({ status, className }: LaunchStatusBadgeProps) {
  return (
    <Badge variant="outline" className={cn(LAUNCH_STATUS_CLASSES[status], className)}>
      {LAUNCH_STATUS_LABELS[status]}
    </Badge>
  )
}
