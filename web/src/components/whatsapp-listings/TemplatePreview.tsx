import { Card, CardContent } from '@/components/ui/card'

interface TemplatePreviewProps {
  imageUrl: string
  variants?: string[]
  selected?: string
  onSelect?: (variant: string) => void
}

const variantLabels: Record<string, string> = {
  luxe: 'Luxe',
  modern: 'Modern',
  urgent: 'Urgent',
}

export function TemplatePreview({ imageUrl, variants = ['modern', 'luxe', 'urgent'], selected, onSelect }: TemplatePreviewProps) {
  return (
    <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
      {variants.map((variant) => (
        <Card
          key={variant}
          className={`cursor-pointer overflow-hidden ${selected === variant ? 'ring-2 ring-primary' : ''}`}
          onClick={() => onSelect?.(variant)}
          role="button"
          aria-pressed={selected === variant}
          aria-label={`Select ${variantLabels[variant] || variant} template`}
          tabIndex={0}
          onKeyDown={(e) => {
            if (e.key === 'Enter' || e.key === ' ') onSelect?.(variant)
          }}
        >
          <img src={imageUrl} alt={variantLabels[variant] || variant} className="h-40 w-full object-cover" />
          <CardContent className="p-3">
            <p className="text-center text-sm font-medium">{variantLabels[variant] || variant}</p>
          </CardContent>
        </Card>
      ))}
    </div>
  )
}
