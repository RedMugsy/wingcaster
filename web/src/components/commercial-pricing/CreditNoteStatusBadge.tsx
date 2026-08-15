import { Badge } from '@/components/ui/badge'
import { cn } from '@/lib/utils'
import { CREDIT_NOTE_STATUS_CLASSES, CREDIT_NOTE_STATUS_LABELS } from './subscription-helpers'
import type { CreditNoteStatus } from '@/types/commercialPricing'

interface Props {
  status: CreditNoteStatus
  className?: string
}

export function CreditNoteStatusBadge({ status, className }: Props) {
  return (
    <Badge variant="outline" className={cn(CREDIT_NOTE_STATUS_CLASSES[status], className)}>
      {CREDIT_NOTE_STATUS_LABELS[status]}
    </Badge>
  )
}
