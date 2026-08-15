import { useEffect, useState } from 'react'
import { api } from '@/api/client'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { MultiplierInput } from '@/components/commercial-pricing/MultiplierInput'
import type { BillingMode, LaunchStatus, Territory } from '@/types/commercialPricing'

interface TerritoryFormDialogProps {
  open: boolean
  mode: 'create' | 'edit'
  initial?: Territory | null
  onClose: () => void
  onSaved: () => void
}

interface FormState {
  code: string
  name: string
  currency: string
  pricing_multiplier: number
  launch_status: LaunchStatus
  launch_wave: string
  data_residency_required: boolean
  billing_mode: BillingMode
  vat_percent: number
  regulator_id_type: string
  payment_gateway_primary: string
  payment_gateway_secondary: string
}

function initialState(initial?: Territory | null): FormState {
  return {
    code: initial?.code || '',
    name: initial?.name || '',
    currency: initial?.currency || 'USD',
    pricing_multiplier: initial?.pricing_multiplier ?? 1,
    launch_status: initial?.launch_status || 'planned',
    launch_wave: initial?.launch_wave != null ? String(initial.launch_wave) : '',
    data_residency_required: Boolean(initial?.data_residency_required),
    billing_mode: initial?.billing_mode || 'card',
    vat_percent: initial?.vat_percent ?? 0,
    regulator_id_type: initial?.regulator_id_type || '',
    payment_gateway_primary: initial?.payment_gateway_primary || '',
    payment_gateway_secondary: initial?.payment_gateway_secondary || '',
  }
}

export function validateTerritoryForm(state: FormState): string | null {
  if (!/^[A-Z]{2}$/.test(state.code)) return 'Code must be a 2-letter ISO country code (uppercase)'
  if (!state.name.trim()) return 'Name is required'
  if (!/^[A-Z]{3}$/.test(state.currency)) return 'Currency must be a 3-letter uppercase code'
  if (!(state.pricing_multiplier > 0)) return 'Multiplier must be greater than 0'
  if (state.vat_percent < 0 || state.vat_percent > 100) return 'VAT must be between 0 and 100'
  return null
}

