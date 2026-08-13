import { Badge } from '@/components/ui/badge'

interface PriceHealthIndicatorProps {
  analysis: any
}

export function PriceHealthIndicator({ analysis }: PriceHealthIndicatorProps) {
  if (!analysis || analysis.comparable_count === 0) {
    return <Badge variant="outline">No data</Badge>
  }

  const position = analysis.target_vs_median
  if (position === 'at') return <Badge className="bg-green-100 text-green-700 hover:bg-green-100">Within range</Badge>
  if (position === 'below') return <Badge className="bg-blue-100 text-blue-700 hover:bg-blue-100">Below market</Badge>
  return <Badge className="bg-red-100 text-red-700 hover:bg-red-100">Above market</Badge>
}
