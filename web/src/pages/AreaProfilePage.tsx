import { useEffect, useMemo, useState } from 'react'
import { useParams } from 'react-router-dom'
import { api } from '@/api/client'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { ScoreGauge } from '@/components/area-intelligence/ScoreGauge'
import { SemiCircleRadar } from '@/components/area-intelligence/SemiCircleRadar'
import { ProximityRingExplorer } from '@/components/area-intelligence/ProximityRingExplorer'
import { GoogleMap } from '@/components/area-intelligence/GoogleMap'

interface Area {
  id: string
  name: string
  name_ar?: string
  slug: string
  level: string
  summary?: string
  summary_ar?: string
  center_latitude: number
  center_longitude: number
  lifestyle_profile?: string
  investment_outlook?: string
  proximity_radii_json?: string
}

interface Dimension {
  id: string
  name: string
  slug: string
  display_config?: { color?: string; icon?: string }
}

interface ScoreCard {
  dimension: Dimension
  score: number | null
  confidence: number | null
  rationale: string | null
  calculated_at: string | null
}

interface CachedScore {
  query_category?: string
  query_radius_meters?: number
  results_json?: unknown
}

export function AreaProfilePage() {
  const { slug } = useParams<{ slug: string }>()
  const [data, setData] = useState<{ area: Area; scores: ScoreCard[] } | null>(null)
  const [googleScores, setGoogleScores] = useState<CachedScore[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!slug) return
    setLoading(true)
    Promise.all([
      api.getArea(slug),
      api.getAreaGoogleScores(slug).catch(() => ({ items: [] })),
    ])
      .then(([areaData, scoresData]) => {
        setData(areaData as { area: Area; scores: ScoreCard[] })
        setGoogleScores((scoresData as { items: CachedScore[] }).items || [])
      })
      .catch((err: Error) => setError(err.message))
      .finally(() => setLoading(false))
  }, [slug])

  const radarScores = useMemo(() => {
    if (!data?.area.proximity_radii_json) return { inner: null, middle: null, outer: null }
    let radii: Record<string, number>
    try {
      radii = JSON.parse(data.area.proximity_radii_json)
    } catch {
      radii = { local: 3000, secondary: 5000, macro: 10000 }
    }
    const scoreMap = new Map(data.scores.map((s) => [s.dimension.slug, s.score]))
    const proximity = scoreMap.get('proximity_accessibility') ?? null
    return {
      inner: proximity,
      middle: proximity,
      outer: proximity,
    }
  }, [data])

  const center = useMemo(
    () => ({
      lat: Number(data?.area.center_latitude) || 0,
      lng: Number(data?.area.center_longitude) || 0,
    }),
    [data]
  )

  if (loading) return <div className="container py-8 text-sm text-muted-foreground">Loading area...</div>
  if (error || !data) return <div className="container py-8 text-sm text-red-500">{error || 'Area not found'}</div>

  const { area, scores } = data
  const overall = scores.find((s) => s.dimension.slug === 'overall_livability')

  return (
    <div className="container mx-auto px-4 py-8">
      <div className="mb-6">
        <h1 className="text-3xl font-bold">{area.name}</h1>
        {area.name_ar && <p className="text-lg text-muted-foreground">{area.name_ar}</p>}
        <p className="mt-2 max-w-3xl text-muted-foreground">{area.summary}</p>
        {area.summary_ar && <p className="mt-1 max-w-3xl text-right text-muted-foreground">{area.summary_ar}</p>}
      </div>

      <div className="grid gap-6 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle>Score Dashboard</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid gap-6 sm:grid-cols-2 md:grid-cols-3">
              {scores.map((s) => (
                <ScoreGauge
                  key={s.dimension.id}
                  score={s.score}
                  label={s.dimension.name}
                  color={s.dimension.display_config?.color || '#3B82F6'}
                />
              ))}
            </div>
            {overall && (
              <div className="mt-6 rounded-lg bg-gray-50 p-4">
                <div className="text-sm font-medium text-muted-foreground">Overall Livability</div>
                <div className="text-3xl font-bold">{overall.score == null ? '—' : overall.score.toFixed(1)} / 10</div>
                {overall.rationale && <p className="mt-1 text-sm text-muted-foreground">{overall.rationale}</p>}
              </div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Proximity Radar</CardTitle>
          </CardHeader>
          <CardContent>
            <SemiCircleRadar scores={radarScores} />
          </CardContent>
        </Card>
      </div>

      <div className="mt-6 grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Interactive Proximity Explorer</CardTitle>
          </CardHeader>
          <CardContent>
            <ProximityRingExplorer googleScores={googleScores} center={center} />
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Map</CardTitle>
          </CardHeader>
          <CardContent>
            <GoogleMap
              apiKey={import.meta.env.VITE_GOOGLE_MAPS_API_KEY}
              center={center}
              zoom={area.level === 'neighborhood' ? 15 : 13}
            />
          </CardContent>
        </Card>
      </div>

      {(area.lifestyle_profile || area.investment_outlook) && (
        <div className="mt-6 grid gap-6 md:grid-cols-2">
          {area.lifestyle_profile && (
            <Card>
              <CardHeader>
                <CardTitle>Lifestyle Profile</CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-sm text-muted-foreground">{area.lifestyle_profile}</p>
              </CardContent>
            </Card>
          )}
          {area.investment_outlook && (
            <Card>
              <CardHeader>
                <CardTitle>Investment Outlook</CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-sm text-muted-foreground">{area.investment_outlook}</p>
              </CardContent>
            </Card>
          )}
        </div>
      )}
    </div>
  )
}
