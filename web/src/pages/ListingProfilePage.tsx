import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import {
  ArrowLeft, Bath, Bed, Building2, Calendar, Camera, ChevronRight, Copy, Edit3, ExternalLink,
  Globe2, Loader2, Mail, MapPin, Maximize, Megaphone, MessageCircle, MoreHorizontal,
  Phone, Share2, Sparkles, Trash2, Video, X, PlusCircle,
} from 'lucide-react'
import { api } from '@/api/client'
import { useAuth } from '@/context/AuthContext'
import { useToast } from '@/components/ui/toast'
import { usePageTitle } from '@/lib/usePageTitle'
import { formatPrice } from '@/lib/format'
import {
  LISTING_STATUS_META, LISTING_STATUSES, normalizeStatus, type ListingStatus,
} from '@/lib/listingStatus'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { SocialCardStudio } from '@/components/social-cards/SocialCardStudio'
import { MarketContextCard } from '@/components/market-pricing/MarketContextCard'
import { TrendMiniChart } from '@/components/market-pricing/TrendMiniChart'
import { ComparableListModal } from '@/components/market-pricing/ComparableListModal'
import { ListingFormModal } from '@/components/ListingFormModal'
import type { Property } from '@/types'
import type { PricingAnalysis, PricingTrendSnapshot } from '@/types/marketPricing'

interface Viewing {
  id: string
  scheduled_at: string
  status: string
  mode?: string
  notes?: string
  contact_name?: string
  contact_phone?: string
  contact_email?: string
}

type TabKey = 'overview' | 'portals' | 'comms' | 'email' | 'viewings' | 'area'

