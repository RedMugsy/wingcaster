import { Badge } from '@/components/ui/badge'
import { cn } from '@/lib/utils'
import { SUBSCRIPTION_STATUS_CLASSES, SUBSCRIPTION_STATUS_LABELS } from './subscription-helpers'
import type { SubscriptionStatus } from '@/types/commercialPricing'

interface Props {
  status: SubscriptionStatus
  className?: string
}

export function SubscriptionStatusBadge({ status, className }: Props) {
  return (
    <Badge variant="outline" className={cn(SUBSCRIPTION_STATUS_CLASSES[status], className)}>
      {SUBSCRIPTION_STATUS_LABELS[status]}
    </Badge>
  )
}
