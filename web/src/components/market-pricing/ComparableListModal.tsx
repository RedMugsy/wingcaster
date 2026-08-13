import { useState } from 'react'
import { Flag, ExternalLink, ArrowUpDown } from 'lucide-react'
import { useLocation, useNavigate } from 'react-router-dom'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { api } from '@/api/client'
import { useToast } from '@/components/ui/toast'
import { useAuth } from '@/context/AuthContext'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'

interface ComparableListModalProps {
  property: any
  comparables: any[]
  onClose: () => void
}

type SortKey = 'price' | 'area' | 'similarity' | 'listed'

function formatPrice(value: number | null | undefined) {
  if (value == null || Number.isNaN(value)) return 'N/A'
  const num = Number(value)
  if (num >= 1_000_000) return `$${(num / 1_000_000).toFixed(2)}M`
  if (num >= 1_000) return `$${(num / 1_000).toFixed(0)}K`
  return `$${num.toLocaleString()}`
}

export function ComparableListModal({ property, comparables, onClose }: ComparableListModalProps) {
  const { addToast } = useToast()
  const { agent } = useAuth()
  const navigate = useNavigate()
  const location = useLocation()
  const [sortKey, setSortKey] = useState<SortKey>('similarity')
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc')
  const [reportingId, setReportingId] = useState<string | null>(null)
  const [reportReason, setReportReason] = useState('')
  const [reportNotes, setReportNotes] = useState('')

  const sorted = [...comparables].sort((a, b) => {
    let va: number = 0
    let vb: number = 0
    switch (sortKey) {
      case 'price':
        va = Number(a.normalized_price ?? a.price ?? 0)
        vb = Number(b.normalized_price ?? b.price ?? 0)
        break
      case 'area':
        va = Number(a.area ?? a.area_sqm ?? 0)
        vb = Number(b.area ?? b.area_sqm ?? 0)
        break
      case 'similarity':
        va = Number(a.weight ?? a.similarity_score ?? 0)
        vb = Number(b.weight ?? b.similarity_score ?? 0)
        break
      case 'listed':
        va = new Date(a.created_at || a.scraped_at || 0).getTime()
        vb = new Date(b.created_at || b.scraped_at || 0).getTime()
        break
    }
    return sortDir === 'asc' ? va - vb : vb - va
  })

  function toggleSort(key: SortKey) {
    if (sortKey === key) {
      setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'))
    } else {
      setSortKey(key)
      setSortDir('desc')
    }
  }

  async function submitReport(comp: any) {
    if (!reportReason) return
    try {
      await api.reportComparable({
        comparable_id: comp.id,
        comparable_type: comp.source === 'internal' ? 'internal' : 'external',
        reason: reportReason,
        notes: reportNotes,
      })
      addToast({ title: 'Report submitted', description: 'Thank you for helping keep our data accurate.', variant: 'default' })
      setReportingId(null)
      setReportReason('')
      setReportNotes('')
    } catch (err: any) {
      addToast({ title: 'Report failed', description: err.message || 'Could not submit report', variant: 'error' })
    }
  }

  function beginReport(comp: any) {
    if (!agent) {
      navigate(`/login?returnTo=${encodeURIComponent(location.pathname + location.search)}`)
      return
    }
    setReportingId(comp.id)
  }

  function formatListedDate(comp: any) {
    const raw = comp.listed_at || comp.created_at || comp.scraped_at || comp.sold_date
    if (!raw) return 'Date unavailable'
    const date = new Date(raw)
    return Number.isNaN(date.getTime()) ? 'Date unavailable' : date.toLocaleDateString()
  }

  return (
    <Dialog open onOpenChange={(open) => { if (!open) onClose() }}>
      <DialogContent className="max-w-3xl">
        <DialogHeader className="mb-4">
          <DialogTitle>Comparable Properties</DialogTitle>
          <DialogDescription>{property.title} · {comparables.length} matched</DialogDescription>
        </DialogHeader>

        <div className="mb-4 flex flex-wrap gap-2">
          <Button variant={sortKey === 'similarity' ? 'default' : 'outline'} size="sm" onClick={() => toggleSort('similarity')}>
            Similarity <ArrowUpDown className="ml-1 h-3 w-3" />
          </Button>
          <Button variant={sortKey === 'price' ? 'default' : 'outline'} size="sm" onClick={() => toggleSort('price')}>
            Price <ArrowUpDown className="ml-1 h-3 w-3" />
          </Button>
          <Button variant={sortKey === 'area' ? 'default' : 'outline'} size="sm" onClick={() => toggleSort('area')}>
            Area <ArrowUpDown className="ml-1 h-3 w-3" />
          </Button>
          <Button variant={sortKey === 'listed' ? 'default' : 'outline'} size="sm" onClick={() => toggleSort('listed')}>
            Listed <ArrowUpDown className="ml-1 h-3 w-3" />
          </Button>
        </div>

        <div className="space-y-3">
          {sorted.map((comp: any) => (
            <div key={comp.id} className="rounded-lg border p-4">
              <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                <div className="flex-1">
                  <div className="flex items-center gap-2">
                    <p className="font-semibold">{comp.title || comp.location || 'Comparable'}</p>
                    <Badge variant={comp.source === 'internal' ? 'default' : 'secondary'}>
                      {comp.source === 'internal' ? 'Internal' : comp.source}
                    </Badge>
                  </div>
                  <p className="text-sm text-muted-foreground">
                    {comp.city || comp.location_text || ''} · {comp.bedrooms ?? '-'} beds · {comp.bathrooms ?? '-'} baths · {comp.area ?? comp.area_sqm ?? '-'} {property.area_unit || 'sqm'}
                  </p>
                  {comp.condition && comp.condition !== 'unknown' && (
                    <p className="text-xs text-muted-foreground capitalize">Condition: {comp.condition.replace('_', ' ')}</p>
                  )}
                  <p className="mt-1 text-xs text-muted-foreground">
                    Similarity score: {Number(comp.weight || comp.similarity_score || 0).toFixed(3)}
                  </p>
                  <p className="text-xs text-muted-foreground">Listed or recorded: {formatListedDate(comp)}</p>
                </div>
                <div className="text-right">
                  <p className="text-lg font-bold">{formatPrice(comp.normalized_price ?? comp.price)}</p>
                  {comp.currency && comp.price != null && String(comp.currency).toUpperCase() !== 'USD' && (
                    <p className="text-xs text-muted-foreground">
                      Original: {Number(comp.price).toLocaleString()} {String(comp.currency).toUpperCase()}
                    </p>
                  )}
                  <p className="text-xs text-muted-foreground">Source: {comp.source_label || comp.provider_source || comp.source}</p>
                  {comp.source === 'internal' && (
                    <a href={`/listings/${comp.id}`} target="_blank" rel="noreferrer" className="inline-flex items-center text-xs text-primary hover:underline">
                      View listing <ExternalLink className="ml-0.5 h-3 w-3" />
                    </a>
                  )}
                  {comp.source_url && (
                    <a href={comp.source_url} target="_blank" rel="noreferrer" className="inline-flex items-center text-xs text-primary hover:underline">
                      Source <ExternalLink className="ml-0.5 h-3 w-3" />
                    </a>
                  )}
                </div>
              </div>

              <div className="mt-3 flex items-center justify-between border-t pt-3">
                {reportingId === comp.id ? (
                  <div className="w-full space-y-2">
                    <select
                      className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                      value={reportReason}
                      onChange={(e) => setReportReason(e.target.value)}
                    >
                      <option value="">Select reason</option>
                      <option value="fake_listing">Fake listing</option>
                      <option value="incorrect_price">Incorrect price</option>
                      <option value="already_sold">Already sold</option>
                      <option value="wrong_details">Wrong details</option>
                      <option value="other">Other</option>
                    </select>
                    <textarea
                      rows={2}
                      className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                      placeholder="Notes (optional)"
                      value={reportNotes}
                      onChange={(e) => setReportNotes(e.target.value)}
                    />
                    <div className="flex gap-2">
                      <Button size="sm" onClick={() => submitReport(comp)} disabled={!reportReason}>Submit</Button>
                      <Button size="sm" variant="ghost" onClick={() => setReportingId(null)}>Cancel</Button>
                    </div>
                  </div>
                ) : (
                  <Button variant="ghost" size="sm" className="min-h-11 text-red-600 hover:text-red-700" onClick={() => beginReport(comp)}>
                    <Flag className="mr-1 h-4 w-4" aria-hidden="true" /> {agent ? 'Report inaccurate' : 'Sign in to report'}
                  </Button>
                )}
              </div>
            </div>
          ))}

          {sorted.length === 0 && (
            <div className="py-8 text-center text-muted-foreground">No comparable properties found.</div>
          )}
        </div>
        <p className="mt-5 text-xs text-muted-foreground">
          Comparables are market evidence, not a formal appraisal. Asking prices may differ from completed transaction prices.
        </p>
      </DialogContent>
    </Dialog>
  )
}
