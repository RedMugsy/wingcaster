import { useEffect, useState } from 'react'
import { api } from '@/api/client'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { useAuth } from '@/context/AuthContext'
import { useToast } from '@/components/ui/toast'

interface Assignment {
  id: string
  area_id: string
  status: string
  assigned_at: string
  due_at?: string
}

interface Area {
  id: string
  name: string
}

interface Dimension {
  id: string
  name: string
  slug: string
}

export function InspectorPage() {
  const { agent } = useAuth()
  const { addToast } = useToast()
  const [assignments, setAssignments] = useState<Assignment[]>([])
  const [areas, setAreas] = useState<Record<string, Area>>({})
  const [dimensions, setDimensions] = useState<Dimension[]>([])
  const [loading, setLoading] = useState(true)

  const [selectedAssignmentId, setSelectedAssignmentId] = useState('')
  const [notes, setNotes] = useState('')
  const [scoresJson, setScoresJson] = useState('{}')
  const [gps, setGps] = useState<{ lat: number; lng: number } | null>(null)

  useEffect(() => {
    if (!agent) return
    loadAssignments()
    loadDimensions()
  }, [agent])

  async function loadAssignments() {
    setLoading(true)
    try {
      const data = await api.getInspectorAssignments({ limit: '200' })
      const items = (data as { items?: Assignment[] }).items || []
      setAssignments(items)

      const areaIds = [...new Set(items.map((a) => a.area_id))]
      const areaMap: Record<string, Area> = {}
      for (const id of areaIds) {
        try {
          const area = await api.getAdminArea(id)
          areaMap[id] = area as Area
        } catch {
          areaMap[id] = { id, name: 'Unknown area' }
        }
      }
      setAreas(areaMap)
    } catch (err: any) {
      addToast({ title: 'Error', description: err?.message || 'Failed to load assignments', variant: 'error' })
    } finally {
      setLoading(false)
    }
  }

  async function loadDimensions() {
    try {
      const data = await api.listAdminDimensions()
      setDimensions((data as { items: Dimension[] }).items || [])
    } catch (err: any) {
      // Dimensions not critical for submission JSON
    }
  }

  async function startAssignment(id: string) {
    try {
      await api.startInspectorAssignment(id)
      await loadAssignments()
    } catch (err: any) {
      addToast({ title: 'Error', description: err?.message || 'Failed to start assignment', variant: 'error' })
    }
  }

  function captureGps() {
    if (!navigator.geolocation) return
    navigator.geolocation.getCurrentPosition(
      (pos) => setGps({ lat: pos.coords.latitude, lng: pos.coords.longitude }),
      () => addToast({ title: 'GPS unavailable', variant: 'error' }),
    )
  }

  async function submitInspection(e: React.FormEvent) {
    e.preventDefault()
    if (!selectedAssignmentId) {
      addToast({ title: 'Select an assignment', variant: 'error' })
      return
    }
    const assignment = assignments.find((a) => a.id === selectedAssignmentId)
    if (!assignment) return

    let dimensionScores
    try {
      dimensionScores = JSON.parse(scoresJson)
    } catch {
      addToast({ title: 'Invalid dimension scores JSON', variant: 'error' })
      return
    }

    try {
      await api.createInspectorSubmission({
        assignment_id: assignment.id,
        area_id: assignment.area_id,
        gps_latitude: gps?.lat ?? 0,
        gps_longitude: gps?.lng ?? 0,
        dimension_scores: dimensionScores,
        notes,
      })
      addToast({ title: 'Inspection submitted' })
      setSelectedAssignmentId('')
      setScoresJson('{}')
      setNotes('')
      loadAssignments()
    } catch (err: any) {
      addToast({ title: 'Error', description: err?.message || 'Failed to submit inspection', variant: 'error' })
    }
  }

  if (!agent) {
    return <div className="container py-8 text-sm text-red-500">Please sign in as an inspector.</div>
  }

  const activeAssignment = assignments.find((a) => a.id === selectedAssignmentId)

  return (
    <div className="container mx-auto px-4 py-8">
      <h1 className="mb-4 text-2xl font-bold">Field Inspector</h1>
      {loading && <p className="text-sm text-muted-foreground">Loading assignments...</p>}

      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>My Assignments</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-2">
              {assignments.map((assignment) => (
                <div
                  key={assignment.id}
                  className={`flex items-center justify-between rounded-lg border p-3 ${selectedAssignmentId === assignment.id ? 'border-blue-500 bg-blue-50' : ''}`}
                >
                  <div>
                    <div className="font-medium">{areas[assignment.area_id]?.name || assignment.area_id}</div>
                    <div className="text-xs text-muted-foreground">
                      Status: {assignment.status} · Assigned: {new Date(assignment.assigned_at).toLocaleDateString()}
                    </div>
                  </div>
                  <div className="flex gap-2">
                    {assignment.status === 'pending' && (
                      <Button size="sm" onClick={() => startAssignment(assignment.id)}>
                        Start
                      </Button>
                    )}
                    <Button size="sm" variant="outline" onClick={() => setSelectedAssignmentId(assignment.id)}>
                      Select
                    </Button>
                  </div>
                </div>
              ))}
              {!loading && assignments.length === 0 && (
                <p className="text-sm text-muted-foreground">No assignments yet.</p>
              )}
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Inspection Form</CardTitle>
          </CardHeader>
          <CardContent>
            {activeAssignment ? (
              <form onSubmit={submitInspection} className="space-y-4">
                <div className="text-sm text-muted-foreground">
                  Area: {areas[activeAssignment.area_id]?.name || activeAssignment.area_id}
                </div>
                <div>
                  <Label className="text-xs">GPS</Label>
                  <div className="flex items-center gap-2">
                    <Button type="button" size="sm" variant="outline" onClick={captureGps}>
                      Capture GPS
                    </Button>
                    {gps && <span className="text-xs text-muted-foreground">{gps.lat.toFixed(5)}, {gps.lng.toFixed(5)}</span>}
                  </div>
                </div>
                <div>
                  <Label className="text-xs">Dimension scores (JSON)</Label>
                  <textarea
                    className="min-h-[120px] w-full rounded-md border px-3 py-2 text-sm font-mono"
                    value={scoresJson}
                    onChange={(e) => setScoresJson(e.target.value)}
                  />
                  <p className="text-xs text-muted-foreground">
                    Example: {JSON.stringify({ safety_security: 7, power_grid_stability: 5 })}
                  </p>
                </div>
                <div>
                  <Label className="text-xs">Notes</Label>
                  <textarea
                    className="min-h-[80px] w-full rounded-md border px-3 py-2 text-sm"
                    value={notes}
                    onChange={(e) => setNotes(e.target.value)}
                  />
                </div>
                <Button type="submit" size="sm">Submit Inspection</Button>
              </form>
            ) : (
              <p className="text-sm text-muted-foreground">Select an assignment to start the inspection form.</p>
            )}

            {dimensions.length > 0 && (
              <div className="mt-4">
                <div className="text-xs font-medium text-muted-foreground">Available dimension slugs</div>
                <div className="mt-1 flex flex-wrap gap-1">
                  {dimensions.map((d) => (
                    <span key={d.id} className="rounded bg-gray-100 px-1.5 py-0.5 text-xs">{d.slug}</span>
                  ))}
                </div>
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  )
}
