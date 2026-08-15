import { useEffect, useState } from 'react'
import { api } from '@/api/client'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { CREDIT_NOTE_TYPE_LABELS } from '@/components/commercial-pricing/subscription-helpers'
import type { CreditNote, CreditNoteType } from '@/types/commercialPricing'

interface CreditNoteFormDialogProps {
  open: boolean
  onClose: () => void
  onSaved: (note: CreditNote) => void
  presetTenantId?: string
  presetSubscriptionId?: string
}

const TYPE_OPTIONS: CreditNoteType[] = ['courtesy', 'refund', 'promo', 'manual_adjustment']

interface FormState {
  tenant_id: string
  subscription_id: string
  type: CreditNoteType
  amount_minor: number
  currency: string
  reason: string
  expires_at: string
}

function initialState(presetTenant?: string, presetSub?: string): FormState {
  return {
    tenant_id: presetTenant || '',
    subscription_id: presetSub || '',
    type: 'courtesy',
    amount_minor: 500,
    currency: 'USD',
    reason: '',
    expires_at: '',
  }
}

export function validateCreditNoteForm(state: FormState): string | null {
  if (!state.tenant_id.trim()) return 'tenant_id is required'
  if (!TYPE_OPTIONS.includes(state.type) && state.type !== 'proration_credit' && state.type !== 'proration_debit') {
    return 'Invalid type'
  }
  const n = Number(state.amount_minor)
  if (!Number.isFinite(n) || n === 0) return 'Amount must be a non-zero integer'
  if (!/^[A-Z]{3}$/.test(state.currency)) return 'Currency must be a 3-letter uppercase code'
  return null
}

export function CreditNoteFormDialog({ open, onClose, onSaved, presetTenantId, presetSubscriptionId }: CreditNoteFormDialogProps) {
  const [state, setState] = useState<FormState>(() => initialState(presetTenantId, presetSubscriptionId))
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (open) {
      setState(initialState(presetTenantId, presetSubscriptionId))
      setError(null)
    }
  }, [open, presetTenantId, presetSubscriptionId])

  async function handleSave() {
    const validation = validateCreditNoteForm(state)
    if (validation) { setError(validation); return }
    setSaving(true)
    setError(null)
    try {
      const { note } = await api.createAdminCreditNote({
        tenant_id: state.tenant_id.trim(),
        subscription_id: state.subscription_id.trim() || undefined,
        type: state.type,
        amount_minor: Math.round(Number(state.amount_minor)),
        currency: state.currency,
        reason: state.reason || undefined,
        expires_at: state.expires_at || undefined,
      })
      onSaved(note)
      onClose()
    } catch (err: any) {
      setError(err?.message || 'Failed to issue credit note')
    } finally {
      setSaving(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={(next) => { if (!next && !saving) onClose() }}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Issue Credit Note</DialogTitle>
          <DialogDescription>
            Positive amount = credit owed to tenant. Negative = charge owed by tenant. Sign the amount
            explicitly — the sign is stored verbatim.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          <div>
            <Label htmlFor="cn-tenant">Tenant ID</Label>
            <Input
              id="cn-tenant"
              value={state.tenant_id}
              disabled={Boolean(presetTenantId)}
              onChange={(e) => setState((s) => ({ ...s, tenant_id: e.target.value }))}
            />
          </div>
          <div>
            <Label htmlFor="cn-sub">Subscription ID (optional)</Label>
            <Input
              id="cn-sub"
              value={state.subscription_id}
              disabled={Boolean(presetSubscriptionId)}
              onChange={(e) => setState((s) => ({ ...s, subscription_id: e.target.value }))}
            />
          </div>
          <div>
            <Label htmlFor="cn-type">Type</Label>
            <select
              id="cn-type"
              className="h-10 w-full rounded-md border bg-background px-3 text-sm"
              value={state.type}
              onChange={(e) => setState((s) => ({ ...s, type: e.target.value as CreditNoteType }))}
            >
              {TYPE_OPTIONS.map((t) => (
                <option key={t} value={t}>{CREDIT_NOTE_TYPE_LABELS[t]}</option>
              ))}
            </select>
            <p className="mt-1 text-xs text-muted-foreground">Proration credits/debits are created automatically by the migration flow.</p>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div>
              <Label htmlFor="cn-amount">Amount (minor units, signed)</Label>
              <Input
                id="cn-amount"
                type="number"
                value={state.amount_minor}
                onChange={(e) => setState((s) => ({ ...s, amount_minor: Number(e.target.value) }))}
              />
              <p className="mt-1 text-xs text-muted-foreground">e.g. 500 = $5.00 credit; −1000 = $10.00 owed</p>
            </div>
            <div>
              <Label htmlFor="cn-currency">Currency</Label>
              <Input
                id="cn-currency"
                maxLength={3}
                value={state.currency}
                onChange={(e) => setState((s) => ({ ...s, currency: e.target.value.toUpperCase() }))}
              />
            </div>
          </div>
          <div>
            <Label htmlFor="cn-reason">Reason (audit-visible)</Label>
            <Input id="cn-reason" value={state.reason} onChange={(e) => setState((s) => ({ ...s, reason: e.target.value }))} />
          </div>
          <div>
            <Label htmlFor="cn-expires">Expires at (optional, ISO datetime)</Label>
            <Input id="cn-expires" placeholder="2027-01-01T00:00:00Z" value={state.expires_at} onChange={(e) => setState((s) => ({ ...s, expires_at: e.target.value }))} />
          </div>
        </div>

        {error ? <p className="text-sm text-red-600">{error}</p> : null}

        <div className="flex justify-end gap-2 pt-2">
          <Button variant="outline" onClick={onClose} disabled={saving}>Cancel</Button>
          <Button onClick={handleSave} disabled={saving}>{saving ? 'Issuing…' : 'Issue'}</Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}