export function ListingProfilePage() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const { agent } = useAuth()
  const { addToast } = useToast()

  const [property, setProperty] = useState<Property | null>(null)
  const [loading, setLoading] = useState(true)
  const [activeImage, setActiveImage] = useState(0)
  const [tab, setTab] = useState<TabKey>('overview')
  const [editOpen, setEditOpen] = useState(false)
  const [statusBusy, setStatusBusy] = useState(false)
  const [deleteBusy, setDeleteBusy] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [shareMsg, setShareMsg] = useState('')

  // Market pricing (existing engine — surfaced in Overview tab)
  const [pricingAnalysis, setPricingAnalysis] = useState<PricingAnalysis | null>(null)
  const [pricingTrends, setPricingTrends] = useState<PricingTrendSnapshot[]>([])
  const [pricingComparables, setPricingComparables] = useState<any[]>([])
  const [showComparables, setShowComparables] = useState(false)

  // Viewings tab
  const [viewings, setViewings] = useState<Viewing[]>([])
  const [scheduleOpen, setScheduleOpen] = useState<null | 'viewing' | 'call'>(null)

  // AI describe from photos
  const [aiOpen, setAiOpen] = useState(false)

  usePageTitle(property?.title || 'Listing')

  const loadProperty = useCallback(async () => {
    if (!id) return
    setLoading(true)
    try {
      const p = await api.getProperty(id)
      setProperty(p)
      setActiveImage(0)
    } catch (err: any) {
      addToast({ title: 'Could not load listing', description: err?.message, variant: 'error' })
    } finally {
      setLoading(false)
    }
  }, [id, addToast])

  useEffect(() => { loadProperty() }, [loadProperty])

  useEffect(() => {
    if (!id || !property) return
    api.getPricingAnalysis(id).then(setPricingAnalysis).catch(() => setPricingAnalysis(null))
    api.getPricingComparables(id)
      .then((rows: any) => setPricingComparables(Array.isArray(rows) ? rows : []))
      .catch(() => setPricingComparables([]))
    const areaId = (property as any).area_id ?? (property as any).area_profile_id
    if (areaId && property.property_type) {
      api.getPricingTrends(String(areaId), String(property.property_type))
        .then((rows: any) => setPricingTrends(Array.isArray(rows) ? rows : []))
        .catch(() => setPricingTrends([]))
    } else {
      setPricingTrends([])
    }
  }, [id, property])

  useEffect(() => {
    if (!id || tab !== 'viewings') return
    api.getViewings().then((rows: any) => {
      const list: Viewing[] = Array.isArray(rows) ? rows : []
      setViewings(list.filter((v: any) => v.property_id === id || v.listing_id === id))
    }).catch(() => setViewings([]))
  }, [id, tab])

  const status = normalizeStatus(property?.status)
  const meta = LISTING_STATUS_META[status]
  const isOwner = Boolean(agent && property && agent.id === property.agent_id)

  const heroPhoto = property?.photos?.[activeImage] || '/placeholder-property.svg'

  async function setStatus(next: ListingStatus) {
    if (!property || statusBusy) return
    setStatusBusy(true)
    try {
      const updated = await api.updateProperty(property.id, { status: next })
      setProperty((prev) => (prev ? { ...prev, ...updated, status: next } : prev))
      addToast({ title: `Status set to ${LISTING_STATUS_META[next].label}`, variant: 'success' })
    } catch (err: any) {
      addToast({ title: 'Could not update status', description: err?.message, variant: 'error' })
    } finally {
      setStatusBusy(false)
    }
  }

  async function handleDelete() {
    if (!property || deleteBusy) return
    setDeleteBusy(true)
    try {
      await api.deleteProperty(property.id)
      addToast({ title: 'Listing deleted', variant: 'success' })
      navigate('/listings')
    } catch (err: any) {
      addToast({ title: 'Could not delete', description: err?.message, variant: 'error' })
      setDeleteBusy(false)
    }
  }

  async function copyShareLink() {
    if (!property) return
    const url = `${window.location.origin}/listings/${property.id}`
    try {
      await navigator.clipboard.writeText(url)
      setShareMsg('Internal link copied')
      setTimeout(() => setShareMsg(''), 2000)
    } catch {
      setShareMsg('Copy failed — press Ctrl+C on the URL bar')
    }
  }

  if (loading) {
    return (
      <div className="flex min-h-[60vh] items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    )
  }

  if (!property) {
    return (
      <div className="mx-auto max-w-lg px-4 py-16 text-center">
        <h1 className="text-2xl font-semibold">Listing not found</h1>
        <Link to="/listings" className="mt-4 inline-block">
          <Button variant="outline">
            <ArrowLeft className="mr-2 h-4 w-4" />
            Back to listings
          </Button>
        </Link>
      </div>
    )
  }

  return (
    <div className="mx-auto max-w-7xl px-4 py-4 sm:px-6 lg:px-8">
      <div className="mb-4 flex items-center gap-2 text-sm text-muted-foreground">
        <Link to="/listings" className="inline-flex items-center gap-1 hover:text-foreground">
          <ArrowLeft className="h-4 w-4" /> Listings
        </Link>
        {property.reference && (
          <>
            <span>·</span>
            <span>Ref {property.reference}</span>
          </>
        )}
      </div>

      <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="text-2xl font-semibold tracking-tight">{property.title}</h1>
            <Badge variant="outline" className={`gap-1 border ${meta.badgeClass}`}>
              <span className={`h-1.5 w-1.5 rounded-full ${meta.dotClass}`} />
              {meta.label}
            </Badge>
          </div>
          <p className="mt-1 flex items-center gap-1 text-sm text-muted-foreground">
            <MapPin className="h-3.5 w-3.5" />
            {[property.location, property.city, property.neighborhood].filter(Boolean).join(' · ')}
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {isOwner && (
            <>
              <StatusSetter status={status} onChange={setStatus} busy={statusBusy} />
              <Button variant="outline" size="sm" className="gap-1.5" onClick={() => setEditOpen(true)}>
                <Edit3 className="h-4 w-4" />
                Edit
              </Button>
            </>
          )}
          <Button variant="outline" size="sm" className="gap-1.5" onClick={copyShareLink}>
            <Share2 className="h-4 w-4" />
            Share
          </Button>
          {isOwner && (
            <Button
              variant="outline"
              size="sm"
              className="gap-1.5 text-red-600 hover:bg-red-50"
              onClick={() => setConfirmDelete(true)}
            >
              <Trash2 className="h-4 w-4" />
              Delete
            </Button>
          )}
        </div>
      </div>
      {shareMsg && (
        <div className="mb-2 rounded-md border border-emerald-200 bg-emerald-50 px-3 py-1.5 text-xs text-emerald-800">
          {shareMsg}
        </div>
      )}

      {/* Gallery */}
      <div className="mb-6 grid grid-cols-1 gap-3 lg:grid-cols-3">
        <div className="relative aspect-[16/10] overflow-hidden rounded-lg bg-slate-100 lg:col-span-2">
          <img src={heroPhoto} alt={property.title} className="h-full w-full object-cover" />
          <button
            type="button"
            className="absolute bottom-3 right-3 inline-flex items-center gap-1.5 rounded-full bg-slate-900/80 px-3 py-1.5 text-xs font-medium text-white hover:bg-slate-900 disabled:cursor-not-allowed disabled:opacity-50"
            title={
              (property.photos?.length || 0) === 0
                ? 'Add photos first — AI needs something to describe.'
                : 'Draft a description from these photos with AI'
            }
            disabled={(property.photos?.length || 0) === 0 || !isOwner}
            onClick={() => setAiOpen(true)}
          >
            <Sparkles className="h-3.5 w-3.5" />
            AI describe from photos
          </button>
        </div>
        <div className="grid grid-cols-3 gap-2 lg:grid-cols-2">
          {(property.photos || []).slice(0, 4).map((src, i) => (
            <button
              key={src + i}
              type="button"
              onClick={() => setActiveImage(i)}
              className={`relative aspect-[4/3] overflow-hidden rounded-md bg-slate-100 transition-opacity ${
                activeImage === i ? 'ring-2 ring-slate-900' : 'opacity-80 hover:opacity-100'
              }`}
            >
              <img src={src} alt="" className="h-full w-full object-cover" />
            </button>
          ))}
          {(property.photos || []).length > 4 && (
            <div className="col-span-3 flex items-center justify-center rounded-md border border-dashed text-xs text-muted-foreground lg:col-span-2">
              +{(property.photos || []).length - 4} more
            </div>
          )}
        </div>
      </div>

      {/* Info strip */}
      <div className="mb-6 flex flex-wrap items-center gap-4 rounded-lg border bg-white px-4 py-3">
        <div className="text-2xl font-semibold">
          {formatPrice(property.price, property.type, property.price_unit)}
        </div>
        <Fact icon={Bed} label={`${property.bedrooms || 0} bed`} />
        <Fact icon={Bath} label={`${property.bathrooms || 0} bath`} />
        <Fact icon={Maximize} label={`${property.area || 0} ${property.area_unit || 'sqm'}`} />
        <span className="capitalize text-sm text-muted-foreground">{property.property_type}</span>
        {property.listed_date && (
          <span className="ml-auto text-xs text-muted-foreground">
            Listed {new Date(property.listed_date).toLocaleDateString()}
          </span>
        )}
      </div>

      {/* Tabs */}
      <Tabs value={tab} onValueChange={(v) => setTab(v as TabKey)}>
        <TabsList className="mb-4 flex flex-wrap">
          <TabsTrigger value="overview">Overview</TabsTrigger>
          <TabsTrigger value="portals">
            Portals
            <Badge variant="outline" className="ml-2 text-[10px]">Phase 10</Badge>
          </TabsTrigger>
          <TabsTrigger value="comms">
            Comms
            <Badge variant="outline" className="ml-2 text-[10px]">Phase 4</Badge>
          </TabsTrigger>
          <TabsTrigger value="email">Email</TabsTrigger>
          <TabsTrigger value="viewings">Viewings</TabsTrigger>
          <TabsTrigger value="area">Property Score</TabsTrigger>
        </TabsList>

        <TabsContent value="overview" className="space-y-6">
          {property.description && (
            <Card>
              <CardHeader><CardTitle className="text-lg">Description</CardTitle></CardHeader>
              <CardContent className="whitespace-pre-wrap text-sm leading-relaxed text-slate-700">
                {property.description}
              </CardContent>
            </Card>
          )}

          {(property.amenities?.length || 0) > 0 && (
            <Card>
              <CardHeader><CardTitle className="text-lg">Amenities</CardTitle></CardHeader>
              <CardContent className="flex flex-wrap gap-2">
                {property.amenities.map((a) => (
                  <Badge key={a} variant="secondary" className="capitalize">
                    {a.replace(/_/g, ' ')}
                  </Badge>
                ))}
              </CardContent>
            </Card>
          )}

          {pricingAnalysis && (
            <MarketContextCard
              analysis={pricingAnalysis}
              onViewComparables={() => setShowComparables(true)}
            />
          )}

          {pricingTrends.length > 0 && (
            <Card>
              <CardHeader><CardTitle className="text-lg">Price trend</CardTitle></CardHeader>
              <CardContent><TrendMiniChart snapshots={pricingTrends} /></CardContent>
            </Card>
          )}

          <MetaGrid property={property} />
        </TabsContent>

        <TabsContent value="portals">
          <StubTab
            icon={Globe2}
            title="Property portals"
            phase="Phase 10"
            body="Toggle publish to Bayut, Property Finder, dubizzle, Aqar.fm, OpenSooq, OLX and more. Free 1 · Paid 3 + add-ons · Agency 6 + add-ons · Enterprise unlimited. Ships as part of the portal syndication module."
          />
        </TabsContent>

        <TabsContent value="comms" className="space-y-6">
          <SocialCardStudio property={property} />
          <PublishSocialTab property={property} />
          <InsightsSection listingId={property.id} />
          <CommentsSection listingId={property.id} />
        </TabsContent>

        <TabsContent value="email">
          <Card>
            <CardHeader>
              <CardTitle className="text-lg">Email campaign for this listing</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3 text-sm text-muted-foreground">
              <p>
                Launch a targeted email drip for this property. Uses the existing campaign engine —
                pick a contact segment, pick a template, schedule it.
              </p>
              <Link to={`/campaigns/new?listing=${property.id}`}>
                <Button className="gap-1.5">
                  <Mail className="h-4 w-4" />
                  New email campaign
                </Button>
              </Link>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="viewings" className="space-y-4">
          <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0">
              <CardTitle className="text-lg">Scheduled viewings & calls</CardTitle>
              <div className="flex gap-2">
                <Button size="sm" variant="outline" className="gap-1.5" onClick={() => setScheduleOpen('call')}>
                  <Phone className="h-4 w-4" />
                  Schedule call
                </Button>
                <Button size="sm" className="gap-1.5" onClick={() => setScheduleOpen('viewing')}>
                  <PlusCircle className="h-4 w-4" />
                  Schedule viewing
                </Button>
              </div>
            </CardHeader>
            <CardContent>
              {viewings.length === 0 ? (
                <p className="text-sm text-muted-foreground">
                  No viewings yet. Schedule one — reminders fire automatically to whoever you set on it.
                </p>
              ) : (
                <ul className="divide-y">
                  {viewings.map((v) => (
                    <li key={v.id} className="flex items-center justify-between py-2">
                      <div>
                        <div className="text-sm font-medium">
                          {new Date(v.scheduled_at).toLocaleString()}
                        </div>
                        <div className="text-xs text-muted-foreground">
                          {v.contact_name || 'Unnamed lead'} · {v.mode || 'in person'} · {v.status}
                        </div>
                      </div>
                      <Badge variant="outline">{v.status}</Badge>
                    </li>
                  ))}
                </ul>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="area">
          <PropertyScorePanel listingId={property.id} />
        </TabsContent>
      </Tabs>

      {editOpen && (
        <ListingFormModal
          open={editOpen}
          property={property}
          onClose={() => setEditOpen(false)}
          onSaved={(saved) => { setEditOpen(false); setProperty(saved) }}
        />
      )}

      {showComparables && (
        <ComparableListModal
          property={property}
          comparables={pricingComparables}
          onClose={() => setShowComparables(false)}
        />
      )}

      {confirmDelete && (
        <ConfirmDeleteModal
          busy={deleteBusy}
          title={property.title}
          onCancel={() => setConfirmDelete(false)}
          onConfirm={handleDelete}
        />
      )}

      {scheduleOpen && (
        <ScheduleModal
          kind={scheduleOpen}
          propertyId={property.id}
          onClose={() => setScheduleOpen(null)}
          onSaved={() => {
            setScheduleOpen(null)
            api.getViewings().then((rows: any) => {
              const list: Viewing[] = Array.isArray(rows) ? rows : []
              setViewings(list.filter((v: any) => v.property_id === property.id || v.listing_id === property.id))
            })
          }}
        />
      )}

      {aiOpen && (
        <AiDescribeModal
          property={property}
          onClose={() => setAiOpen(false)}
          onApplied={(updated) => {
            setProperty(updated)
            setAiOpen(false)
          }}
        />
      )}
    </div>
  )
}

/* -------------------------------- Sub-components -------------------------------- */

function Fact({ icon: Icon, label }: { icon: any; label: string }) {
  return (
    <span className="inline-flex items-center gap-1 text-sm text-muted-foreground">
      <Icon className="h-4 w-4" />
      {label}
    </span>
  )
}

function StatusSetter({
  status, onChange, busy,
}: { status: ListingStatus; onChange: (s: ListingStatus) => void; busy: boolean }) {
  const [open, setOpen] = useState(false)
  return (
    <div className="relative">
      <Button
        variant="outline"
        size="sm"
        className="gap-1.5"
        disabled={busy}
        onClick={() => setOpen((o) => !o)}
      >
        {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <MoreHorizontal className="h-4 w-4" />}
        Set status
      </Button>
      {open && (
        <>
          <button className="fixed inset-0 z-10 cursor-default" aria-label="close" onClick={() => setOpen(false)} />
          <div className="absolute right-0 top-full z-20 mt-1 w-56 rounded-md border bg-white p-1 shadow-lg">
            {LISTING_STATUSES.map((s) => {
              const m = LISTING_STATUS_META[s]
              const active = s === status
              return (
                <button
                  key={s}
                  type="button"
                  onClick={() => { setOpen(false); onChange(s) }}
                  className={`flex w-full items-start gap-2 rounded px-2 py-1.5 text-left text-xs hover:bg-muted ${
                    active ? 'bg-muted' : ''
                  }`}
                >
                  <span className={`mt-1 h-1.5 w-1.5 rounded-full ${m.dotClass}`} />
                  <div>
                    <div className="font-medium">{m.label}</div>
                    <div className="text-[11px] text-muted-foreground">{m.description}</div>
                  </div>
                </button>
              )
            })}
          </div>
        </>
      )}
    </div>
  )
}

function MetaGrid({ property }: { property: Property }) {
  const rows: Array<[string, string | number | undefined]> = [
    ['Property type', property.property_type],
    ['Reference', property.reference],
    ['Permit', property.permit_number],
    ['Furnished', property.furnished ? 'Yes' : 'No'],
    ['Developer', property.developed_by],
    ['Interior design', property.interior_design_by],
    ['Listing owner', property.listing_owner_type],
    ['Views', property.views],
  ]
  const visible = rows.filter(([, v]) => v !== undefined && v !== null && v !== '')
  if (!visible.length) return null
  return (
    <Card>
      <CardHeader><CardTitle className="text-lg">Details</CardTitle></CardHeader>
      <CardContent>
        <dl className="grid grid-cols-1 gap-x-6 gap-y-2 text-sm sm:grid-cols-2">
          {visible.map(([k, v]) => (
            <div key={k} className="flex justify-between border-b border-dashed border-slate-200 py-1.5">
              <dt className="text-muted-foreground">{k}</dt>
              <dd className="font-medium">{String(v)}</dd>
            </div>
          ))}
        </dl>
      </CardContent>
    </Card>
  )
}

function StubTab({
  icon: Icon, title, phase, body,
}: { icon: any; title: string; phase: string; body: string }) {
  return (
    <Card className="border-dashed">
      <CardContent className="flex items-start gap-4 py-8">
        <div className="rounded-full bg-slate-100 p-3">
          <Icon className="h-6 w-6 text-slate-600" />
        </div>
        <div>
          <div className="flex items-center gap-2">
            <h3 className="text-base font-semibold">{title}</h3>
            <Badge variant="outline" className="text-[10px]">{phase}</Badge>
          </div>
          <p className="mt-1 max-w-2xl text-sm text-muted-foreground">{body}</p>
        </div>
      </CardContent>
    </Card>
  )
}

function ConfirmDeleteModal({
  busy, title, onCancel, onConfirm,
}: { busy: boolean; title: string; onCancel: () => void; onConfirm: () => void }) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div className="w-full max-w-md rounded-lg bg-white p-6 shadow-xl">
        <h2 className="text-lg font-semibold">Delete this listing?</h2>
        <p className="mt-2 text-sm text-muted-foreground">
          "{title}" will be permanently removed. If you just want to hide it, archive it instead.
        </p>
        <div className="mt-6 flex justify-end gap-2">
          <Button variant="outline" onClick={onCancel} disabled={busy}>Cancel</Button>
          <Button
            className="bg-red-600 text-white hover:bg-red-700"
            onClick={onConfirm}
            disabled={busy}
          >
            {busy ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Trash2 className="mr-2 h-4 w-4" />}
            Delete
          </Button>
        </div>
      </div>
    </div>
  )
}

