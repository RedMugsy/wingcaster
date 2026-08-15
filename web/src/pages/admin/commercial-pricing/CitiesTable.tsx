import { useEffect, useMemo, useState } from 'react'
import { api } from '@/api/client'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import { ConfirmDeactivateDialog } from '@/components/commercial-pricing/ConfirmDeactivateDialog'
import { CityFormDialog } from './CityFormDialog'
import type { City, Zone } from '@/types/commercialPricing'

interface CitiesTableProps {
  territoryId: string
  zones: Zone[]
}

export function CitiesTable({ territoryId, zones }: CitiesTableProps) {
  const [cities, setCities] = useState<City[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [includeInactive, setIncludeInactive] = useState(true)
  const [zoneFilter, setZoneFilter] = useState<string>('')
  const [search, setSearch] = useState('')
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [bulkZoneId, setBulkZoneId] = useState<string>('')
  const [bulkPending, setBulkPending] = useState(false)
  const [formOpen, setFormOpen] = useState(false)
  const [editing, setEditing] = useState<City | null>(null)
  const [deactivating, setDeactivating] = useState<City | null>(null)

  useEffect(() => { void load() }, [territoryId, includeInactive])

  async function load() {
    setLoading(true)
    setError(null)
    try {
      const { cities } = await api.listAdminCities({ territory_id: territoryId, include_inactive: includeInactive })
      setCities(cities)
      setSelected(new Set())
    } catch (err: any) {
      setError(err?.message || 'Failed to load cities')
    } finally {
      setLoading(false)
    }
  }

  const filtered = useMemo(() => {
    const needle = search.trim().toLowerCase()
    return cities.filter((c) => {
      if (zoneFilter && c.zone_id !== zoneFilter) return false
      if (needle && !c.name.toLowerCase().includes(needle) && !(c.name_ar || '').includes(needle)) return false
      return true
    })
  }, [cities, zoneFilter, search])

  const zonesById = useMemo(() => Object.fromEntries(zones.map((z) => [z.id, z])), [zones])

  function toggleSelect(id: string) {
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  function toggleSelectAll() {
    if (selected.size === filtered.length) setSelected(new Set())
    else setSelected(new Set(filtered.map((c) => c.id)))
  }

  async function handleBulkAssign() {
    if (selected.size === 0 || !bulkZoneId) return
    setBulkPending(true)
    try {
      await api.bulkAssignAdminCitiesToZone(Array.from(selected), bulkZoneId === '__unassign' ? null : bulkZoneId)
      await load()
    } catch (err: any) {
      setError(err?.message || 'Bulk assignment failed')
    } finally {
      setBulkPending(false)
    }
  }

  async function handleDeactivate() {
    if (!deactivating) return
    try {
      await api.deactivateAdminCity(deactivating.id)
      setDeactivating(null)
      await load()
    } catch (err: any) {
      setError(err?.message || 'Deactivation failed')
    }
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <Input
          className="max-w-xs"
          placeholder="Search cities…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        <select
          className="h-9 rounded-md border bg-background px-2 text-sm"
          value={zoneFilter}
          onChange={(e) => setZoneFilter(e.target.value)}
        >
          <option value="">All zones</option>
          {zones.map((z) => <option key={z.id} value={z.id}>{z.name}</option>)}
        </select>
        <label className="flex cursor-pointer items-center gap-1 text-sm">
          <input type="checkbox" checked={includeInactive} onChange={(e) => setIncludeInactive(e.target.checked)} />
          Include inactive
        </label>
        <div className="ml-auto">
          <Button size="sm" onClick={() => { setEditing(null); setFormOpen(true) }}>+ New City</Button>
        </div>
      </div>

      {selected.size > 0 ? (
        <div className="flex items-center gap-2 rounded-md border bg-muted/50 p-2 text-sm">
          <span>{selected.size} selected</span>
          <select
            className="h-8 rounded-md border bg-background px-2 text-xs"
            value={bulkZoneId}
            onChange={(e) => setBulkZoneId(e.target.value)}
          >
            <option value="">Bulk assign to zone…</option>
            <option value="__unassign">— Unassign zone —</option>
            {zones.map((z) => <option key={z.id} value={z.id}>{z.name}</option>)}
          </select>
          <Button size="sm" disabled={!bulkZoneId || bulkPending} onClick={handleBulkAssign}>
            {bulkPending ? 'Applying…' : 'Apply'}
          </Button>
          <Button size="sm" variant="outline" onClick={() => setSelected(new Set())}>Clear</Button>
        </div>
      ) : null}

      {error ? <p className="text-sm text-red-600">{error}</p> : null}

      <div className="overflow-x-auto rounded-md border">
        <table className="w-full text-sm">
          <thead className="bg-muted/40 text-left">
            <tr>
              <th className="w-8 px-3 py-2">
                <input
                  type="checkbox"
                  checked={filtered.length > 0 && selected.size === filtered.length}
                  onChange={toggleSelectAll}
                />
              </th>
              <th className="px-3 py-2 font-medium">Name</th>
              <th className="px-3 py-2 font-medium">Zone</th>
              <th className="px-3 py-2 font-medium">Coordinates</th>
              <th className="px-3 py-2 font-medium">Active</th>
              <th className="px-3 py-2 text-right font-medium">Actions</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan={6} className="px-3 py-4 text-center text-muted-foreground">Loading…</td></tr>
            ) : filtered.length === 0 ? (
              <tr><td colSpan={6} className="px-3 py-4 text-center text-muted-foreground">No cities.</td></tr>
            ) : filtered.map((city) => (
              <tr key={city.id} className="border-t">
                <td className="px-3 py-2">
                  <input type="checkbox" checked={selected.has(city.id)} onChange={() => toggleSelect(city.id)} />
                </td>
                <td className="px-3 py-2">
                  <div>{city.name}</div>
                  {city.name_ar ? <div className="text-xs text-muted-foreground" dir="rtl">{city.name_ar}</div> : null}
                </td>
                <td className="px-3 py-2">
                  {city.zone_id ? (zonesById[city.zone_id]?.name || '—') : <span className="text-muted-foreground">Unassigned</span>}
                </td>
                <td className="px-3 py-2 text-xs text-muted-foreground">
                  {city.latitude != null && city.longitude != null ? `${city.latitude.toFixed(4)}, ${city.longitude.toFixed(4)}` : '—'}
                </td>
                <td className="px-3 py-2">
                  {city.active ? <Badge variant="outline">Active</Badge> : <Badge variant="secondary">Inactive</Badge>}
                </td>
                <td className="px-3 py-2 text-right">
                  <Button size="sm" variant="outline" onClick={() => { setEditing(city); setFormOpen(true) }}>Edit</Button>
                  {city.active ? (
                    <Button size="sm" variant="outline" className="ml-2" onClick={() => setDeactivating(city)}>Deactivate</Button>
                  ) : null}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <CityFormDialog
        open={formOpen}
        mode={editing ? 'edit' : 'create'}
        territoryId={territoryId}
        zones={zones}
        initial={editing}
        onClose={() => { setFormOpen(false); setEditing(null) }}
        onSaved={() => { void load() }}
      />

      <ConfirmDeactivateDialog
        open={Boolean(deactivating)}
        title={`Deactivate ${deactivating?.name}?`}
        description="City stays in the database but stops appearing in signup city→zone resolution."
        onConfirm={handleDeactivate}
        onCancel={() => setDeactivating(null)}
      />
    </div>
  )
}
