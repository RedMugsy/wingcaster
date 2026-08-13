import { Link } from 'react-router-dom'

interface AreaScoreCardProps {
  area?: { slug: string; name: string; name_ar?: string } | null
  livabilityScore?: number | null
}

export function AreaScoreCard({ area, livabilityScore }: AreaScoreCardProps) {
  if (!area) return null
  const score = livabilityScore == null || !Number.isFinite(livabilityScore) ? null : livabilityScore.toFixed(1)

  return (
    <Link
      to={`/areas/${area.slug}`}
      className="flex items-center gap-3 rounded-lg border bg-white p-3 shadow-sm transition hover:shadow-md"
    >
      <div className="flex h-10 w-10 items-center justify-center rounded-full bg-blue-100 text-lg">📍</div>
      <div className="flex-1">
        <div className="font-medium">
          {area.name} {area.name_ar ? <span className="text-sm text-muted-foreground">({area.name_ar})</span> : null}
        </div>
        <div className="text-sm text-muted-foreground">
          Livability: {score == null ? 'Not rated' : `${score}/10`}
        </div>
      </div>
    </Link>
  )
}