function ScheduleModal({
  kind, propertyId, onClose, onSaved,
}: {
  kind: 'viewing' | 'call'
  propertyId: string
  onClose: () => void
  onSaved: () => void
}) {
  const { addToast } = useToast()
  const [busy, setBusy] = useState(false)
  const [form, setForm] = useState({
    contact_name: '', contact_phone: '', contact_email: '',
    scheduled_at: '', mode: 'in_person', notes: '',
  })

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    if (busy) return
    setBusy(true)
    try {
      if (kind === 'viewing') {
        await api.createViewing({
          property_id: propertyId,
          scheduled_at: new Date(form.scheduled_at).toISOString(),
          mode: form.mode,
          contact_name: form.contact_name,
          contact_phone: form.contact_phone,
          contact_email: form.contact_email,
          notes: form.notes,
          status: 'scheduled',
        })
      } else {
        await api.scheduleCall({
          type: 'call',
          title: `Call with ${form.contact_name || 'lead'}`,
          due_at: new Date(form.scheduled_at).toISOString(),
          notes: form.notes,
          contact_email: form.contact_email,
          contact_phone: form.contact_phone,
          property_id: propertyId,
        })
      }
      addToast({ title: kind === 'viewing' ? 'Viewing scheduled' : 'Call scheduled', variant: 'success' })
      onSaved()
    } catch (err: any) {
      addToast({ title: 'Could not schedule', description: err?.message, variant: 'error' })
    } finally {
      setBusy(false)
    }
  }

  const title = kind === 'viewing' ? 'Schedule viewing' : 'Schedule call'

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div className="w-full max-w-md rounded-lg bg-white shadow-xl">
        <div className="flex items-center justify-between border-b p-4">
          <h2 className="text-lg font-semibold">{title}</h2>
          <button type="button" onClick={onClose} className="rounded-full p-1 hover:bg-muted">
            <X className="h-4 w-4" />
          </button>
        </div>
        <form onSubmit={submit} className="space-y-3 p-4 text-sm">
          <div>
            <Label className="text-xs">Contact name</Label>
            <Input value={form.contact_name} onChange={(e) => setForm({ ...form, contact_name: e.target.value })} />
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div>
              <Label className="text-xs">Phone</Label>
              <Input value={form.contact_phone} onChange={(e) => setForm({ ...form, contact_phone: e.target.value })} />
            </div>
            <div>
              <Label className="text-xs">Email</Label>
              <Input type="email" value={form.contact_email} onChange={(e) => setForm({ ...form, contact_email: e.target.value })} />
            </div>
          </div>
          <div>
            <Label className="text-xs">Date & time</Label>
            <Input required type="datetime-local" value={form.scheduled_at} onChange={(e) => setForm({ ...form, scheduled_at: e.target.value })} />
          </div>
          {kind === 'viewing' && (
            <div>
              <Label className="text-xs">Mode</Label>
              <select
                value={form.mode}
                onChange={(e) => setForm({ ...form, mode: e.target.value })}
                className="mt-0.5 block w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
              >
                <option value="in_person">In person</option>
                <option value="virtual">Virtual (video call)</option>
              </select>
            </div>
          )}
          <div>
            <Label className="text-xs">Notes</Label>
            <textarea
              rows={2}
              className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
              value={form.notes}
              onChange={(e) => setForm({ ...form, notes: e.target.value })}
            />
          </div>
          <div className="flex justify-end gap-2 pt-2">
            <Button type="button" variant="outline" onClick={onClose} disabled={busy}>Cancel</Button>
            <Button type="submit" disabled={busy} className="gap-1.5">
              {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Calendar className="h-4 w-4" />}
              Schedule
            </Button>
          </div>
        </form>
      </div>
    </div>
  )
}

