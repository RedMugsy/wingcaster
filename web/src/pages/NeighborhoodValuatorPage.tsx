import { useEffect, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { ArrowLeft, ExternalLink, Loader2, MapPin, Sparkles } from 'lucide-react'
import { api } from '@/api/client'
import { useAuth } from '@/context/AuthContext'
import { useToast } from '@/components/ui/toast'
import { usePageTitle } from '@/lib/usePageTitle'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { ScoreGauge } from '@/components/area-intelligence/ScoreGauge'
import { ProximityRingExplorer } from '@/components/area-intelligence/ProximityRingExplorer'
import type { Property } from '@/types'

type Area = { id: string; slug: string; name: string; name_ar: string | null }
type ScoreCard = {
  dimension: { id: string; name: string; slug: string }
  score: number | null
  confidence: number | null
  rationale: string | null
  calculated_at: string | null
}

export function NeighborhoodValuatorPage() {
  const { id } = useParams<{ id: string }>()
  const { agent, loading: authLoading } = useAuth()
  const { addToast } = useToast()

  const [listing, setListing] = useState<Property | null>(null)
  const [area, setArea] = useState<Area | null>(null)
  const [scores, setScores] = useState<ScoreCard[]>([])
  const [googleScores, setGoogleScores] = useState<any[]>([])
  const [loading, setLoading] = useState(true)

  usePageTitle(listing?.title ? `Neighborhood Valuator | ${listing.title}` : 'Neighborhood Valuator')

  useEffect(() => {
    if (!id || authLoading || !agent) return
    setLoading(true)
    ;(async () => {
      try {
        const prop = await api.getProperty(id)
        setListing(prop)
        const areaRes = await api.getListingArea(id) as { area: Area | null }
        if (areaRes.area) {
          setArea(areaRes.area)
          const [full, google] = await Promise.all([
            api.getArea(areaRes.area.slug) as Promise<{ area: any; scores: ScoreCard[] }>,
            api.getAreaGoogleScores(areaRes.area.slug).catch(() => ({ items: [] })) as Promise<{ items: any[] }>,
          ])
          setScores(full.scores || [])
          setGoogleScores(google.items || [])
        }
      } catch (err: any) {
        addToast({ title: 'Could not load Neighborhood Valuator', description: err?.message, variant: 'error' })
      } finally {
        setLoading(false)
      }
    })()
  }, [id, agent, authLoading, addToast])

  if (authLoading || loading) {
    return (
      <div className="flex min-h-[60vh] items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    )
  }
  if (!agent) {
    return (
      <div className="mx-auto max-w-lg py-16 text-center">
        <h1 className="text-2xl font-semibold">Sign in to view the Neighborhood Valuator</h1>
        <Link to="/login" className="mt-3 inline-block"><Button>Sign in</Button></Link>
      </div>
    )
  }

  const livability = pickLivabilityScore(scores)

  return (
    <div className="mx-auto max-w-6xl px-4 py-6 sm:px-6 lg:px-8">
      <div className="mb-4 flex items-center gap-2 text-sm text-muted-foreground">
        {listing && (
          <Link to={`/listings/${listing.id}`} className="inline-flex items-center gap-1 hover:text-foreground">
            <ArrowLeft className="h-4 w-4" /> Back to listing
          </Link>
        )}
      </div>

      <div className="mb-6">
        <h1 className="text-2xl font-semibold tracking-tight">Neighborhood Valuator</h1>
        <p className="mt-1 flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
          <MapPin className="h-4 w-4" />
          {listing ? [listing.location, listing.neighborhood, listing.city].filter(Boolean).join(' · ') : ''}
          {area && (
            <Badge variant="outline" className="ml-1">Scored area: {area.name}</Badge>
          )}
        </p>
      </div>

      {!area ? (
        <Card>
          <CardContent className="space-y-3 py-8 text-center">
            <MapPin className="mx-auto h-8 w-8 text-muted-foreground" />
            <h3 className="text-lg font-semibold">No scored neighborhood matches this listing yet.</h3>
            <p className="mx-auto max-w-md text-sm text-muted-foreground">
              We couldn't match "{listing?.neighborhood || listing?.city || 'this address'}" to a
              scored area. Try updating the listing's neighborhood + city fields, or ask your admin
              to enable scoring for this area.
            </p>
            {listing && (
              <Link to={`/listings/${listing.id}`} className="inline-block">
                <Button variant="outline" className="gap-1.5">
                  <ArrowLeft className="h-4 w-4" />
                  Back to listing
                </Button>
              </Link>
            )}
          </CardContent>
        </Card>
      ) : (
        <>
          <div className="mb-6 grid grid-cols-1 gap-4 md:grid-cols-3">
            <Card className="md:col-span-1">
              <CardHeader><CardTitle className="text-base">Livability</CardTitle></CardHeader>
              <CardContent className="flex items-center justify-center pb-6">
                <ScoreGauge score={livability} label="Overall score" />
              </CardContent>
            </Card>
            <Card className="md:col-span-2">
              <CardHeader><CardTitle className="text-base">Score by dimension</CardTitle></CardHeader>
              <CardContent>
                <ul className="space-y-2">
                  {scores.map((s) => {
                    const v = s.score == null ? null : Number(s.score)
                    const pct = v == null ? 0 : Math.max(0, Math.min(100, (v / 10) * 100))
                    return (
                      <li key={s.dimension.id}>
                        <div className="mb-0.5 flex items-center justify-between text-xs">
                          <span className="font-medium">{s.dimension.name}</span>
                          <span className="text-muted-foreground">{v == null ? 'n/a' : v.toFixed(1)}</span>
                        </div>
                        <div className="h-2 overflow-hidden rounded-full bg-slate-100">
                          <div className="h-full bg-blue-500" style={{ width: `${pct}%` }} />
                        </div>
                      </li>
                    )
                  })}
                </ul>
              </CardContent>
            </Card>
          </div>

          <div className="mb-6 grid grid-cols-1 gap-3 md:grid-cols-2 lg:grid-cols-3">
            {scores.map((s) => (
              <Card key={s.dimension.id}>
                <CardHeader className="pb-2">
                  <div className="flex items-center justify-between">
                    <CardTitle className="text-sm">{s.dimension.name}</CardTitle>
                    <Badge variant="outline" className="text-[10px]">
                      {s.score == null ? 'n/a' : `${Number(s.score).toFixed(1)}/10`}
                    </Badge>
                  </div>
                </CardHeader>
                <CardContent className="pb-3 text-xs text-muted-foreground">
                  {s.rationale || 'No rationale recorded yet.'}
                  {s.confidence != null && (
                    <div className="mt-1 text-[10px]">Confidence: {Math.round(s.confidence * 100)}%</div>
                  )}
                </CardContent>
              </Card>
            ))}
          </div>

          {listing?.latitude && listing?.longitude && (
            <Card className="mb-6">
              <CardHeader><CardTitle className="text-base">Proximity to key places</CardTitle></CardHeader>
              <CardContent>
                <ProximityRingExplorer
                  googleScores={googleScores}
                  center={{ lat: Number(listing.latitude), lng: Number(listing.longitude) }}
                />
              </CardContent>
            </Card>
          )}

          {googleScores.length > 0 && (
            <Card className="mb-6">
              <CardHeader><CardTitle className="text-base">Google Places signals</CardTitle></CardHeader>
              <CardContent>
                <ul className="grid grid-cols-1 gap-1.5 sm:grid-cols-2">
                  {googleScores.map((g: any) => (
                    <li key={g.id || g.category} className="flex items-center justify-between rounded border bg-white px-3 py-1.5 text-sm">
                      <span className="capitalize">{g.category || g.name || 'Signal'}</span>
                      <span className="text-xs text-muted-foreground">
                        {g.score != null ? `${Number(g.score).toFixed(1)}` : `${g.count ?? 0} nearby`}
                      </span>
                    </li>
                  ))}
                </ul>
              </CardContent>
            </Card>
          )}

          <div className="text-xs text-muted-foreground">
            <Sparkles className="mr-1 inline h-3 w-3 text-amber-500" />
            Coming soon: on-site inspection notes + photos captured while walking the property.
            <Link to={`/areas/${area.slug}`} className="ml-3 inline-flex items-center gap-1 text-primary hover:underline">
              <ExternalLink className="h-3 w-3" />
              Full area profile
            </Link>
          </div>
        </>
      )}
    </div>
  )
}

function pickLivabilityScore(scores: ScoreCard[]): number | null {
  if (!scores.length) return null
  // Prefer an explicit composite "livability" dimension if present; else average.
  const overall = scores.find((s) => /overall|livability|composite/i.test(s.dimension?.name || s.dimension?.slug || ''))
  if (overall && overall.score != null) return Number(overall.score)
  const nums = scores.map((s) => s.score).filter((v): v is number => v != null && Number.isFinite(v))
  if (!nums.length) return null
  return nums.reduce((a, b) => a + b, 0) / nums.length
}
