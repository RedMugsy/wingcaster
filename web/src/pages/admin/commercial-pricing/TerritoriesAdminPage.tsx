import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { api } from '@/api/client'
import { useAuth } from '@/context/AuthContext'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { LaunchStatusBadge } from '@/components/commercial-pricing/LaunchStatusBadge'
import { ConfirmDeactivateDialog } from '@/components/commercial-pricing/ConfirmDeactivateDialog'
import { TerritoryFormDialog } from './TerritoryFormDialog'
import type { LaunchStatus, Territory, Zone, City } from '@/types/commercialPricing'

const WAVE_OPTIONS: Array<{ value: number | 'unwaved'; label: string }> = [
  { value: 1, label: 'Wave 1' },
  { value: 2, label: 'Wave 2' },
  { value: 3, label: 'Wave 3' },
  { value: 'unwaved', label: 'Unwaved' },
]

const STATUS_OPTIONS: LaunchStatus[] = ['launched', 'planned', 'blocked', 'sunset']

export function TerritoriesAdminPage() {
  const { isAdmin } = useAuth()
  const [territories, setTerritories] = useState<Territory[]>([])
  const [zonesByTerritory, setZonesByTerritory] = useState<Record<string, number>>({})
  const [citiesByTerritory, setCitiesByTerritory] = useState<Record<string, number>>({})
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [includeInactive, setIncludeInactive] = useState(false)
  const [waveFilter, setWaveFilter] = useState<Set<number | 'unwaved'>>(new Set())
  const [statusFilter, setStatusFilter] = useState<Set<LaunchStatus>>(new Set())
  const [search, setSearch] = useState('')
  const [formOpen, setFormOpen] = useState(false)
  const [editing, setEditing] = useState<Territory | null>(null)
  const [deactivating, setDeactivating] = useState<Territory | null>(null)

  useEffect(() => { if (isAdmin) void load() }, [isAdmin, includeInactive])

  async function load() {
    setLoading(true)
    setError(null)
    try {
      const { territories } = await api.listAdminTerritories({ include_inactive: includeInactive })
      setTerritories(territories)

      const [{ zones }, { cities }] = await Promise.all([
        api.listAdminZones({ include_inactive: true }),
        api.listAdminCities({ include_inactive: true }),
      ])
      setZonesByTerritory(countBy(zones, (z: Zone) => z.territory_id))
      setCitiesByTerritory(countBy(cities, (c: City) => c.territory_id))
    } catch (err: any) {
      setError(err?.message || 'Failed to load territories')
    } finally {
      setLoading(false)
    }
  }

  const filtered = useMemo(() => {
    const needle = search.trim().toLowerCase()
    return territories.filter((t) => {
      if (waveFilter.size > 0) {
        const key: number | 'unwaved' = t.launch_wave ?? 'unwaved'
        if (!waveFilter.has(key)) return false
      }
      if (statusFilter.size > 0 && !statusFilter.has(t.launch_status)) return false
      if (needle) {
        const hay = `${t.code} ${t.name || ''}`.toLowerCase()
        if (!hay.includes(needle)) return false
      }
      return true
    })
  }, [territories, waveFilter, statusFilter, search])

  function toggleWave(value: number | 'unwaved') {
    setWaveFilter((prev) => {
      const next = new Set(prev)
      if (next.has(value)) next.delete(value); else next.add(value)
      return next
    })
  }

  function toggleStatus(value: LaunchStatus) {
    setStatusFilter((prev) => {
      const next = new Set(prev)
      if (next.has(value)) next.delete(value); else next.add(value)
      return next
    })
  }

  async function handleDeactivate() {
    if (!deactivating) return
    try {
      await api.deactivateAdminTerritory(deactivating.id)
      setDeactivating(null)
      await load()
    } catch (err: any) {
      setError(err?.message || 'Deactivation failed')
    }
  }

  if (!isAdmin) {
    return (
      <div className="container mx-auto max-w-2xl px-4 py-8">
        <Card>
          <CardHeader><CardTitle>Platform admin required</CardTitle></CardHeader>
          <CardContent className="text-sm text-muted-foreground">
            Commercial pricing configuration is restricted to platform admins.
          </CardContent>
        </Card>
      </div>
    )
  }

  return (
    <div className="container mx-auto px-4 py-8">
      <div className="mb-6 flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold">Commercial Territories</h1>
          <p className="text-sm text-muted-foreground">
            Countries where Wingcaster sells and their pricing multipliers.
          </p>
        </div>
        <Button onClick={() => { setEditing(null); setFormOpen(true) }}>+ New Territory</Button>
      </div>

      <div className="mb-4 flex flex-wrap items-center gap-2">
        {WAVE_OPTIONS.map((opt) => (
          <button
            key={String(opt.value)}
            onClick={() => toggleWave(opt.value)}
            className={
              'rounded-full border px-3 py-1 text-xs ' +
              (waveFilter.has(opt.value) ? 'bg-primary text-primary-foreground' : 'bg-background text-foreground')
            }
          >
            {opt.label}
          </button>
        ))}
        <span className="mx-2 h-4 w-px bg-border" />
        {STATUS_OPTIONS.map((status) => (
          <button
            key={status}
            onClick={() => toggleStatus(status)}
            className={
              'rounded-full border px-2 py-0.5 text-xs ' +
              (statusFilter.has(status) ? 'ring-2 ring-primary' : '')
            }
          >
            <LaunchStatusBadge status={status} />
          </button>
        ))}
        <span className="mx-2 h-4 w-px bg-border" />
        <Input
          className="max-w-xs"
          placeholder="Search code or name…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        <label className="ml-2 flex cursor-pointer items-center gap-1 text-sm">
          <input type="checkbox" checked={includeInactive} onChange={(e) => setIncludeInactive(e.target.checked)} />
          Include inactive
        </label>
      </div>

      {error ? <p className="mb-3 text-sm text-red-600">{error}</p> : null}

      <div className="overflow-x-auto rounded-md border">
        <table className="w-full text-sm">
          <thead className="bg-muted/40 text-left">
            <tr>
              <th className="px-3 py-2 font-medium">Code</th>
              <th className="px-3 py-2 font-medium">Name</th>
              <th className="px-3 py-2 font-medium">Wave</th>
              <th className="px-3 py-2 font-medium">Status</th>
              <th className="px-3 py-2 font-medium">Multiplier</th>
              <th className="px-3 py-2 font-medium">Zones</th>
              <th className="px-3 py-2 font-medium">Cities</th>
              <th className="px-3 py-2 font-medium">Payment</th>
              <th className="px-3 py-2 font-medium">VAT</th>
              <th className="px-3 py-2 text-right font-medium">Actions</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan={10} className="px-3 py-4 text-center text-muted-foreground">Loading…</td></tr>
            ) : filtered.length === 0 ? (
              <tr><td colSpan={10} className="px-3 py-4 text-center text-muted-foreground">No territories match the filters.</td></tr>
            ) : filtered.map((t) => (
              <tr
                key={t.id}
                className="cursor-pointer border-t hover:bg-muted/30"
                onClick={() => window.location.assign(`/admin/commercial-pricing/territories/${t.id}`)}
              >
                <td className="px-3 py-2 font-mono font-bold uppercase">{t.code}</td>
                <td className="px-3 py-2">
                  <Link to={`/admin/commercial-pricing/territories/${t.id}`} onClick={(e) => e.stopPropagation()} className="hover:underline">
                    {t.name || <span className="text-muted-foreground">Unnamed</span>}
                  </Link>
                </td>
                <td className="px-3 py-2">{t.launch_wave ?? <span className="text-muted-foreground">—</span>}</td>
                <td className="px-3 py-2"><LaunchStatusBadge status={t.launch_status} /></td>
                <td className="px-3 py-2 tabular-nums">
                  {t.pricing_multiplier.toFixed(2)}
                  <span className="ml-1 text-xs text-muted-foreground">({Math.round(t.pricing_multiplier * 100)}%)</span>
                </td>
                <td className="px-3 py-2 tabular-nums">{zonesByTerritory[t.id] ?? 0}</td>
                <td className="px-3 py-2 tabular-nums">{citiesByTerritory[t.id] ?? 0}</td>
                <td className="px-3 py-2 text-xs">
                  {t.payment_gateway_primary || <span className="text-muted-foreground">—</span>}
                </td>
                <td className="px-3 py-2 tabular-nums">{t.vat_percent}%</td>
                <td className="px-3 py-2 text-right" onClick={(e) => e.stopPropagation()}>
                  <Button size="sm" variant="outline" onClick={() => { setEditing(t); setFormOpen(true) }}>Edit</Button>
                  {t.active ? (
                    <Button size="sm" variant="outline" className="ml-2" onClick={() => setDeactivating(t)}>Deactivate</Button>
                  ) : (
                    <Badge variant="secondary" className="ml-2">Inactive</Badge>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <TerritoryFormDialog
        open={formOpen}
        mode={editing ? 'edit' : 'create'}
        initial={editing}
        onClose={() => { setFormOpen(false); setEditing(null) }}
        onSaved={() => { void load() }}
      />

      <ConfirmDeactivateDialog
        open={Boolean(deactivating)}
        title={`Deactivate ${deactivating?.name || deactivating?.code}?`}
        description="The territory stays in the database but stops accepting new subscriptions. Existing subscriptions are unaffected."
        onConfirm={handleDeactivate}
        onCancel={() => setDeactivating(null)}
      />
    </div>
  )
}

function countBy<T>(items: T[], key: (item: T) => string | null | undefined): Record<string, number> {
  const acc: Record<string, number> = {}
  for (const item of items) {
    const k = key(item)
    if (!k) continue
    acc[k] = (acc[k] || 0) + 1
  }
  return acc
}