interface PlatformInfo {
  id: string
  name: string
  type: string
  icon: string
  description?: string
  formats?: string[]
  capabilities?: Record<string, boolean>
  limitations?: string
  configured?: boolean
}

interface AgentConnection {
  id: string
  platform: string
  account_name?: string
  status: string
  health?: string
  settings?: Record<string, any>
}

function PublishSocialTab({ property }: { property: Property }) {
  const { addToast } = useToast()
  const [platforms, setPlatforms] = useState<PlatformInfo[]>([])
  const [connections, setConnections] = useState<AgentConnection[]>([])
  const [loading, setLoading] = useState(true)
  const [selected, setSelected] = useState<Record<string, string>>({}) // platform -> format
  const [caption, setCaption] = useState('')
  const [publishing, setPublishing] = useState(false)
  const [results, setResults] = useState<Array<{
    platform: string
    status: 'published' | 'failed'
    external_id: string | null
    external_url: string | null
    provider: string | null
    simulated: boolean
    error: string | null
  }>>([])

  useEffect(() => {
    let cancelled = false
    Promise.all([
      api.getPlatforms().catch(() => []),
      api.getMyConnections().catch(() => []),
    ]).then(([plats, conns]: any[]) => {
      if (cancelled) return
      setPlatforms(Array.isArray(plats) ? plats : [])
      setConnections(Array.isArray(conns) ? conns : [])
      setLoading(false)
    })
    return () => { cancelled = true }
  }, [])

  useEffect(() => {
    if (!caption) {
      const price = property.price ? ` · ${new Intl.NumberFormat().format(property.price)} ${property.price_unit || 'USD'}` : ''
      const where = [property.city, property.neighborhood].filter(Boolean).join(', ')
      setCaption(`${property.title}${where ? ` — ${where}` : ''}${price}\n\n${(property.description || '').slice(0, 500)}`.trim())
    }
  }, [property]) // eslint-disable-line react-hooks/exhaustive-deps

  const connectedPlatforms = useMemo(() => {
    const connectedIds = new Set(connections.filter((c) => c.status === 'connected').map((c) => c.platform))
    return platforms.filter((p) => p.type === 'social' && connectedIds.has(p.id))
  }, [platforms, connections])

  const availableUnconnected = useMemo(
    () => platforms.filter((p) => p.type === 'social' && !connectedPlatforms.find((cp) => cp.id === p.id)),
    [platforms, connectedPlatforms],
  )

  const chosen = Object.keys(selected)

  async function publish() {
    if (publishing || chosen.length === 0) return
    setPublishing(true)
    setResults([])
    try {
      const r = await api.publishListingToSocial(property.id, {
        channels: chosen.map((p) => ({ platform: p, format: selected[p] || undefined })),
        caption: caption.trim(),
        media_urls: property.photos || [],
      })
      setResults(r.results)
      const okCount = r.results.filter((x) => x.status === 'published').length
      if (okCount === r.results.length) {
        addToast({ title: `Published to ${okCount} channel${okCount === 1 ? '' : 's'}`, variant: 'success' })
      } else if (okCount === 0) {
        addToast({ title: 'All channels failed', variant: 'error' })
      } else {
        addToast({ title: `${okCount} of ${r.results.length} channels published`, variant: 'warning' })
      }
    } catch (err: any) {
      addToast({ title: 'Publish failed', description: err?.message, variant: 'error' })
    } finally {
      setPublishing(false)
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center rounded-md border border-dashed bg-white py-12">
        <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
      </div>
    )
  }

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle className="text-lg">Publish to social channels</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          {connectedPlatforms.length === 0 ? (
            <div className="rounded-md border border-dashed bg-slate-50 p-4 text-sm text-muted-foreground">
              No social channels connected yet. Head to{' '}
              <Link to="/settings/channels" className="text-primary underline">Settings → Channels</Link>{' '}
              to connect Instagram, Facebook, LinkedIn, X, or TikTok.
            </div>
          ) : (
            <div>
              <Label className="text-xs">Channels</Label>
              <div className="mt-1.5 grid grid-cols-1 gap-2 sm:grid-cols-2">
                {connectedPlatforms.map((p) => {
                  const isSelected = p.id in selected
                  const formats = Array.isArray(p.formats) ? p.formats : []
                  const format = selected[p.id]
                  return (
                    <div key={p.id} className={`flex items-start gap-2 rounded-md border p-2 ${isSelected ? 'bg-slate-50 border-slate-300' : ''}`}>
                      <input
                        type="checkbox"
                        checked={isSelected}
                        onChange={(e) => {
                          setSelected((prev) => {
                            const next = { ...prev }
                            if (e.target.checked) next[p.id] = formats[0] || ''
                            else delete next[p.id]
                            return next
                          })
                        }}
                        className="mt-1"
                      />
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                          <span className="text-sm font-medium">{p.name}</span>
                          {p.configured === false && (
                            <Badge variant="outline" className="text-[10px]">dev mode</Badge>
                          )}
                        </div>
                        {isSelected && formats.length > 1 && (
                          <select
                            value={format}
                            onChange={(e) =>
                              setSelected((prev) => ({ ...prev, [p.id]: e.target.value }))
                            }
                            className="mt-1 block w-full rounded border bg-white px-2 py-1 text-xs"
                          >
                            {formats.map((f) => (
                              <option key={f} value={f}>{f}</option>
                            ))}
                          </select>
                        )}
                      </div>
                    </div>
                  )
                })}
              </div>
              {availableUnconnected.length > 0 && (
                <p className="mt-2 text-xs text-muted-foreground">
                  Also available (not yet connected):{' '}
                  {availableUnconnected.map((p) => p.name).join(' · ')}
                </p>
              )}
            </div>
          )}

          <div>
            <Label className="text-xs">Caption</Label>
            <textarea
              rows={6}
              value={caption}
              onChange={(e) => setCaption(e.target.value)}
              className="mt-1 w-full rounded-md border border-input bg-background px-3 py-2 text-sm leading-relaxed"
            />
            <p className="mt-1 text-[11px] text-muted-foreground">
              {caption.length} chars — X truncates at 280, TikTok / IG accept much more.
            </p>
          </div>

          <div className="flex items-center justify-end">
            <Button
              onClick={publish}
              disabled={publishing || chosen.length === 0}
              className="gap-1.5"
            >
              {publishing ? <Loader2 className="h-4 w-4 animate-spin" /> : <Share2 className="h-4 w-4" />}
              Publish to {chosen.length || 0} channel{chosen.length === 1 ? '' : 's'}
            </Button>
          </div>
        </CardContent>
      </Card>

      {results.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-sm">Publish results</CardTitle>
          </CardHeader>
          <CardContent>
            <ul className="divide-y">
              {results.map((r, i) => (
                <li key={`${r.platform}-${i}`} className="flex items-start justify-between gap-3 py-2 text-sm">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="font-medium capitalize">{r.platform}</span>
                      <Badge
                        variant="outline"
                        className={r.status === 'published' ? 'border-emerald-200 bg-emerald-50 text-emerald-800' : 'border-red-200 bg-red-50 text-red-800'}
                      >
                        {r.status}
                      </Badge>
                      {r.simulated && <Badge variant="outline" className="text-[10px]">simulated</Badge>}
                    </div>
                    {r.error && <p className="mt-0.5 text-xs text-red-700">{r.error}</p>}
                    {r.provider && <p className="mt-0.5 text-[11px] text-muted-foreground">via {r.provider}</p>}
                  </div>
                  {r.external_url && (
                    <a
                      href={r.external_url}
                      target="_blank"
                      rel="noreferrer"
                      className="flex items-center gap-1 text-xs text-primary hover:underline"
                    >
                      Open <ExternalLink className="h-3 w-3" />
                    </a>
                  )}
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      )}
    </div>
  )
}

function AiDescribeModal({
  property, onClose, onApplied,
}: {
  property: Property
  onClose: () => void
  onApplied: (updated: Property) => void
}) {
  const { addToast } = useToast()
  const [busy, setBusy] = useState(false)
  const [applying, setApplying] = useState(false)
  const [result, setResult] = useState<Awaited<ReturnType<typeof api.describeListingFromPhotos>> | null>(null)
  const [draftTitle, setDraftTitle] = useState('')
  const [draftDescription, setDraftDescription] = useState('')

  const generate = useCallback(async () => {
    if (busy) return
    setBusy(true)
    try {
      const r = await api.describeListingFromPhotos({
        photo_urls: property.photos || [],
        hints: {
          city: property.city || undefined,
          neighborhood: property.neighborhood || undefined,
          type: (property.type === 'sale' || property.type === 'rent') ? property.type : undefined,
          property_type: property.property_type || undefined,
          price: typeof property.price === 'number' && property.price > 0 ? property.price : undefined,
          currency: property.price_unit || undefined,
        },
        intent: 'update',
        existing_listing: {
          title: property.title,
          description: property.description,
          property_type: property.property_type,
          bedrooms: property.bedrooms,
          bathrooms: property.bathrooms,
          area: property.area,
        },
      })
      setResult(r)
      setDraftTitle(r.property.title || property.title || '')
      setDraftDescription(r.property.description || '')
    } catch (err: any) {
      addToast({ title: 'AI draft failed', description: err?.message, variant: 'error' })
    } finally {
      setBusy(false)
    }
  }, [busy, property, addToast])

  useEffect(() => { generate() }, []) // eslint-disable-line react-hooks/exhaustive-deps

  async function apply() {
    if (applying) return
    setApplying(true)
    try {
      const updated = await api.updateProperty(property.id, {
        title: draftTitle.trim() || property.title,
        description: draftDescription.trim() || property.description,
      })
      addToast({ title: 'Applied to listing', variant: 'success' })
      onApplied({ ...property, ...updated, title: draftTitle.trim() || property.title, description: draftDescription.trim() || property.description })
    } catch (err: any) {
      addToast({ title: 'Could not apply', description: err?.message, variant: 'error' })
    } finally {
      setApplying(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div className="w-full max-w-2xl rounded-lg bg-white shadow-xl">
        <div className="flex items-center justify-between border-b p-4">
          <div className="flex items-center gap-2">
            <Sparkles className="h-5 w-5 text-amber-500" />
            <h2 className="text-lg font-semibold">AI-drafted description</h2>
          </div>
          <button type="button" onClick={onClose} className="rounded-full p-1 hover:bg-muted">
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="max-h-[70vh] overflow-y-auto p-4 space-y-4">
          {busy && (
            <div className="flex items-center gap-3 rounded-md border bg-slate-50 px-4 py-6 text-sm text-muted-foreground">
              <Loader2 className="h-5 w-5 animate-spin" />
              Reading {property.photos?.length || 0} photos and drafting a description…
            </div>
          )}

          {!busy && result && (
            <>
              <div className="flex items-center gap-2 text-xs text-muted-foreground">
                <Badge variant="outline">via {result.provider}</Badge>
                {typeof result.property.confidence === 'number' && (
                  <Badge variant="outline">
                    confidence {Math.round((result.property.confidence || 0) * 100)}%
                  </Badge>
                )}
              </div>

              <div>
                <Label className="text-xs">Title</Label>
                <Input
                  value={draftTitle}
                  onChange={(e) => setDraftTitle(e.target.value)}
                  className="mt-0.5"
                />
              </div>

              <div>
                <Label className="text-xs">Description</Label>
                <textarea
                  rows={10}
                  value={draftDescription}
                  onChange={(e) => setDraftDescription(e.target.value)}
                  className="mt-0.5 w-full rounded-md border border-input bg-background px-3 py-2 text-sm leading-relaxed"
                />
              </div>

              <ExtractedFieldsPreview extracted={result.property} current={property} />
            </>
          )}

          {!busy && !result && (
            <div className="rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">
              AI draft failed. Check that at least one AI provider key is set on the backend
              (WHATSAPP_LISTINGS_CLAUDE_API_KEY, WHATSAPP_LISTINGS_OPENAI_API_KEY, or one of the
              other provider vars).
            </div>
          )}
        </div>

        <div className="flex items-center justify-between gap-2 border-t p-4">
          <Button variant="outline" onClick={generate} disabled={busy || applying} className="gap-1.5">
            <Sparkles className="h-4 w-4" />
            Regenerate
          </Button>
          <div className="flex gap-2">
            <Button variant="outline" onClick={onClose} disabled={applying}>Discard</Button>
            <Button
              onClick={apply}
              disabled={busy || applying || !result || (!draftTitle.trim() && !draftDescription.trim())}
              className="gap-1.5"
            >
              {applying ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
              Apply to listing
            </Button>
          </div>
        </div>
      </div>
    </div>
  )
}

function ExtractedFieldsPreview({
  extracted, current,
}: { extracted: Awaited<ReturnType<typeof api.describeListingFromPhotos>>['property']; current: Property }) {
  const rows: Array<[string, string | number | null | undefined, string | number | null | undefined]> = [
    ['Property type', extracted.property_type, current.property_type],
    ['Bedrooms', extracted.bedrooms, current.bedrooms],
    ['Bathrooms', extracted.bathrooms, current.bathrooms],
    ['Area', extracted.area && extracted.area_unit ? `${extracted.area} ${extracted.area_unit}` : extracted.area, current.area],
    ['Furnished', extracted.furnished === null ? '—' : extracted.furnished ? 'Yes' : 'No', current.furnished ? 'Yes' : 'No'],
    ['Amenities', extracted.amenities?.length ? extracted.amenities.join(', ') : '—', current.amenities?.length ? current.amenities.join(', ') : '—'],
  ]
  const changed = rows.filter(([, e, c]) => String(e ?? '') && String(e ?? '').toLowerCase() !== String(c ?? '').toLowerCase())
  if (!changed.length) return null
  return (
    <div className="rounded-md border bg-slate-50 p-3 text-xs">
      <div className="mb-2 font-medium text-slate-700">Other fields the AI extracted (not applied — edit the listing to use these):</div>
      <dl className="grid grid-cols-1 gap-x-6 gap-y-1 sm:grid-cols-2">
        {changed.map(([label, e]) => (
          <div key={label} className="flex justify-between border-b border-dashed border-slate-200 py-1">
            <dt className="text-muted-foreground">{label}</dt>
            <dd className="max-w-[60%] truncate font-medium" title={String(e)}>{String(e)}</dd>
          </div>
        ))}
      </dl>
    </div>
  )
}

function InsightsSection({ listingId }: { listingId: string }) {
  const { addToast } = useToast()
  type DistT = Awaited<ReturnType<typeof api.getDistributions>>[number]
  const [dists, setDists] = useState<DistT[]>([])
  const [loading, setLoading] = useState(true)
  const [refreshingId, setRefreshingId] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const rows = await api.getDistributions(listingId)
      setDists(rows.filter((d) => d.status === 'published' && d.external_id))
    } catch (err: any) {
      addToast({ title: 'Could not load distributions', description: err?.message, variant: 'error' })
    } finally {
      setLoading(false)
    }
  }, [listingId, addToast])

  useEffect(() => { load() }, [load])

  async function refresh(id: string) {
    if (refreshingId) return
    setRefreshingId(id)
    try {
      await api.refreshDistributionInsights(id)
      addToast({ title: 'Insights refreshed', variant: 'success' })
      load()
    } catch (err: any) {
      addToast({ title: 'Insights refresh failed', description: err?.message, variant: 'error' })
    } finally {
      setRefreshingId(null)
    }
  }

  const totals = useMemo(() => {
    const t = { impressions: 0, likes: 0, comments: 0, shares: 0 }
    for (const d of dists) {
      t.impressions += (d.impressions || d.insights?.impressions || 0) as number
      t.likes += (d.likes || d.insights?.likes || 0) as number
      t.comments += (d.comments_count || d.insights?.comments || 0) as number
      t.shares += (d.shares || d.insights?.shares || 0) as number
    }
    return t
  }, [dists])

  const platformLabel: Record<string, string> = {
    instagram: 'Instagram', facebook: 'Facebook', tiktok: 'TikTok',
    x: 'X', linkedin: 'LinkedIn', whatsapp: 'WhatsApp',
  }

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-3">
        <div>
          <CardTitle className="text-lg">Post insights</CardTitle>
          <p className="mt-0.5 text-xs text-muted-foreground">
            {dists.length} published post{dists.length === 1 ? '' : 's'} · {formatMetricSummary(totals)}
          </p>
        </div>
        <Button size="sm" variant="ghost" onClick={load} disabled={loading} className="gap-1.5">
          {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <MessageCircle className="h-4 w-4" />}
          Reload
        </Button>
      </CardHeader>
      <CardContent>
        {loading ? (
          <div className="flex items-center justify-center py-6">
            <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
          </div>
        ) : dists.length === 0 ? (
          <p className="rounded-md border border-dashed bg-slate-50 p-4 text-sm text-muted-foreground">
            Publish this listing to a channel first — insights show up per published post.
          </p>
        ) : (
          <ul className="grid grid-cols-1 gap-2 sm:grid-cols-2">
            {dists.map((d) => {
              const m = {
                impressions: d.impressions ?? d.insights?.impressions ?? null,
                likes: d.likes ?? d.insights?.likes ?? null,
                comments: d.comments_count ?? d.insights?.comments ?? null,
                shares: d.shares ?? d.insights?.shares ?? null,
                saves: d.saves ?? d.insights?.saves ?? null,
                clicks: d.clicks ?? d.insights?.clicks ?? null,
              }
              const fetchedAt = d.insights_fetched_at || d.insights?.fetched_at || null
              const simulated = d.insights?.simulated || false
              return (
                <li key={d.id} className="rounded-lg border bg-white p-3">
                  <div className="flex items-center justify-between gap-2">
                    <div className="flex items-center gap-2">
                      <Badge variant="outline">{platformLabel[d.platform] || d.platform}</Badge>
                      {simulated && <Badge variant="outline" className="text-[10px]">simulated</Badge>}
                    </div>
                    <Button
                      size="sm"
                      variant="ghost"
                      className="gap-1"
                      onClick={() => refresh(d.id)}
                      disabled={refreshingId === d.id}
                    >
                      {refreshingId === d.id
                        ? <Loader2 className="h-3.5 w-3.5 animate-spin" />
                        : <Sparkles className="h-3.5 w-3.5" />}
                      Refresh
                    </Button>
                  </div>
                  <dl className="mt-2 grid grid-cols-3 gap-2 text-xs">
                    <Metric label="Views" value={m.impressions} />
                    <Metric label="Likes" value={m.likes} />
                    <Metric label="Comments" value={m.comments} />
                    <Metric label="Shares" value={m.shares} />
                    <Metric label="Saves" value={m.saves} />
                    <Metric label="Clicks" value={m.clicks} />
                  </dl>
                  {fetchedAt && (
                    <p className="mt-2 text-[10px] text-muted-foreground">
                      Updated {new Date(fetchedAt).toLocaleString()}
                    </p>
                  )}
                </li>
              )
            })}
          </ul>
        )}
      </CardContent>
    </Card>
  )
}

