import { useEffect, useState } from 'react'
import { api } from '@/api/client'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { MultiplierInput } from '@/components/commercial-pricing/MultiplierInput'
import type { Zone } from '@/types/commercialPricing'

interface ZoneFormDialogProps {
  open: boolean
  mode: 'create' | 'edit'
  territoryId: string
  initial?: Zone | null
  onClose: () => void
  onSaved: () => void
}

export function validateZoneForm(state: {
  code: string
  name: string
  pricing_multiplier: number
}): string | null {
  if (!/^[a-z0-9][a-z0-9-]{0,80}$/.test(state.code)) return 'Code must be kebab-case (lowercase letters, digits, hyphens)'
  if (!state.name.trim()) return 'Name is required'
  if (!(state.pricing_multiplier > 0)) return 'Multiplier must be greater than 0'
  return null
}

export function ZoneFormDialog({ open, mode, territoryId, initial, onClose, onSaved }: ZoneFormDialogProps) {
  const [code, setCode] = useState(initial?.code || '')
  const [name, setName] = useState(initial?.name || '')
  const [nameAr, setNameAr] = useState(initial?.name_ar || '')
  const [multiplier, setMultiplier] = useState(initial?.pricing_multiplier ?? 1)
  const [isDefault, setIsDefault] = useState(Boolean(initial?.is_default))
  const [sortOrder, setSortOrder] = useState(initial?.sort_order ?? 0)
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    if (open) {
      setCode(initial?.code || '')
      setName(initial?.name || '')
      setNameAr(initial?.name_ar || '')
      setMultiplier(initial?.pricing_multiplier ?? 1)
      setIsDefault(Boolean(initial?.is_default))
      setSortOrder(initial?.sort_order ?? 0)
      setError(null)
    }
  }, [open, initial])

  async function handleSave() {
    const validation = validateZoneForm({ code, name, pricing_multiplier: multiplier })
    if (validation) { setError(validation); return }
    setSaving(true)
    setError(null)
    try {
      const payload: Partial<Zone> = {
        territory_id: territoryId,
        code,
        name,
        name_ar: nameAr || null,
        pricing_multiplier: multiplier,
        is_default: isDefault,
        sort_order: sortOrder,
      }
      if (mode === 'create') await api.createAdminZone(payload)
      else if (initial) await api.updateAdminZone(initial.id, payload)
      onSaved()
      onClose()
    } catch (err: any) {
      setError(err?.message || 'Failed to save zone')
    } finally {
      setSaving(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={(next) => { if (!next && !saving) onClose() }}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{mode === 'create' ? 'New Zone' : `Edit ${initial?.name || 'Zone'}`}</DialogTitle>
          <DialogDescription>Sub-country slice with its own pricing multiplier.</DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          <div>
            <Label htmlFor="zone-code">Code (kebab-case)</Label>
            <Input
              id="zone-code"
              value={code}
              disabled={mode === 'edit'}
              onChange={(e) => setCode(e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, ''))}
            />
          </div>
          <div>
            <Label htmlFor="zone-name">Name</Label>
            <Input id="zone-name" value={name} onChange={(e) => setName(e.target.value)} />
          </div>
          <div>
            <Label htmlFor="zone-name-ar">Name (Arabic, optional)</Label>
            <Input id="zone-name-ar" dir="rtl" value={nameAr} onChange={(e) => setNameAr(e.target.value)} />
          </div>
          <MultiplierInput label="Pricing multiplier" value={multiplier} onChange={setMultiplier} />
          <div className="flex items-center gap-2">
            <input
              id="zone-default"
              type="checkbox"
              checked={isDefault}
              onChange={(e) => setIsDefault(e.target.checked)}
            />
            <Label htmlFor="zone-default" className="cursor-pointer">Default zone for this territory</Label>
          </div>
          <div>
            <Label htmlFor="zone-sort">Sort order</Label>
            <Input id="zone-sort" type="number" value={sortOrder} onChange={(e) => setSortOrder(Number(e.target.value))} />
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
