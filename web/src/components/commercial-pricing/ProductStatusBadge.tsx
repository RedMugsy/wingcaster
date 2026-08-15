import { Badge } from '@/components/ui/badge'
import { cn } from '@/lib/utils'
import { PRODUCT_STATUS_CLASSES, PRODUCT_STATUS_LABELS } from './subscription-helpers'
import type { ProductStatus, TierStatus } from '@/types/commercialPricing'

interface Props {
  status: ProductStatus | TierStatus
  className?: string
}

export function ProductStatusBadge({ status, className }: Props) {
  return (
    <Badge variant="outline" className={cn(PRODUCT_STATUS_CLASSES[status], className)}>
      {PRODUCT_STATUS_LABELS[status]}
    </Badge>
  )
}