function Metric({ label, value }: { label: string; value: number | null | undefined }) {
  return (
    <div className="rounded border bg-slate-50 px-2 py-1">
      <div className="text-[10px] uppercase tracking-wide text-muted-foreground">{label}</div>
      <div className="text-sm font-semibold">
        {value == null ? '—' : Number(value).toLocaleString()}
      </div>
    </div>
  )
}

function formatMetricSummary(t: { impressions: number; likes: number; comments: number; shares: number }) {
  const parts: string[] = []
  if (t.impressions) parts.push(`${t.impressions.toLocaleString()} views`)
  if (t.likes) parts.push(`${t.likes.toLocaleString()} likes`)
  if (t.comments) parts.push(`${t.comments.toLocaleString()} comments`)
  if (t.shares) parts.push(`${t.shares.toLocaleString()} shares`)
  return parts.length ? parts.join(' · ') : 'no metrics yet'
}

const CATEGORY_COLORS: Record<string, string> = {
  hot_lead:    'bg-red-100 text-red-800 border-red-200',
  interest:    'bg-blue-100 text-blue-800 border-blue-200',
  investor:    'bg-indigo-100 text-indigo-800 border-indigo-200',
  question:    'bg-amber-100 text-amber-800 border-amber-200',
  objection:   'bg-orange-100 text-orange-800 border-orange-200',
  complaint:   'bg-rose-100 text-rose-800 border-rose-200',
  testimonial: 'bg-emerald-100 text-emerald-800 border-emerald-200',
  reaction:    'bg-slate-100 text-slate-700 border-slate-200',
  referral:    'bg-purple-100 text-purple-800 border-purple-200',
  spam:        'bg-zinc-100 text-zinc-500 border-zinc-200 line-through',
  general:     'bg-slate-100 text-slate-600 border-slate-200',
}

