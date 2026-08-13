import { useEffect, useState } from 'react'
import {
  MoreHorizontal, MessageSquare, FileBarChart, Megaphone, Share2, EyeOff,
  Tag, Edit, StickyNote, Trash2, Phone, Mail, Loader2, Download, Users,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Label } from '@/components/ui/label'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { api } from '@/api/client'

type Listing = any

export function ListingRow({
  listing,
  inquiryCount,
  distributionsCount,
  pendingSubs,
  onDistribute,
  onPromote,
  onEdit,
  onDelete,
  onStatusChange,
  onInquiriesChanged,
}: {
  listing: Listing
  inquiryCount: number
  distributionsCount: number
  pendingSubs: number
  onDistribute: () => void
  onPromote: () => void
  onEdit: () => void
  onDelete: () => void
  onStatusChange: (status: string) => Promise<void>
  onInquiriesChanged?: () => void
}) {
  const [panel, setPanel] = useState<null | 'inquiries' | 'notes' | 'report' | 'mark'>(null)
  const [busy, setBusy] = useState(false)
  const [inquiries, setInquiries] = useState<any[]>([])
  const [notes, setNotes] = useState<any[]>([])
  const [noteBody, setNoteBody] = useState('')
  const [noteVisibility, setNoteVisibility] = useState<'private' | 'team'>('private')
  const [report, setReport] = useState<any>(null)
  const [error, setError] = useState('')

  const city = listing.city || String(listing.location || '').split(',')[0]?.trim() || '—'
  const photo = listing.photos?.[0] || '/placeholder-property.svg'
  const status = listing.status || 'active'
  const engagement = (listing.views || 0) + inquiryCount + (listing.clicks || 0)

  useEffect(() => {
    if (panel !== 'inquiries') return
    setBusy(true)
    setError('')
    api.getPropertyAnalytics(listing.id)
      .then((data) => setInquiries(data.inquiries || []))
      .catch((e) => setError(e.message || 'Failed to load inquiries'))
      .finally(() => setBusy(false))
  }, [panel, listing.id])

  useEffect(() => {
    if (panel !== 'notes') return
    setBusy(true)
    setError('')
    api.getListingNotes(listing.id)
      .then(setNotes)
      .catch((e) => setError(e.message || 'Failed to load notes'))
      .finally(() => setBusy(false))
  }, [panel, listing.id])

  useEffect(() => {
    if (panel !== 'report') return
    setBusy(true)
    setError('')
    api.getListingReport(listing.id)
      .then(setReport)
      .catch((e) => setError(e.message || 'Failed to generate report'))
      .finally(() => setBusy(false))
  }, [panel, listing.id])

  const saveNote = async () => {
    if (!noteBody.trim()) return
    setBusy(true)
    try {
      const note = await api.createListingNote(listing.id, { body: noteBody.trim(), visibility: noteVisibility })
      setNotes((prev) => [note, ...prev])
      setNoteBody('')
    } catch (e: any) {
      setError(e.message || 'Failed to save note')
    } finally {
      setBusy(false)
    }
  }

  const downloadReport = () => {
    if (!report) return
    const blob = new Blob([JSON.stringify(report, null, 2)], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `report-${listing.id.slice(0, 8)}.json`
    a.click()
    URL.revokeObjectURL(url)
  }

  const markStatus = async (next: string) => {
    setBusy(true)
    try {
      await onStatusChange(next)
      setPanel(null)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="rounded-lg border bg-white">
      <div className="flex flex-col gap-4 p-4 sm:flex-row sm:items-center">
        <img src={photo} alt={listing.title} className="h-24 w-32 shrink-0 rounded-lg object-cover" />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-start justify-between gap-2">
            <div className="min-w-0">
              <h4 className="truncate font-semibold">{listing.title}</h4>
              <p className="text-sm text-muted-foreground">{city}</p>
            </div>
            <div className="flex flex-wrap gap-1.5">
              <Badge variant={listing.type === 'sale' ? 'default' : 'secondary'}>
                {listing.type === 'sale' ? 'Sale' : 'Rent'}
              </Badge>
              {status !== 'active' && (
                <Badge variant="outline" className="capitalize">{status}</Badge>
              )}
            </div>
          </div>
          <div className="mt-2 flex flex-wrap items-center gap-3 text-sm text-muted-foreground">
            <span className="font-medium text-foreground">${Number(listing.price || 0).toLocaleString()}</span>
            <span className="flex items-center gap-1"><Users className="h-3.5 w-3.5" />{engagement} engagement</span>
            <span>{listing.views || 0} views</span>
            <span>{inquiryCount} inquiries</span>
            {distributionsCount > 0 && (
              <Badge variant="outline" className="text-xs">{distributionsCount} channels</Badge>
            )}
            {pendingSubs > 0 && (
              <Badge variant="secondary" className="text-xs">{pendingSubs} pending</Badge>
            )}
          </div>
        </div>

        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="outline" size="sm" className="gap-1.5 shrink-0">
              Action <MoreHorizontal className="h-4 w-4" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-56">
            <DropdownMenuLabel>Listing actions</DropdownMenuLabel>
            <DropdownMenuSeparator />
            <DropdownMenuItem onSelect={() => setPanel('inquiries')}>
              <MessageSquare className="mr-2 h-4 w-4" /> Inquiries
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={() => setPanel('report')}>
              <FileBarChart className="mr-2 h-4 w-4" /> Generate Report
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={onPromote}>
              <Megaphone className="mr-2 h-4 w-4" /> Promote
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={onDistribute}>
              <Share2 className="mr-2 h-4 w-4" /> Distribute
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem onSelect={() => onStatusChange('unpublished')}>
              <EyeOff className="mr-2 h-4 w-4" /> Unpublish
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={() => setPanel('mark')}>
              <Tag className="mr-2 h-4 w-4" /> Mark sold / hold
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={onEdit}>
              <Edit className="mr-2 h-4 w-4" /> Edit
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={() => setPanel('notes')}>
              <StickyNote className="mr-2 h-4 w-4" /> Add Notes
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem className="text-destructive focus:text-destructive" onSelect={onDelete}>
              <Trash2 className="mr-2 h-4 w-4" /> Delete
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      {panel && (
        <div className="border-t bg-muted/20 px-4 py-4">
          <div className="mb-3 flex items-center justify-between gap-2">
            <h5 className="font-semibold capitalize">
              {panel === 'mark' ? 'Mark status' : panel === 'report' ? 'Marketing & performance report' : panel}
            </h5>
            <Button variant="ghost" size="sm" onClick={() => setPanel(null)}>Close</Button>
          </div>
          {error && <p className="mb-2 text-sm text-red-600">{error}</p>}
          {busy && !report && panel !== 'mark' && (
            <div className="flex justify-center py-6"><Loader2 className="h-5 w-5 animate-spin" /></div>
          )}

          {panel === 'inquiries' && !busy && (
            <div className="space-y-3">
              {inquiries.length === 0 && <p className="text-sm text-muted-foreground">No inquiries for this listing yet.</p>}
              {inquiries.map((inq) => (
                <div key={inq.id} className="rounded-md border bg-white p-3">
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div>
                      <p className="font-medium">{inq.name}</p>
                      <p className="text-xs text-muted-foreground">
                        {inq.email}{inq.phone ? ` · ${inq.phone}` : ''}
                        {inq.channel || inq.source ? ` · ${inq.channel || inq.source}` : ''}
                        {inq.status ? ` · ${inq.status}` : ''}
                      </p>
                    </div>
                    <div className="flex gap-1">
                      {inq.phone && (
                        <Button variant="outline" size="sm" asChild>
                          <a href={`tel:${String(inq.phone).replace(/\s/g, '')}`}><Phone className="h-3.5 w-3.5" /></a>
                        </Button>
                      )}
                      <Button variant="outline" size="sm" asChild>
                        <a href={`mailto:${inq.email}`}><Mail className="h-3.5 w-3.5" /></a>
                      </Button>
                      {inq.status === 'new' && (
                        <Button
                          size="sm"
                          variant="secondary"
                          onClick={async () => {
                            await api.updateInquiry(inq.id, { status: 'contacted' })
                            setInquiries((prev) => prev.map((i) => i.id === inq.id ? { ...i, status: 'contacted' } : i))
                            onInquiriesChanged?.()
                          }}
                        >
                          Mark contacted
                        </Button>
                      )}
                    </div>
                  </div>
                  <p className="mt-2 text-sm text-muted-foreground">&ldquo;{inq.message}&rdquo;</p>
                </div>
              ))}
            </div>
          )}

          {panel === 'notes' && (
            <div className="space-y-3">
              <div className="rounded-md border bg-white p-3 space-y-2">
                <Label>New note</Label>
                <textarea
                  className="min-h-[80px] w-full rounded-md border bg-background px-3 py-2 text-sm"
                  value={noteBody}
                  onChange={(e) => setNoteBody(e.target.value)}
                  placeholder="Private reminder or team handoff note…"
                />
                <div className="flex flex-wrap items-center gap-2">
                  <select
                    className="h-9 rounded-md border bg-background px-2 text-sm"
                    value={noteVisibility}
                    onChange={(e) => setNoteVisibility(e.target.value as 'private' | 'team')}
                  >
                    <option value="private">Private (you only)</option>
                    <option value="team">Team</option>
                  </select>
                  <Button size="sm" onClick={saveNote} disabled={busy || !noteBody.trim()}>Save note</Button>
                </div>
              </div>
              {!busy && notes.map((n) => (
                <div key={n.id} className="rounded-md border bg-white p-3">
                  <div className="flex items-center justify-between gap-2 text-xs text-muted-foreground">
                    <span>{n.author_name} · {n.visibility} · {new Date(n.created_at).toLocaleString()}</span>
                    <button
                      type="button"
                      aria-label="Delete note"
                      className="text-destructive hover:underline"
                      onClick={async () => {
                        await api.deleteListingNote(listing.id, n.id)
                        setNotes((prev) => prev.filter((x) => x.id !== n.id))
                      }}
                    >
                      Delete
                    </button>
                  </div>
                  <p className="mt-1 text-sm whitespace-pre-wrap">{n.body}</p>
                </div>
              ))}
            </div>
          )}

          {panel === 'report' && report && (
            <div className="space-y-3">
              <div className="grid gap-3 sm:grid-cols-4">
                {[
                  ['Views', report.performance?.views],
                  ['Clicks', report.performance?.clicks],
                  ['Inquiries', report.performance?.inquiries],
                  ['Channels', report.performance?.distributions],
                ].map(([label, value]) => (
                  <div key={String(label)} className="rounded-md border bg-white p-3 text-center">
                    <p className="text-xl font-bold">{Number(value || 0).toLocaleString()}</p>
                    <p className="text-xs text-muted-foreground">{label}</p>
                  </div>
                ))}
              </div>
              <div className="grid gap-3 sm:grid-cols-2">
                <div className="rounded-md border bg-white p-3">
                  <p className="mb-2 text-sm font-semibold">Top geographies</p>
                  <ul className="space-y-1 text-sm text-muted-foreground">
                    {(report.performance?.by_geography || []).slice(0, 5).map((g: any) => (
                      <li key={g.label} className="flex justify-between"><span>{g.label}</span><span>{g.value}</span></li>
                    ))}
                  </ul>
                </div>
                <div className="rounded-md border bg-white p-3">
                  <p className="mb-2 text-sm font-semibold">Devices</p>
                  <ul className="space-y-1 text-sm text-muted-foreground">
                    {(report.performance?.by_device || []).map((g: any) => (
                      <li key={g.label} className="flex justify-between"><span>{g.label}</span><span>{g.value}</span></li>
                    ))}
                  </ul>
                </div>
              </div>
              <Button variant="outline" size="sm" className="gap-1.5" onClick={downloadReport}>
                <Download className="h-4 w-4" /> Download JSON report
              </Button>
            </div>
          )}

          {panel === 'mark' && (
            <div className="flex flex-wrap gap-2">
              <Button disabled={busy} onClick={() => markStatus('sold')}>Mark sold</Button>
              <Button disabled={busy} variant="secondary" onClick={() => markStatus('hold')}>Mark hold</Button>
              <Button disabled={busy} variant="outline" onClick={() => markStatus('active')}>Back to active</Button>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
