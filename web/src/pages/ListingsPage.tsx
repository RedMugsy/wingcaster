import { useEffect, useMemo, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import {
  Building2, Grid3x3, List, LayoutGrid, Plus, Search, Loader2, MapPin,
  Eye, Filter,
} from 'lucide-react'
import { api } from '@/api/client'
import { useAuth } from '@/context/AuthContext'
import { useToast } from '@/components/ui/toast'
import { usePageTitle } from '@/lib/usePageTitle'
import { formatPrice } from '@/lib/format'
import {
  LISTING_STATUSES, LISTING_STATUS_META, normalizeStatus, type ListingStatus,
} from '@/lib/listingStatus'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import { PropertyCard } from '@/components/PropertyCard'
import { ListingFormModal } from '@/components/ListingFormModal'
import type { Property } from '@/types'

type ViewMode = 'card' | 'list' | 'gallery'
type StatusFilter = 'all' | ListingStatus

export function ListingsPage() {
  const { agent, loading: authLoading } = useAuth()
  const { addToast } = useToast()
  const navigate = useNavigate()
  usePageTitle('Listings')

  const [listings, setListings] = useState<Property[]>([])
  const [loading, setLoading] = useState(true)
  const [viewMode, setViewMode] = useState<ViewMode>('card')
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all')
  const [typeFilter, setTypeFilter] = useState<'all' | 'sale' | 'rent'>('all')
  const [query, setQuery] = useState('')
  const [createOpen, setCreateOpen] = useState(false)

  useEffect(() => {
    if (authLoading) return
    if (!agent) {
      setLoading(false)
      return
    }
    loadListings()
  }, [agent, authLoading])

  async function loadListings() {
    setLoading(true)
    try {
      const params: Record<string, string> = { agent_id: agent!.id }
      const data = await api.getProperties(params)
      const rows: Property[] = Array.isArray(data) ? data : []
      const mine = rows.filter((r) => r.agent_id === agent!.id)
      setListings(mine)
    } catch (err: any) {
      addToast({ title: 'Could not load listings', description: err?.message, variant: 'error' })
    } finally {
      setLoading(false)
    }
  }

  const counts = useMemo(() => {
    const c: Record<ListingStatus | 'all', number> = {
      all: listings.length, draft: 0, published: 0, unpublished: 0, archived: 0,
    }
    for (const l of listings) c[normalizeStatus(l.status)]++
    return c
  }, [listings])

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    return listings.filter((l) => {
      if (statusFilter !== 'all' && normalizeStatus(l.status) !== statusFilter) return false
      if (typeFilter !== 'all' && l.type !== typeFilter) return false
      if (q) {
        const hay = [l.title, l.location, l.city, l.neighborhood, l.reference, l.address]
          .filter(Boolean).join(' ').toLowerCase()
        if (!hay.includes(q)) return false
      }
      return true
    })
  }, [listings, statusFilter, typeFilter, query])

  if (authLoading || loading) {
    return (
      <div className="flex min-h-[60vh] items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    )
  }

  if (!agent) {
    return (
      <div className="mx-auto max-w-2xl px-4 py-16 text-center">
        <h1 className="text-2xl font-semibold">Sign in to manage listings</h1>
        <p className="mt-2 text-muted-foreground">Your listings are private to your account.</p>
        <Link to="/login" className="mt-4 inline-block">
          <Button>Sign in</Button>
        </Link>
      </div>
    )
  }

  return (
    <div className="mx-auto max-w-7xl px-4 py-6 sm:px-6 lg:px-8">
      <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Listings</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {counts.all} total · {counts.published} published · {counts.draft} draft
          </p>
        </div>
        <Button onClick={() => setCreateOpen(true)} className="gap-1.5">
          <Plus className="h-4 w-4" />
          New listing
        </Button>
      </div>

      <div className="mb-4 flex flex-wrap items-center gap-2 rounded-lg border bg-white p-3">
        <div className="relative flex-1 min-w-[220px]">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search by title, location, or reference"
            className="pl-9"
          />
        </div>

        <div className="flex items-center gap-1 rounded-md border p-0.5">
          {(['all', ...LISTING_STATUSES] as StatusFilter[]).map((s) => {
            const isActive = statusFilter === s
            const label = s === 'all' ? 'All' : LISTING_STATUS_META[s].label
            return (
              <button
                key={s}
                type="button"
                onClick={() => setStatusFilter(s)}
                className={`flex items-center gap-1.5 rounded px-2.5 py-1 text-xs font-medium transition-colors ${
                  isActive ? 'bg-slate-900 text-white' : 'text-muted-foreground hover:bg-muted'
                }`}
              >
                {s !== 'all' && (
                  <span className={`h-1.5 w-1.5 rounded-full ${LISTING_STATUS_META[s].dotClass}`} />
                )}
                {label}
                <span className="text-[10px] opacity-70">({counts[s]})</span>
              </button>
            )
          })}
        </div>

        <div className="flex items-center gap-1 rounded-md border p-0.5">
          {(['all', 'sale', 'rent'] as const).map((t) => (
            <button
              key={t}
              type="button"
              onClick={() => setTypeFilter(t)}
              className={`rounded px-2.5 py-1 text-xs font-medium capitalize transition-colors ${
                typeFilter === t ? 'bg-slate-900 text-white' : 'text-muted-foreground hover:bg-muted'
              }`}
            >
              {t === 'all' ? 'All' : t === 'sale' ? 'For sale' : 'For rent'}
            </button>
          ))}
        </div>

        <div className="ml-auto flex items-center gap-1 rounded-md border p-0.5">
          <ViewToggle mode="card" active={viewMode} onSelect={setViewMode} />
          <ViewToggle mode="list" active={viewMode} onSelect={setViewMode} />
          <ViewToggle mode="gallery" active={viewMode} onSelect={setViewMode} />
        </div>
      </div>

      {filtered.length === 0 ? (
        <EmptyState
          hasAny={listings.length > 0}
          onCreate={() => setCreateOpen(true)}
          onClearFilters={() => { setStatusFilter('all'); setTypeFilter('all'); setQuery('') }}
        />
      ) : viewMode === 'card' ? (
        <CardGrid items={filtered} />
      ) : viewMode === 'list' ? (
        <ListView items={filtered} onOpen={(id) => navigate(`/listings/${id}`)} />
      ) : (
        <GalleryGrid items={filtered} />
      )}

      {createOpen && (
        <ListingFormModal
          open={createOpen}
          onClose={() => setCreateOpen(false)}
          onSaved={() => { setCreateOpen(false); loadListings() }}
        />
      )}
    </div>
  )
}

