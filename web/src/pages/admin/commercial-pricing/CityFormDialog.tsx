import { useEffect, useState } from 'react'
import { api } from '@/api/client'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import type { City, Zone } from '@/types/commercialPricing'

interface CityFormDialogProps {
  open: boolean
  mode: 'create' | 'edit'
  territoryId: string
  zones: Zone[]
  initial?: City | null
  onClose: () => void
  onSaved: () => void
}

export function validateCityForm(state: { name: string; zone_id: string | null }): string | null {
  if (!state.name.trim()) return 'Name is required'
  if (!state.zone_id) return 'Zone is required'
  return null
}

export function CityFormDialog({ open, mode, territoryId, zones, initial, onClose, onSaved }: CityFormDialogProps) {
  const [name, setName] = useState(initial?.name || '')
  const [nameAr, setNameAr] = useState(initial?.name_ar || '')
  const [zoneId, setZoneId] = useState<string | null>(initial?.zone_id || null)
  const [latitude, setLatitude] = useState<string>(initial?.latitude != null ? String(initial.latitude) : '')
  const [longitude, setLongitude] = useState<string>(initial?.longitude != null ? String(initial.longitude) : '')
  const [sortOrder, setSortOrder] = useState<number>(initial?.sort_order ?? 0)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (open) {
      setName(initial?.name || '')
      setNameAr(initial?.name_ar || '')
      setZoneId(initial?.zone_id || null)
      setLatitude(initial?.latitude != null ? String(initial.latitude) : '')
      setLongitude(initial?.longitude != null ? String(initial.longitude) : '')
      setSortOrder(initial?.sort_order ?? 0)
      setError(null)
    }
  }, [open, initial])

  const activeZones = zones.filter((z) => z.active !== false)

  async function handleSave() {
    const validation = validateCityForm({ name, zone_id: zoneId })
    if (validation) { setError(validation); return }
    setSaving(true)
    setError(null)
    try {
      const payload: Partial<City> = {
        territory_id: territoryId,
        zone_id: zoneId,
        name,
        name_ar: nameAr || null,
        latitude: latitude === '' ? null : Number(latitude),
        longitude: longitude === '' ? null : Number(longitude),
        sort_order: sortOrder,
      }
      if (mode === 'create') await api.createAdminCity(payload)
      else if (initial) await api.updateAdminCity(initial.id, payload)
      onSaved()
      onClose()
    } catch (err: any) {
      setError(err?.message || 'Failed to save city')
    } finally {
      setSaving(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={(next) => { if (!next && !saving) onClose() }}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{mode === 'create' ? 'New City' : `Edit ${initial?.name || 'City'}`}</DialogTitle>
          <DialogDescription>City-to-zone mapping. Used for signup city→zone resolution.</DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          <div>
            <Label htmlFor="city-name">Name</Label>
            <Input id="city-name" value={name} onChange={(e) => setName(e.target.value)} />
          </div>
          <div>
            <Label htmlFor="city-name-ar">Name (Arabic, optional)</Label>
            <Input id="city-name-ar" dir="rtl" value={nameAr} onChange={(e) => setNameAr(e.target.value)} />
          </div>
          <div>
            <Label htmlFor="city-zone">Zone</Label>
            <select
              id="city-zone"
              className="h-10 w-full rounded-md border bg-background px-3 text-sm"
              value={zoneId || ''}
              onChange={(e) => setZoneId(e.target.value || null)}
            >
              <option value="">Select a zone…</option>
              {activeZones.map((z) => (
                <option key={z.id} value={z.id}>{z.name}{z.is_default ? ' (default)' : ''}</option>
              ))}
            </select>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div>
              <Label htmlFor="city-lat">Latitude (optional)</Label>
              <Input id="city-lat" type="number" value={latitude} onChange={(e) => setLatitude(e.target.value)} />
            </div>
            <div>
              <Label htmlFor="city-lng">Longitude (optional)</Label>
              <Input id="city-lng" type="number" value={longitude} onChange={(e) => setLongitude(e.target.value)} />
            </div>
          </div>
          <div>
            <Label htmlFor="city-sort">Sort order</Label>
            <Input id="city-sort" type="number" value={sortOrder} onChange={(e) => setSortOrder(Number(e.target.value))} />
          </div>
        </div>

        {error ? <p className="text-sm text-red-600">{error}</p> : null}

        <div className="flex justify-end gap-2 pt-2">
          <Button variant="outline" onClick={onClose} disabled={saving}>Cancel</Button>
          <Button onClick={handleSave} disabled={saving}>{saving ? 'Saving…' : 'Save'}</Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}