const SENTIMENT_DOT: Record<string, string> = {
  positive: 'bg-emerald-500',
  neutral:  'bg-slate-400',
  negative: 'bg-rose-500',
}

function PropertyScorePanel({ listingId }: { listingId: string }) {
  const [loading, setLoading] = useState(true)
  const [area, setArea] = useState<{ id: string; slug: string; name: string } | null>(null)
  const [livability, setLivability] = useState<number | null>(null)
  const [scoreCount, setScoreCount] = useState(0)

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    ;(async () => {
      try {
        const r = await api.getListingArea(listingId) as { area: any }
        if (cancelled) return
        if (!r.area) { setArea(null); setLoading(false); return }
        setArea(r.area)
        const full = await api.getArea(r.area.slug) as { area: any; scores: Array<{ score: number | null }> }
        if (cancelled) return
        setScoreCount(full.scores.length)
        const nums = full.scores.map((s) => s.score).filter((v): v is number => v != null && Number.isFinite(v))
        setLivability(nums.length ? nums.reduce((a, b) => a + b, 0) / nums.length : null)
      } catch {
        if (!cancelled) setArea(null)
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()
    return () => { cancelled = true }
  }, [listingId])

  if (loading) {
    return (
      <Card><CardContent className="flex items-center justify-center py-6">
        <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
      </CardContent></Card>
    )
  }

  if (!area) {
    return (
      <Card>
        <CardHeader><CardTitle className="text-lg">Property Score</CardTitle></CardHeader>
        <CardContent className="space-y-2 text-sm text-muted-foreground">
          <p>No scored neighborhood matches this listing yet.</p>
          <Link to={`/listings/${listingId}/neighborhood-valuator`}>
            <Button variant="outline" size="sm" className="gap-1.5">
              Open Neighborhood Valuator
            </Button>
          </Link>
        </CardContent>
      </Card>
    )
  }

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-3">
        <div>
          <CardTitle className="text-lg">Property Score</CardTitle>
          <p className="mt-0.5 text-xs text-muted-foreground">
            Scored area: <span className="font-medium">{area.name}</span> · {scoreCount} dimension{scoreCount === 1 ? '' : 's'}
          </p>
        </div>
        <Link to={`/listings/${listingId}/neighborhood-valuator`}>
          <Button size="sm" className="gap-1.5">
            Open Neighborhood Valuator
            <ChevronRight className="h-4 w-4" />
          </Button>
        </Link>
      </CardHeader>
      <CardContent>
        <div className="flex items-center gap-4 rounded-lg border bg-slate-50 p-4">
          <div className="text-center">
            <div className="text-4xl font-semibold text-slate-900">
              {livability == null ? '—' : livability.toFixed(1)}
            </div>
            <div className="text-[10px] uppercase tracking-wide text-muted-foreground">Livability / 10</div>
          </div>
          <div className="flex-1 text-sm text-muted-foreground">
            Overall neighborhood score based on {scoreCount} scored dimension{scoreCount === 1 ? '' : 's'}
            (schools, transport, safety, amenities). Open the full report to see per-dimension scores,
            proximity to key places, and Google Places signals.
          </div>
        </div>
      </CardContent>
    </Card>
  )
}