function ViewToggle({
  mode, active, onSelect,
}: { mode: ViewMode; active: ViewMode; onSelect: (m: ViewMode) => void }) {
  const Icon = mode === 'card' ? Grid3x3 : mode === 'list' ? List : LayoutGrid
  const label = mode === 'card' ? 'Card' : mode === 'list' ? 'List' : 'Gallery'
  return (
    <button
      type="button"
      onClick={() => onSelect(mode)}
      aria-label={`${label} view`}
      title={`${label} view`}
      className={`flex items-center gap-1.5 rounded px-2.5 py-1 text-xs font-medium transition-colors ${
        active === mode ? 'bg-slate-900 text-white' : 'text-muted-foreground hover:bg-muted'
      }`}
    >
      <Icon className="h-3.5 w-3.5" />
      <span className="hidden sm:inline">{label}</span>
    </button>
  )
}

function CardGrid({ items }: { items: Property[] }) {
  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
      {items.map((p) => (
        <div key={p.id} className="relative">
          <div className="absolute left-3 top-3 z-10">
            <StatusPill status={normalizeStatus(p.status)} />
          </div>
          <PropertyCard property={p} />
        </div>
      ))}
    </div>
  )
}

function ListView({
  items, onOpen,
}: { items: Property[]; onOpen: (id: string) => void }) {
  return (
    <div className="overflow-hidden rounded-lg border bg-white">
      <table className="min-w-full divide-y divide-slate-200">
        <thead className="bg-slate-50 text-left text-xs uppercase tracking-wide text-muted-foreground">
          <tr>
            <th className="px-4 py-2.5">Listing</th>
            <th className="px-4 py-2.5">Type</th>
            <th className="px-4 py-2.5">Price</th>
            <th className="px-4 py-2.5">Status</th>
            <th className="px-4 py-2.5">Views</th>
            <th className="px-4 py-2.5">Listed</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-100 text-sm">
          {items.map((p) => {
            const photo = p.photos?.[0] || '/placeholder-property.svg'
            return (
              <tr
                key={p.id}
                onClick={() => onOpen(p.id)}
                className="cursor-pointer hover:bg-slate-50"
              >
                <td className="px-4 py-2.5">
                  <div className="flex items-center gap-3">
                    <img src={photo} alt="" className="h-10 w-14 rounded object-cover" />
                    <div className="min-w-0">
                      <div className="line-clamp-1 font-medium text-slate-900">{p.title}</div>
                      <div className="line-clamp-1 flex items-center gap-1 text-xs text-muted-foreground">
                        <MapPin className="h-3 w-3" />
                        {p.location}
                      </div>
                    </div>
                  </div>
                </td>
                <td className="px-4 py-2.5 capitalize text-muted-foreground">
                  {p.property_type} · {p.type === 'sale' ? 'Sale' : 'Rent'}
                </td>
                <td className="px-4 py-2.5 font-medium">
                  {formatPrice(p.price, p.type, p.price_unit)}
                </td>
                <td className="px-4 py-2.5">
                  <StatusPill status={normalizeStatus(p.status)} />
                </td>
                <td className="px-4 py-2.5 text-muted-foreground">
                  <span className="inline-flex items-center gap-1">
                    <Eye className="h-3.5 w-3.5" />
                    {(p.views || 0).toLocaleString()}
                  </span>
                </td>
                <td className="px-4 py-2.5 text-muted-foreground">
                  {p.listed_date ? new Date(p.listed_date).toLocaleDateString() : '—'}
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}

function GalleryGrid({ items }: { items: Property[] }) {
  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5">
      {items.map((p) => {
        const photo = p.photos?.[0] || '/placeholder-property.svg'
        return (
          <Link
            key={p.id}
            to={`/listings/${p.id}`}
            className="group relative aspect-square overflow-hidden rounded-lg border bg-slate-100"
          >
            <img
              src={photo}
              alt={p.title}
              className="h-full w-full object-cover transition-transform duration-500 group-hover:scale-105"
            />
            <div className="absolute left-2 top-2">
              <StatusPill status={normalizeStatus(p.status)} compact />
            </div>
            <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/70 to-transparent p-2">
              <div className="line-clamp-1 text-xs font-medium text-white">{p.title}</div>
              <div className="line-clamp-1 text-[11px] text-white/80">
                {formatPrice(p.price, p.type, p.price_unit)}
              </div>
            </div>
          </Link>
        )
      })}
    </div>
  )
}

function StatusPill({ status, compact = false }: { status: ListingStatus; compact?: boolean }) {
  const meta = LISTING_STATUS_META[status]
  return (
    <Badge
      variant="outline"
      className={`gap-1 border ${meta.badgeClass} ${compact ? 'text-[10px] py-0 px-1.5' : ''}`}
    >
      <span className={`h-1.5 w-1.5 rounded-full ${meta.dotClass}`} />
      {meta.label}
    </Badge>
  )
}

function EmptyState({
  hasAny, onCreate, onClearFilters,
}: { hasAny: boolean; onCreate: () => void; onClearFilters: () => void }) {
  if (!hasAny) {
    return (
      <div className="mx-auto max-w-md rounded-lg border-2 border-dashed border-slate-200 bg-white px-8 py-16 text-center">
        <Building2 className="mx-auto mb-3 h-10 w-10 text-muted-foreground" />
        <h3 className="text-lg font-semibold">Your first listing awaits</h3>
        <p className="mt-1 text-sm text-muted-foreground">
          Add photos, price, and details — or drop photos and let AI draft the description.
        </p>
        <Button onClick={onCreate} className="mt-4 gap-1.5">
          <Plus className="h-4 w-4" />
          Create a listing
        </Button>
      </div>
    )
  }
  return (
    <div className="rounded-lg border bg-white px-8 py-12 text-center text-sm text-muted-foreground">
      <Filter className="mx-auto mb-2 h-5 w-5" />
      No listings match the current filters.
      <div>
        <button type="button" onClick={onClearFilters} className="mt-2 text-primary hover:underline">
          Clear filters
        </button>
      </div>
    </div>
  )
}

