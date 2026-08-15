import { useEffect, useState } from 'react'
import { api } from '@/api/client'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import type { PricingOverride, Product, ProductTier, Territory } from '@/types/commercialPricing'

interface PricingOverrideFormDialogProps {
  open: boolean
  mode: 'create' | 'edit'
  product: Product
  tiers: ProductTier[]
  territories: Territory[]
  initial?: PricingOverride | null
  onClose: () => void
  onSaved: (override: PricingOverride) => void
}

export function validateOverrideForm(state: {
  territory_id: string | null
  price_minor: number
  currency: string
}): string | null {
  if (!state.territory_id) return 'Territory is required'
  if (!Number.isFinite(state.price_minor) || state.price_minor < 0) return 'Price must be non-negative'
  if (!/^[A-Z]{3}$/.test(state.currency)) return 'Currency must be a 3-letter uppercase code'
  return null
}

export function PricingOverrideFormDialog({
  open, mode, product, tiers, territories, initial, onClose, onSaved,
}: PricingOverrideFormDialogProps) {
  const [tierId, setTierId] = useState<string | null>(initial?.tier_id ?? null)
  const [territoryId, setTerritoryId] = useState<string | null>(initial?.territory_id ?? null)
  const [priceMinor, setPriceMinor] = useState<number>(initial?.price_minor ?? 0)
  const [currency, setCurrency] = useState<string>(initial?.currency || product.currency || 'USD')
  const [active, setActive] = useState<boolean>(initial?.active !== false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (open) {
      setTierId(initial?.tier_id ?? null)
      setTerritoryId(initial?.territory_id ?? null)
      setPriceMinor(initial?.price_minor ?? 0)
      setCurrency(initial?.currency || product.currency || 'USD')
      setActive(initial?.active !== false)
      setError(null)
    }
  }, [open, initial, product])

  async function handleSave() {
    const validation = validateOverrideForm({ territory_id: territoryId, price_minor: priceMinor, currency })
    if (validation) { setError(validation); return }
    setSaving(true)
    setError(null)
    try {
      const payload: Partial<PricingOverride> = {
        tier_id: tierId,
        territory_id: territoryId!,
        price_minor: Math.round(priceMinor),
        currency,
        active,
      }
      if (mode === 'create') {
        const { override } = await api.createAdminProductOverride(product.id, payload)
        onSaved(override)
      } else if (initial) {
        const { override } = await api.updateAdminProductOverride(initial.id, {
          price_minor: payload.price_minor,
          currency: payload.currency,
          active: payload.active,
        })
        onSaved(override)
      }
      onClose()
    } catch (err: any) {
      setError(err?.message || 'Failed to save pricing override')
    } finally {
      setSaving(false)
    }
  }

  const activeTiers = tiers.filter((t) => t.status === 'active' || t.id === initial?.tier_id)

  return (
    <Dialog open={open} onOpenChange={(next) => { if (!next && !saving) onClose() }}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{mode === 'create' ? 'New Pricing Override' : 'Edit Pricing Override'}</DialogTitle>
          <DialogDescription>
            Per-territory price for {product.name} v{product.version}. Tier-specific overrides win over product-wide overrides.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          <div>
            <Label htmlFor="ovr-tier">Tier</Label>
            <select
              id="ovr-tier"
              className="h-10 w-full rounded-md border bg-background px-3 text-sm"
              disabled={mode === 'edit'}
              value={tierId || ''}
              onChange={(e) => setTierId(e.target.value || null)}
            >
              <option value="">Product-wide (all tiers)</option>
              {activeTiers.map((t) => (
                <option key={t.id} value={t.id}>{t.name}</option>
              ))}
            </select>
          </div>
          <div>
            <Label htmlFor="ovr-territory">Territory</Label>
            <select
              id="ovr-territory"
              className="h-10 w-full rounded-md border bg-background px-3 text-sm"
              disabled={mode === 'edit'}
              value={territoryId || ''}
              onChange={(e) => setTerritoryId(e.target.value || null)}
            >
              <option value="">Select a territory…</option>
              {territories.map((t) => (
                <option key={t.id} value={t.id}>{t.code} — {t.name || t.code}</option>
              ))}
            </select>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div>
              <Label htmlFor="ovr-price">Price (minor units)</Label>
              <Input
                id="ovr-price"
                type="number"
                min={0}
                value={priceMinor}
                onChange={(e) => setPriceMinor(Number(e.target.value))}
              />
            </div>
            <div>
              <Label htmlFor="ovr-currency">Currency</Label>
              <Input
                id="ovr-currency"
                maxLength={3}
                value={currency}
                onChange={(e) => setCurrency(e.target.value.toUpperCase())}
              />
            </div>
          </div>
          <div className="flex items-center gap-2">
            <input
              id="ovr-active"
              type="checkbox"
              checked={active}
              onChange={(e) => setActive(e.target.checked)}
            />
            <Label htmlFor="ovr-active" className="cursor-pointer">Active (uncheck to soft-delete)</Label>
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