function CommentsSection({ listingId }: { listingId: string }) {
  const { addToast } = useToast()
  type Resp = Awaited<ReturnType<typeof api.getListingComments>>
  type ThreadT = Resp['threads'][number]
  type MessageT = ThreadT['messages'][number]
  const [threads, setThreads] = useState<ThreadT[]>([])
  const [publishedPosts, setPublishedPosts] = useState(0)
  const [summary, setSummary] = useState<Record<string, number>>({})
  const [categoryMeta, setCategoryMeta] = useState<Resp['category_meta']>({})
  const [loading, setLoading] = useState(true)
  const [replyOpenFor, setReplyOpenFor] = useState<string | null>(null)
  const [replyText, setReplyText] = useState('')
  const [replyBusy, setReplyBusy] = useState(false)
  const [categoryFilter, setCategoryFilter] = useState<Set<string>>(new Set())
  const [reclassifyOpenFor, setReclassifyOpenFor] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const opts = categoryFilter.size > 0 ? { category: Array.from(categoryFilter) } : undefined
      const r = await api.getListingComments(listingId, opts)
      setThreads(r.threads)
      setPublishedPosts(r.published_posts)
      setSummary(r.summary || {})
      setCategoryMeta(r.category_meta || {})
    } catch (err: any) {
      addToast({ title: 'Could not load comments', description: err?.message, variant: 'error' })
    } finally {
      setLoading(false)
    }
  }, [listingId, addToast, categoryFilter])

  useEffect(() => { load() }, [load])

  async function submitReply(conversationId: string) {
    if (replyBusy || !replyText.trim()) return
    setReplyBusy(true)
    try {
      await api.sendConversationMessage(conversationId, replyText.trim())
      addToast({ title: 'Reply sent', variant: 'success' })
      setReplyText('')
      setReplyOpenFor(null)
      load()
    } catch (err: any) {
      addToast({ title: 'Reply failed', description: err?.message, variant: 'error' })
    } finally {
      setReplyBusy(false)
    }
  }

  async function sendSuggested(conversationId: string, text: string) {
    if (!text?.trim()) return
    try {
      await api.sendConversationMessage(conversationId, text.trim())
      addToast({ title: 'Suggested reply sent', variant: 'success' })
      load()
    } catch (err: any) {
      addToast({ title: 'Reply failed', description: err?.message, variant: 'error' })
    }
  }

  async function reclassify(messageId: string, category: string, sentiment?: string) {
    try {
      await api.reclassifyComment(messageId, category, sentiment)
      addToast({ title: 'Reclassified', variant: 'success' })
      setReclassifyOpenFor(null)
      load()
    } catch (err: any) {
      addToast({ title: 'Reclassify failed', description: err?.message, variant: 'error' })
    }
  }

  function toggleCategoryFilter(cat: string) {
    setCategoryFilter((prev) => {
      const next = new Set(prev)
      if (next.has(cat)) next.delete(cat)
      else next.add(cat)
      return next
    })
  }

  const channelLabel: Record<string, string> = {
    instagram_comment: 'Instagram',
    facebook_comment: 'Facebook',
    tiktok_comment: 'TikTok',
    x_mention: 'X',
    linkedin_comment: 'LinkedIn',
  }

  // Ordered list of categories for the filter bar (mirrors backend priority).
  const filterOrder = ['hot_lead', 'interest', 'investor', 'question', 'objection', 'complaint', 'testimonial', 'reaction', 'referral', 'general', 'spam']

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-3">
        <div>
          <CardTitle className="text-lg">Comments on your published posts</CardTitle>
          <p className="mt-0.5 text-xs text-muted-foreground">
            Across {publishedPosts} published post{publishedPosts === 1 ? '' : 's'} · replies use the
            same tenant credentials you set on <Link to="/settings/channels" className="text-primary underline">Settings → Channels</Link>.
          </p>
        </div>
        <Button size="sm" variant="ghost" onClick={load} disabled={loading} className="gap-1.5">
          {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <MessageCircle className="h-4 w-4" />}
          Refresh
        </Button>
      </CardHeader>
      <CardContent className="space-y-3">
        {/* Filter chips */}
        {Object.keys(categoryMeta).length > 0 && (
          <div className="flex flex-wrap gap-1.5">
            <button
              type="button"
              onClick={() => setCategoryFilter(new Set())}
              className={`rounded-full border px-2.5 py-0.5 text-xs font-medium transition-colors ${
                categoryFilter.size === 0
                  ? 'bg-slate-900 text-white border-slate-900'
                  : 'bg-white text-muted-foreground hover:bg-muted'
              }`}
            >
              All ({Object.values(summary).reduce((s, n) => s + (n || 0), 0)})
            </button>
            {filterOrder.map((cat) => {
              const meta = categoryMeta[cat]
              if (!meta) return null
              const count = summary[cat] || 0
              if (count === 0 && !categoryFilter.has(cat)) return null
              const active = categoryFilter.has(cat)
              return (
                <button
                  key={cat}
                  type="button"
                  onClick={() => toggleCategoryFilter(cat)}
                  className={`inline-flex items-center gap-1 rounded-full border px-2.5 py-0.5 text-xs font-medium transition-colors ${
                    active ? 'ring-2 ring-offset-1 ring-slate-900' : ''
                  } ${CATEGORY_COLORS[cat] || CATEGORY_COLORS.general}`}
                  title={meta.description}
                >
                  <span>{meta.emoji}</span>
                  <span>{meta.label}</span>
                  <span className="opacity-70">({count})</span>
                </button>
              )
            })}
          </div>
        )}

        {loading ? (
          <div className="flex items-center justify-center py-6">
            <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
          </div>
        ) : threads.length === 0 ? (
          <p className="rounded-md border border-dashed bg-slate-50 p-4 text-sm text-muted-foreground">
            {categoryFilter.size > 0
              ? 'No comments match the current filter. Clear filters to see everything.'
              : 'No comments yet. Once your published posts start getting engagement, comment threads will appear here — reply inline without leaving ListingClarion.'}
          </p>
        ) : (
          <ul className="space-y-4">
            {threads.map((t) => {
              const displayName = t.contact?.name || t.messages[0]?.author_name || 'Someone'
              const topCat = t.top_category
              const topMeta = topCat ? categoryMeta[topCat] : null
              return (
                <li key={t.conversation_id} className="rounded-lg border bg-white p-3">
                  <div className="flex items-center justify-between gap-2 pb-2">
                    <div className="flex flex-wrap items-center gap-2">
                      <Badge variant="outline">{channelLabel[t.channel] || t.channel}</Badge>
                      {topMeta && (
                        <span
                          className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] font-medium ${CATEGORY_COLORS[topCat!] || CATEGORY_COLORS.general}`}
                          title={topMeta.description}
                        >
                          {topMeta.emoji} {topMeta.label}
                        </span>
                      )}
                      {t.needs_agent_attention && (
                        <span
                          className="inline-flex items-center gap-1 rounded-full border border-rose-300 bg-rose-100 px-2 py-0.5 text-[10px] font-semibold text-rose-800 animate-pulse"
                          title="Needs agent attention (flagged by router)"
                        >
                          ⚑ Needs attention
                        </span>
                      )}
                      <span className="text-sm font-medium">{displayName}</span>
                    </div>
                    {t.distribution_url && (
                      <a
                        href={t.distribution_url}
                        target="_blank"
                        rel="noreferrer"
                        className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
                      >
                        <ExternalLink className="h-3 w-3" />
                        View post
                      </a>
                    )}
                  </div>
                  <ul className="space-y-1.5 border-t pt-2">
                    {t.messages.map((m) => (
                      <MessageRow
                        key={m.id}
                        message={m}
                        categoryMeta={categoryMeta}
                        reclassifyOpen={reclassifyOpenFor === m.id}
                        onOpenReclassify={() => setReclassifyOpenFor(reclassifyOpenFor === m.id ? null : m.id)}
                        onReclassify={(cat, sent) => reclassify(m.id, cat, sent)}
                        onSendSuggestedReply={(text) => sendSuggested(t.conversation_id, text)}
                      />
                    ))}
                  </ul>
                  {replyOpenFor === t.conversation_id ? (
                    <div className="mt-2 flex gap-2">
                      <Input
                        value={replyText}
                        onChange={(e) => setReplyText(e.target.value)}
                        placeholder="Type a reply…"
                        onKeyDown={(e) => {
                          if (e.key === 'Enter' && !e.shiftKey) {
                            e.preventDefault()
                            submitReply(t.conversation_id)
                          }
                        }}
                        autoFocus
                      />
                      <Button size="sm" onClick={() => submitReply(t.conversation_id)} disabled={replyBusy}>
                        {replyBusy ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Send'}
                      </Button>
                      <Button size="sm" variant="ghost" onClick={() => { setReplyOpenFor(null); setReplyText('') }}>
                        Cancel
                      </Button>
                    </div>
                  ) : (
                    <div className="mt-2">
                      <Button size="sm" variant="outline" onClick={() => { setReplyOpenFor(t.conversation_id); setReplyText('') }}>
                        Reply
                      </Button>
                    </div>
                  )}
                </li>
              )
            })}
          </ul>
        )}
      </CardContent>
    </Card>
  )
}

function MessageRow({
  message: m,
  categoryMeta,
  reclassifyOpen,
  onOpenReclassify,
  onReclassify,
  onSendSuggestedReply,
}: {
  message: {
    id: string
    direction: 'inbound' | 'outbound'
    content: string
    created_at: string
    author_name: string | null
    status: string
    category: string | null
    sentiment: 'positive' | 'neutral' | 'negative' | null
    category_confidence: number | null
    category_source: 'rules' | 'ai' | 'manual' | null
    suggested_reply?: string | null
    needs_agent_attention?: boolean
    priority?: 'low' | 'normal' | 'high' | 'urgent' | null
    is_hidden?: boolean
    routings?: Array<{
      id: string
      category: string
      route: string | null
      outcomes: Array<{ type: string; ref_id?: string; at: string; notes?: string }>
      created_at: string
    }>
  }
  categoryMeta: Record<string, { label: string; emoji: string; description: string; route: string }>
  reclassifyOpen: boolean
  onOpenReclassify: () => void
  onReclassify: (category: string, sentiment?: string) => void
  onSendSuggestedReply?: (text: string) => void
}) {
  const meta = m.category ? categoryMeta[m.category] : null
  const bubbleClass = m.direction === 'inbound'
    ? 'rounded-md bg-slate-50 px-2.5 py-1.5 text-sm'
    : 'ml-8 rounded-md bg-slate-900 px-2.5 py-1.5 text-sm text-white'
  const sourceLabel = m.category_source
    ? m.category_source === 'manual' ? '· manual' : m.category_source === 'ai' ? '· AI' : '· rules'
    : ''
  return (
    <li className={bubbleClass}>
      <div className="whitespace-pre-wrap">{m.content}</div>
      <div className={`mt-0.5 flex items-center gap-2 text-[10px] ${m.direction === 'inbound' ? 'text-muted-foreground' : 'text-white/70'}`}>
        <span>{new Date(m.created_at).toLocaleString()}</span>
        {m.direction === 'outbound' && <span>· {m.status}</span>}
        {m.direction === 'inbound' && meta && (
          <span className="inline-flex items-center gap-1">
            <span className={`inline-flex items-center gap-1 rounded-full border px-1.5 py-0 text-[10px] font-medium ${CATEGORY_COLORS[m.category!] || CATEGORY_COLORS.general}`}>
              {meta.emoji} {meta.label}
            </span>
            {m.sentiment && (
              <span title={`sentiment: ${m.sentiment}`} className={`inline-block h-1.5 w-1.5 rounded-full ${SENTIMENT_DOT[m.sentiment] || SENTIMENT_DOT.neutral}`} />
            )}
            <span className="opacity-70">{sourceLabel}</span>
          </span>
        )}
        {m.direction === 'inbound' && (
          <button
            type="button"
            onClick={onOpenReclassify}
            className="ml-auto text-[10px] text-slate-500 hover:text-slate-800 hover:underline"
          >
            {reclassifyOpen ? 'cancel' : 'reclassify'}
          </button>
        )}
      </div>
      {reclassifyOpen && (
        <div className="mt-1.5 flex flex-wrap gap-1 rounded border border-dashed bg-white p-1.5">
          {Object.entries(categoryMeta).map(([cat, cm]) => (
            <button
              key={cat}
              type="button"
              onClick={() => onReclassify(cat)}
              className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] hover:ring-1 hover:ring-slate-900 ${CATEGORY_COLORS[cat] || CATEGORY_COLORS.general}`}
            >
              {cm.emoji} {cm.label}
            </button>
          ))}
        </div>
      )}

      {/* Routing outcome badges — surface what the router did per message. */}
      {m.direction === 'inbound' && m.routings && m.routings.length > 0 && (
        <div className="mt-1 flex flex-wrap gap-1">
          {m.routings.flatMap((r) => r.outcomes.map((o, i) => (
            <RoutingOutcomeChip key={`${r.id}-${i}`} type={o.type} notes={o.notes || undefined} />
          )))}
        </div>
      )}

      {/* Suggested reply drafted by the router — agent can send / edit / dismiss. */}
      {m.direction === 'inbound' && m.suggested_reply && (
        <div className="mt-1.5 rounded-md border border-amber-200 bg-amber-50 p-2 text-xs">
          <div className="mb-0.5 flex items-center gap-1 text-[10px] font-medium text-amber-900">
            <Sparkles className="h-3 w-3" />
            Suggested reply (agent review)
          </div>
          <div className="whitespace-pre-wrap text-amber-900">{m.suggested_reply}</div>
          {onSendSuggestedReply && (
            <div className="mt-1 flex gap-1.5">
              <Button
                size="sm"
                variant="outline"
                className="h-6 gap-1 px-2 text-[10px]"
                onClick={() => onSendSuggestedReply(m.suggested_reply!)}
              >
                Send as-is
              </Button>
            </div>
          )}
        </div>
      )}
    </li>
  )
}

