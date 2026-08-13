import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'

interface DraftCardProps {
  draft: {
    id: string
    status: string
    intent: string
    extracted_property?: {
      title?: string
      price?: number
      location?: string
    }
    thumbnails?: { paths?: Record<string, string>; variant?: string }
    captions?: Record<string, { caption?: string }>
    created_at: string
  }
  onApprove?: () => void
  onDiscard?: () => void
  onReprocess?: () => void
}

const statusColors: Record<string, string> = {
  intake: 'default',
  awaiting_approval: 'secondary',
  approved: 'default',
  published: 'default',
  discarded: 'outline',
  error: 'destructive',
} as const

export function DraftCard({ draft, onApprove, onDiscard, onReprocess }: DraftCardProps) {
  const p = draft.extracted_property || {}
  const imageUrl = draft.thumbnails?.paths?.['1080x1080']
  return (
    <Card className="overflow-hidden">
      {imageUrl && (
        <img src={imageUrl} alt="Draft preview" className="h-48 w-full object-cover" />
      )}
      <CardHeader>
        <div className="flex items-center justify-between">
          <CardTitle className="text-lg">{p.title || 'Untitled draft'}</CardTitle>
          <Badge variant={(statusColors[draft.status] as any) || 'default'}>{draft.status}</Badge>
        </div>
        <CardDescription>
          {p.price ? `$${p.price.toLocaleString()}` : 'Price unknown'} · {p.location || 'Location unknown'} · Intent: {draft.intent}
        </CardDescription>
      </CardHeader>
      <CardContent>
        <p className="text-sm text-muted-foreground">Created {new Date(draft.created_at).toLocaleString()}</p>
        <div className="mt-4 flex flex-wrap gap-2">
          {draft.status === 'awaiting_approval' && onApprove && (
            <Button size="sm" onClick={onApprove}>Approve</Button>
          )}
          {onDiscard && <Button size="sm" variant="outline" onClick={onDiscard}>Discard</Button>}
          {onReprocess && <Button size="sm" variant="secondary" onClick={onReprocess}>Re-process</Button>}
        </div>
      </CardContent>
    </Card>
  )
}