export function TerritoryFormDialog({ open, mode, initial, onClose, onSaved }: TerritoryFormDialogProps) {
  const [state, setState] = useState<FormState>(() => initialState(initial))
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (open) {
      setState(initialState(initial))
      setError(null)
    }
  }, [open, initial])

  async function handleSave() {
    const validation = validateTerritoryForm(state)
    if (validation) {
      setError(validation)
      return
    }
    setSaving(true)
    setError(null)
    try {
      const payload: Partial<Territory> = {
        code: state.code,
        name: state.name,
        currency: state.currency,
        pricing_multiplier: state.pricing_multiplier,
        launch_status: state.launch_status,
        launch_wave: state.launch_wave === '' ? null : Number(state.launch_wave),
        data_residency_required: state.data_residency_required,
        billing_mode: state.billing_mode,
        vat_percent: state.vat_percent,
        regulator_id_type: state.regulator_id_type || null,
        payment_gateway_primary: state.payment_gateway_primary || null,
        payment_gateway_secondary: state.payment_gateway_secondary || null,
      }
      if (mode === 'create') {
        await api.createAdminTerritory(payload)
      } else if (initial) {
        await api.updateAdminTerritory(initial.id, payload)
      }
      onSaved()
      onClose()
    } catch (err: any) {
      setError(err?.message || 'Failed to save territory')
    } finally {
      setSaving(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={(next) => { if (!next && !saving) onClose() }}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>{mode === 'create' ? 'New Territory' : `Edit ${initial?.name || initial?.code || 'Territory'}`}</DialogTitle>
          <DialogDescription>Commercial market configuration — pricing multiplier, launch status, compliance, payments.</DialogDescription>
        </DialogHeader>

        <div className="grid grid-cols-2 gap-3">
          <div>
            <Label htmlFor="ter-code">Code (ISO-2)</Label>
            <Input
              id="ter-code"
              value={state.code}
              disabled={mode === 'edit'}
              maxLength={2}
              onChange={(e) => setState((s) => ({ ...s, code: e.target.value.toUpperCase() }))}
            />
          </div>
          <div>
            <Label htmlFor="ter-name">Name</Label>
            <Input id="ter-name" value={state.name} onChange={(e) => setState((s) => ({ ...s, name: e.target.value }))} />
          </div>
          <div>
            <Label htmlFor="ter-currency">Currency (ISO)</Label>
            <Input
              id="ter-currency"
              maxLength={3}
              value={state.currency}
              onChange={(e) => setState((s) => ({ ...s, currency: e.target.value.toUpperCase() }))}
            />
          </div>
          <div>
            <MultiplierInput
              label="Pricing multiplier"
              value={state.pricing_multiplier}
              onChange={(n) => setState((s) => ({ ...s, pricing_multiplier: n }))}
            />
          </div>
          <div>
            <Label htmlFor="ter-status">Launch status</Label>
            <select
              id="ter-status"
              className="h-10 w-full rounded-md border bg-background px-3 text-sm"
              value={state.launch_status}
              onChange={(e) => setState((s) => ({ ...s, launch_status: e.target.value as LaunchStatus }))}
            >
              <option value="planned">Planned</option>
              <option value="launched">Launched</option>
              <option value="blocked">Blocked</option>
              <option value="sunset">Sunset</option>
            </select>
          </div>
          <div>
            <Label htmlFor="ter-wave">Launch wave</Label>
            <Input
              id="ter-wave"
              type="number"
              value={state.launch_wave}
              onChange={(e) => setState((s) => ({ ...s, launch_wave: e.target.value }))}
            />
          </div>
          <div>
            <Label htmlFor="ter-billing">Billing mode</Label>
            <select
              id="ter-billing"
              className="h-10 w-full rounded-md border bg-background px-3 text-sm"
              value={state.billing_mode}
              onChange={(e) => setState((s) => ({ ...s, billing_mode: e.target.value as BillingMode }))}
            >
              <option value="card">Card</option>
              <option value="invoice_only">Invoice only</option>
              <option value="manual">Manual</option>
              <option value="disabled">Disabled</option>
            </select>
          </div>
          <div>
            <Label htmlFor="ter-vat">VAT %</Label>
            <Input
              id="ter-vat"
              type="number"
              min={0}
              max={100}
              value={state.vat_percent}
              onChange={(e) => setState((s) => ({ ...s, vat_percent: Number(e.target.value) }))}
            />
          </div>
          <div className="col-span-2 flex items-center gap-2">
            <input
              id="ter-residency"
              type="checkbox"
              checked={state.data_residency_required}
              onChange={(e) => setState((s) => ({ ...s, data_residency_required: e.target.checked }))}
            />
            <Label htmlFor="ter-residency" className="cursor-pointer">Data residency required in this territory</Label>
          </div>
          <div>
            <Label htmlFor="ter-regulator">Regulator ID type (optional)</Label>
            <Input id="ter-regulator" value={state.regulator_id_type} onChange={(e) => setState((s) => ({ ...s, regulator_id_type: e.target.value }))} />
          </div>
          <div />
          <div>
            <Label htmlFor="ter-pg1">Payment gateway (primary)</Label>
            <Input id="ter-pg1" value={state.payment_gateway_primary} onChange={(e) => setState((s) => ({ ...s, payment_gateway_primary: e.target.value }))} />
          </div>
          <div>
            <Label htmlFor="ter-pg2">Payment gateway (secondary)</Label>
            <Input id="ter-pg2" value={state.payment_gateway_secondary} onChange={(e) => setState((s) => ({ ...s, payment_gateway_secondary: e.target.value }))} />
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