function RoutingOutcomeChip({ type, notes }: { type: string; notes?: string }) {
  const meta: Record<string, { label: string; className: string; icon?: string }> = {
    reply_sent:              { label: 'Reply sent',            className: 'bg-emerald-100 text-emerald-800 border-emerald-200', icon: '↩' },
    reply_drafted:           { label: 'Reply drafted',         className: 'bg-amber-100 text-amber-800 border-amber-200',       icon: '✎' },
    reply_suppressed:        { label: 'Auto-reply suppressed', className: 'bg-slate-100 text-slate-700 border-slate-200',       icon: '⊘' },
    opportunity_created:     { label: 'Opportunity opened',    className: 'bg-blue-100 text-blue-800 border-blue-200',          icon: '⚡' },
    inquiry_created:         { label: 'Inquiry created',       className: 'bg-indigo-100 text-indigo-800 border-indigo-200',    icon: '?' },
    engagement_incremented:  { label: 'Engagement counted',    className: 'bg-slate-100 text-slate-700 border-slate-200',       icon: '+' },
    agent_notified:          { label: 'Agent notified',        className: 'bg-rose-100 text-rose-800 border-rose-200',          icon: '!' },
    agency_owner_notified:   { label: 'Owner notified',        className: 'bg-rose-100 text-rose-800 border-rose-200',          icon: '‼' },
    marketing_queued:        { label: 'Marketing queue',       className: 'bg-emerald-100 text-emerald-800 border-emerald-200', icon: '★' },
    ai_watcher_subscribed:   { label: 'AI watching thread',    className: 'bg-purple-100 text-purple-800 border-purple-200',    icon: '👁' },
    hidden:                  { label: 'Hidden (spam)',         className: 'bg-zinc-100 text-zinc-500 border-zinc-200',          icon: '×' },
    flagged_for_agent:       { label: 'Flagged for agent',     className: 'bg-orange-100 text-orange-800 border-orange-200',    icon: '⚑' },
    skipped:                 { label: 'Skipped',               className: 'bg-slate-100 text-slate-500 border-slate-200',       icon: '·' },
  }
  const m = meta[type] || { label: type, className: 'bg-slate-100 text-slate-600 border-slate-200' }
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full border px-1.5 py-0 text-[10px] font-medium ${m.className}`}
      title={notes ? `${m.label} — ${notes}` : m.label}
    >
      {m.icon && <span className="opacity-70">{m.icon}</span>}
      {m.label}
    </span>
  )
}

// Silence unused-icon warnings for imports kept for near-term feature additions.
void [Camera, Video, Copy, Megaphone]
