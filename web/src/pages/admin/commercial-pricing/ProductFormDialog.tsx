import { useEffect, useState } from 'react'
import { api } from '@/api/client'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import type { BillingCadence, Product, ProductType } from '@/types/commercialPricing'

interface ProductFormDialogProps {
  open: boolean
  mode: 'create' | 'edit'
  initial?: Product | null
  onClose: () => void
  onSaved: (product: Product) => void
}

interface FormState {
  code: string
  name: string
  description: string
  product_type: ProductType
  billing_cadence: BillingCadence
  base_price_minor: number
  currency: string
  is_public: boolean
}

function initialState(initial?: Product | null): FormState {
  return {
    code: initial?.code || '',
    name: initial?.name || '',
    description: initial?.description || '',
    product_type: initial?.product_type || 'plan',
    billing_cadence: initial?.billing_cadence || 'monthly',
    base_price_minor: initial?.base_price_minor ?? 0,
    currency: initial?.currency || 'USD',
    is_public: initial?.is_public !== false,
  }
}

export function validateProductForm(state: FormState, mode: 'create' | 'edit'): string | null {
  if (mode === 'create' && !/^[a-z0-9][a-z0-9._-]{0,79}$/.test(state.code)) {
    return 'Code must be kebab/snake case (1-80 chars, starts with alphanumeric)'
  }
  if (!state.name.trim()) return 'Name is required'
  if (!/^[A-Z]{3}$/.test(state.currency)) return 'Currency must be a 3-letter uppercase code'
  if (!Number.isFinite(state.base_price_minor) || state.base_price_minor < 0) return 'Base price must be non-negative'
  if (!['plan', 'addon', 'bundle'].includes(state.product_type)) return 'Invalid product type'
  return null
}

export function ProductFormDialog({ open, mode, initial, onClose, onSaved }: ProductFormDialogProps) {
  const [state, setState] = useState<FormState>(() => initialState(initial))
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (open) {
      setState(initialState(initial))
      setError(null)
    }
  }, [open, initial])

  const editingLocked = mode === 'edit' && initial && initial.status !== 'draft'

  async function handleSave() {
    const validation = validateProductForm(state, mode)
    if (validation) { setError(validation); return }
    setSaving(true)
    setError(null)
    try {
      const payload: Partial<Product> = {
        code: state.code,
        name: state.name,
        description: state.description || null,
        product_type: state.product_type,
        billing_cadence: state.billing_cadence,
        base_price_minor: Math.round(state.base_price_minor),
        currency: state.currency,
        is_public: state.is_public,
      }
      if (mode === 'create') {
        const { product } = await api.createAdminProduct(payload)
        onSaved(product)
      } else if (initial) {
        // Locked fields are stripped when the product isn't draft.
        const filtered = editingLocked
          ? { name: payload.name, description: payload.description, is_public: payload.is_public }
          : payload
        const { product } = await api.updateAdminProduct(initial.id, filtered)
        onSaved(product)
      }
      onClose()
    } catch (err: any) {
      setError(err?.message || 'Failed to save product')
    } finally {
      setSaving(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={(next) => { if (!next && !saving) onClose() }}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>{mode === 'create' ? 'New Product' : `Edit ${initial?.name || 'Product'}`}</DialogTitle>
          <DialogDescription>
            {editingLocked
              ? 'Product is published — pricing / cadence / code / type are locked. Clone as a new version to change them.'
              : 'Version-pinned. Once published, subscribers stay on this version until they migrate.'}
          </DialogDescription>
        </DialogHeader>

        <div className="grid grid-cols-2 gap-3">
          <div>
            <Label htmlFor="prod-code">Code</Label>
            <Input
              id="prod-code"
              value={state.code}
              disabled={mode === 'edit'}
              onChange={(e) => setState((s) => ({ ...s, code: e.target.value.toLowerCase().replace(/[^a-z0-9._-]/g, '') }))}
            />
            {mode === 'create' ? <p className="mt-1 text-xs text-muted-foreground">Immutable once created. Version increments automatically.</p> : null}
          </div>
          <div>
            <Label htmlFor="prod-name">Name</Label>
            <Input id="prod-name" value={state.name} onChange={(e) => setState((s) => ({ ...s, name: e.target.value }))} />
          </div>
          <div className="col-span-2">
            <Label htmlFor="prod-desc">Description (optional)</Label>
            <Input id="prod-desc" value={state.description} onChange={(e) => setState((s) => ({ ...s, description: e.target.value }))} />
          </div>
          <div>
            <Label htmlFor="prod-type">Type</Label>
            <select
              id="prod-type"
              disabled={editingLocked === true}
              className="h-10 w-full rounded-md border bg-background px-3 text-sm"
              value={state.product_type}
              onChange={(e) => setState((s) => ({ ...s, product_type: e.target.value as ProductType }))}
            >
              <option value="plan">Plan</option>
              <option value="addon">Add-on</option>
              <option value="bundle">Bundle</option>
            </select>
          </div>
          <div>
            <Label htmlFor="prod-cadence">Billing cadence</Label>
            <select
              id="prod-cadence"
              disabled={editingLocked === true}
              className="h-10 w-full rounded-md border bg-background px-3 text-sm"
              value={state.billing_cadence}
              onChange={(e) => setState((s) => ({ ...s, billing_cadence: e.target.value as BillingCadence }))}
            >
              <option value="monthly">Monthly</option>
              <option value="annual">Annual</option>
              <option value="90_days">90 days</option>
              <option value="one_off">One-off</option>
              <option value="custom">Custom</option>
            </select>
          </div>
          <div>
            <Label htmlFor="prod-price">Base price (minor units)</Label>
            <Input
              id="prod-price"
              type="number"
              min={0}
              step={1}
              disabled={editingLocked === true}
              value={state.base_price_minor}
              onChange={(e) => setState((s) => ({ ...s, base_price_minor: Number(e.target.value) }))}
            />
            <p className="mt-1 text-xs text-muted-foreground">e.g. 9900 = $99.00</p>
          </div>
          <div>
            <Label htmlFor="prod-currency">Currency</Label>
            <Input
              id="prod-currency"
              maxLength={3}
              disabled={editingLocked === true}
              value={state.currency}
              onChange={(e) => setState((s) => ({ ...s, currency: e.target.value.toUpperCase() }))}
            />
          </div>
          <div className="col-span-2 flex items-center gap-2">
            <input
              id="prod-public"
              type="checkbox"
              checked={state.is_public}
              onChange={(e) => setState((s) => ({ ...s, is_public: e.target.checked }))}
            />
            <Label htmlFor="prod-public" className="cursor-pointer">Visible in the tenant self-serve catalog</Label>
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
