import { useEffect, useState } from 'react'
import { api } from '@/api/client'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { useAuth } from '@/context/AuthContext'

interface Area {
  id: string
  name: string
  name_ar?: string
  slug: string
  level: string
  status: string
  center_latitude: number
  center_longitude: number
}

export function AdminAreasPage() {
  const { isAdmin } = useAuth()
  const [areas, setAreas] = useState<Area[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!isAdmin) return
    loadAreas()
  }, [isAdmin])

  async function loadAreas() {
    setLoading(true)
    try {
      const data = await api.listAdminAreas({ limit: '200' })
      setAreas((data as { items?: Area[] }).items || [])
    } catch (err: any) {
      setError(err?.message || 'Failed to load areas')
    } finally {
      setLoading(false)
    }
  }

  async function toggleScoring(area: Area) {
    try {
      if (area.status === 'scoring_enabled') {
        await api.disableAreaScoring(area.id)
      } else {
        await api.enableAreaScoring(area.id)
      }
      await loadAreas()
    } catch (err: any) {
      setError(err?.message || 'Action failed')
    }
  }

  const [busyAreaId, setBusyAreaId] = useState<string | null>(null)
  const [busyAction, setBusyAction] = useState<'refresh' | 'calc' | null>(null)
  const [statusMsg, setStatusMsg] = useState<string>('')

  async function refreshSignals(area: Area) {
    if (busyAreaId) return
    setBusyAreaId(area.id); setBusyAction('refresh'); setStatusMsg('')
    try {
      const r = await api.refreshAreaGoogleSignals(area.id)
      setStatusMsg(`Fetched Google signals for ${area.name}: ${r.signals_created ?? 0} new signal(s) added (total now ${r.signals_after}).`)
    } catch (err: any) {
      setError(err?.message || 'Signal refresh failed')
    } finally {
      setBusyAreaId(null); setBusyAction(null)
    }
  }

  async function calculateScores(area: Area) {
    if (busyAreaId) return
    setBusyAreaId(area.id); setBusyAction('calc'); setStatusMsg('')
    try {
      const r = await api.calculateAdminScores(area.id) as { calculated: number }
      setStatusMsg(`Calculated ${r.calculated} dimension score(s) for ${area.name}. Property Score panels for listings in this area will now populate.`)
    } catch (err: any) {
      setError(err?.message || 'Calculation failed')
    } finally {
      setBusyAreaId(null); setBusyAction(null)
    }
  }

  if (!isAdmin) {
    return (
      <div className="container py-8 text-sm text-red-500">Platform admin access required.</div>
    )
  }

  return (
    <div className="container mx-auto px-4 py-8">
      <h1 className="mb-4 text-2xl font-bold">Area Intelligence Admin</h1>
      {error && <p className="mb-4 text-sm text-red-500">{error}</p>}
      {statusMsg && <p className="mb-4 rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-800">{statusMsg}</p>}
      {loading && <p className="text-sm text-muted-foreground">Loading...</p>}
      <p className="mb-4 text-xs text-muted-foreground">
        Full flow to make a Property Score appear for a listing: (1) Enable scoring on the area,
        (2) Fetch Google signals (requires GOOGLE_MAPS_API_KEY in backend .env), (3) Calculate scores.
        The Property Score panel on any listing in that area will populate as soon as the calculation completes.
      </p>

      <Card>
        <CardHeader>
          <CardTitle>Areas</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="space-y-2">
            {areas.map((area) => (
              <div
                key={area.id}
                className="flex items-center justify-between rounded-lg border p-3"
              >
                <div>
                  <div className="font-medium">{area.name}</div>
                  <div className="text-xs text-muted-foreground">
                    {area.level} · {area.slug}
                  </div>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <Badge variant={area.status === 'scoring_enabled' ? 'default' : 'secondary'}>
                    {area.status}
                  </Badge>
                  <Button size="sm" onClick={() => toggleScoring(area)}>
                    {area.status === 'scoring_enabled' ? 'Disable' : 'Enable'} Scoring
                  </Button>
                  {area.status === 'scoring_enabled' && (
                    <>
                      <Button size="sm" variant="outline" disabled={busyAreaId === area.id} onClick={() => refreshSignals(area)}>
                        {busyAreaId === area.id && busyAction === 'refresh' ? 'Fetching…' : 'Fetch Google signals'}
                      </Button>
                      <Button size="sm" variant="outline" disabled={busyAreaId === area.id} onClick={() => calculateScores(area)}>
                        {busyAreaId === area.id && busyAction === 'calc' ? 'Calculating…' : 'Calculate scores'}
                      </Button>
                    </>
                  )}
                </div>
              </div>
            ))}
            {!loading && areas.length === 0 && (
              <p className="text-sm text-muted-foreground">No areas found.</p>
            )}
          </div>
        </CardContent>
      </Card>
    </div>
  )
}
