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

  if (!isAdmin) {
    return (
      <div className="container py-8 text-sm text-red-500">Platform admin access required.</div>
    )
  }

  return (
    <div className="container mx-auto px-4 py-8">
      <h1 className="mb-4 text-2xl font-bold">Area Intelligence Admin</h1>
      {error && <p className="mb-4 text-sm text-red-500">{error}</p>}
      {loading && <p className="text-sm text-muted-foreground">Loading...</p>}

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
                <div className="flex items-center gap-2">
                  <Badge variant={area.status === 'scoring_enabled' ? 'default' : 'secondary'}>
                    {area.status}
                  </Badge>
                  <Button size="sm" onClick={() => toggleScoring(area)}>
                    {area.status === 'scoring_enabled' ? 'Disable' : 'Enable'} Scoring
                  </Button>
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
