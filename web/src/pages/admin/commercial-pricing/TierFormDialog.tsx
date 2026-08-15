import { useEffect, useState } from 'react'
import { api } from '@/api/client'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { QuotasEditor } from '@/components/commercial-pricing/QuotasEditor'
import type { Product, ProductTier } from '@/types/commercialPricing'

interface TierFormDialogProps {
  open: boolean
  mode: 'create' | 'edit'
  product: Product
  initial?: ProductTier | null
  onClose: () => void
  onSaved: (tier: ProductTier) => void
}

interface FormState {
  code: string
  name: string
  description: string
  sort_order: number
  price_minor: number | null
  currency: string
  quotas: Record<string, number>
  features: string
  is_public: boolean
}

function initialState(initial?: ProductTier | null, product?: Product): FormState {
  return {
    code: initial?.code || '',
    name: initial?.name || '',
    description: initial?.description || '',
    sort_order: initial?.sort_order ?? 0,
    price_minor: initial?.price_minor ?? null,
    currency: initial?.currency || product?.currency || 'USD',
    quotas: initial?.quotas || {},
    features: Array.isArray(initial?.features) ? initial.features.join(', ') : '',
    is_public: initial?.is_public !== false,
  }
}

export function validateTierForm(state: FormState, mode: 'create' | 'edit'): string | null {
  if (mode === 'create' && !/^[a-z0-9][a-z0-9._-]{0,79}$/.test(state.code)) {
    return 'Tier code must be kebab/snake case (1-80 chars, starts with alphanumeric)'
  }
  if (!state.name.trim()) return 'Name is required'
  if (state.price_minor != null && (!Number.isFinite(state.price_minor) || state.price_minor < 0)) {
    return 'Price must be non-negative when set'
  }
  if (state.currency && !/^[A-Z]{3}$/.test(state.currency)) {
    return 'Currency must be a 3-letter uppercase code'
  }
  return null
}

export function TierFormDialog({ open, mode, product, initial, onClose, onSaved }: TierFormDialogProps) {
  const [state, setState] = useState<FormState>(() => initialState(initial, product))
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (open) {
      setState(initialState(initial, product))
      setError(null)
    }
  }, [open, initial, product])

  const editingLocked = mode === 'edit' && initial && initial.status !== 'draft'

  async function handleSave() {
    const validation = validateTierForm(state, mode)
    if (validation) { setError(validation); return }
    setSaving(true)
    setError(null)
    try {
      const featuresArr = state.features
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean)
      const payload: Partial<ProductTier> = {
        code: state.code,
        name: state.name,
        description: state.description || null,
        sort_order: Math.round(state.sort_order || 0),
        price_minor: state.price_minor,
        currency: state.currency || null,
        quotas: state.quotas,
        features: featuresArr,
        is_public: state.is_public,
      }
      if (mode === 'create') {
        const { tier } = await api.createAdminTier(product.id, payload)
        onSaved(tier)
      } else if (initial) {
        const filtered = editingLocked
          ? { name: payload.name, description: payload.description, sort_order: payload.sort_order, is_public: payload.is_public }
          : payload
        const { tier } = await api.updateAdminTier(initial.id, filtered)
        onSaved(tier)
      }
      onClose()
    } catch (err: any) {
      setError(err?.message || 'Failed to save tier')
    } finally {
      setSaving(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={(next) => { if (!next && !saving) onClose() }}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>{mode === 'create' ? 'New Tier' : `Edit ${initial?.name || 'Tier'}`}</DialogTitle>
          <DialogDescription>
            {editingLocked
              ? 'Tier is active — code / price / currency / quotas / features are locked. Clone the parent product as a new version to change them.'
              : `Variant of ${product.name} v${product.version}. Sits alongside other tiers as a Basic / Pro / Enterprise-style choice.`}
          </DialogDescription>
        </DialogHeader>

        <div className="grid grid-cols-2 gap-3">
          <div>
            <Label htmlFor="tier-code">Code</Label>
            <Input
              id="tier-code"
              value={state.code}
              disabled={mode === 'edit'}
              onChange={(e) => setState((s) => ({ ...s, code: e.target.value.toLowerCase().replace(/[^a-z0-9._-]/g, '') }))}
            />
          </div>
          <div>
            <Label htmlFor="tier-name">Name</Label>
            <Input id="tier-name" value={state.name} onChange={(e) => setState((s) => ({ ...s, name: e.target.value }))} />
          </div>
          <div className="col-span-2">
            <Label htmlFor="tier-desc">Description (optional)</Label>
            <Input id="tier-desc" value={state.description} onChange={(e) => setState((s) => ({ ...s, description: e.target.value }))} />
          </div>
          <div>
            <Label htmlFor="tier-price">Price override (minor)</Label>
            <Input
              id="tier-price"
              type="number"
              min={0}
              step={1}
              disabled={editingLocked === true}
              value={state.price_minor ?? ''}
              onChange={(e) => setState((s) => ({ ...s, price_minor: e.target.value === '' ? null : Number(e.target.value) }))}
            />
            <p className="mt-1 text-xs text-muted-foreground">Leave blank to inherit the product base price.</p>
          </div>
          <div>
            <Label htmlFor="tier-currency">Currency</Label>
            <Input
              id="tier-currency"
              maxLength={3}
              disabled={editingLocked === true}
              value={state.currency}
              onChange={(e) => setState((s) => ({ ...s, currency: e.target.value.toUpperCase() }))}
            />
          </div>
          <div>
            <Label htmlFor="tier-sort">Sort order</Label>
            <Input id="tier-sort" type="number" value={state.sort_order} onChange={(e) => setState((s) => ({ ...s, sort_order: Number(e.target.value) }))} />
          </div>
          <div className="flex items-end gap-2">
            <div className="flex items-center gap-2">
              <input
                id="tier-public"
                type="checkbox"
                checked={state.is_public}
                onChange={(e) => setState((s) => ({ ...s, is_public: e.target.checked }))}
              />
              <Label htmlFor="tier-public" className="cursor-pointer">Public (tenants can self-serve)</Label>
            </div>
          </div>
          <div className="col-span-2">
            <Label htmlFor="tier-features">Features (comma-separated keys)</Label>
            <Input
              id="tier-features"
              disabled={editingLocked === true}
              placeholder="ai_staging, premium_templates, priority_support"
              value={state.features}
              onChange={(e) => setState((s) => ({ ...s, features: e.target.value }))}
            />
          </div>
          <div className="col-span-2">
            <QuotasEditor
              value={state.quotas}
              onChange={(q) => setState((s) => ({ ...s, quotas: q }))}
              disabled={editingLocked === true}
            />
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
