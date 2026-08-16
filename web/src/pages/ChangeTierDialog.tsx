import { useEffect, useMemo, useState } from 'react'
import { api } from '@/api/client'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { formatMoneyMinor } from '@/components/commercial-pricing/subscription-helpers'
import type { Subscription, TenantPlanEntry } from '@/types/commercialPricing'

interface ChangeTierDialogProps {
  open: boolean
  subscription: Subscription
  onClose: () => void
  onChanged: (sub: Subscription) => void
}

export function ChangeTierDialog({ open, subscription, onClose, onChanged }: ChangeTierDialogProps) {
  const [plans, setPlans] = useState<TenantPlanEntry[]>([])
  const [loading, setLoading] = useState(false)
  const [productId, setProductId] = useState<string>(subscription.product_id)
  const [tierId, setTierId] = useState<string>('')
  const [reason, setReason] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!open) return
    setError(null)
    setLoading(true)
    api.listBillingPlans()
      .then(({ plans }) => setPlans(plans))
      .catch((err) => setError(err?.message || 'Failed to load plans'))
      .finally(() => setLoading(false))
  }, [open])

  const currentProductEntry = useMemo(() => plans.find((p) => p.product.id === productId), [plans, productId])
  const availableTiers = useMemo(() => {
    if (!currentProductEntry) return []
    return currentProductEntry.tiers.filter((t) => t.id !== subscription.tier_id)
  }, [currentProductEntry, subscription.tier_id])

  const chosenTier = availableTiers.find((t) => t.id === tierId) || null

  async function handleChange() {
    if (!tierId) { setError('Please pick a target tier.'); return }
    setSaving(true)
    setError(null)
    try {
      const { subscription: updated } = await api.changeMyTier({
        subscription_id: subscription.id,
        target_tier_id: tierId,
        target_product_id: productId !== subscription.product_id ? productId : undefined,
        prorate: true,
        reason: reason || undefined,
      })
      onChanged(updated)
      onClose()
    } catch (err: any) {
      setError(err?.message || 'Change failed')
    } finally {
      setSaving(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={(next) => { if (!next && !saving) onClose() }}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Change plan</DialogTitle>
          <DialogDescription>
            Any price difference for the remainder of the current period becomes a credit note applied
            to your next invoice. Your current period&apos;s allowances are not rescinded.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          <div>
            <Label htmlFor="ct-product">Product</Label>
            <select
              id="ct-product"
              className="h-10 w-full rounded-md border bg-background px-3 text-sm"
              value={productId}
              onChange={(e) => { setProductId(e.target.value); setTierId('') }}
              disabled={loading}
            >
              {plans.map((p) => (
                <option key={p.product.id} value={p.product.id}>
                  {p.product.name} v{p.product.version}
                </option>
              ))}
            </select>
          </div>
          <div>
            <Label htmlFor="ct-tier">Target tier</Label>
            <select
              id="ct-tier"
              className="h-10 w-full rounded-md border bg-background px-3 text-sm"
              value={tierId}
              onChange={(e) => setTierId(e.target.value)}
              disabled={loading || availableTiers.length === 0}
            >
              <option value="">Select a tier…</option>
              {availableTiers.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name} — {formatMoneyMinor(t.price_minor, t.currency || 'USD')}
                </option>
              ))}
            </select>
          </div>
          {chosenTier && subscription.resolved_plan_price_minor != null ? (
            <div className="rounded-md border bg-muted/30 p-2 text-xs text-muted-foreground">
              Current plan: {formatMoneyMinor(subscription.resolved_plan_price_minor, subscription.resolved_plan_currency)}<br />
              New plan:     {formatMoneyMinor(chosenTier.price_minor, chosenTier.currency || 'USD')}
            </div>
          ) : null}
          <div>
            <Label htmlFor="ct-reason">Reason (optional)</Label>
            <Input id="ct-reason" value={reason} onChange={(e) => setReason(e.target.value)} />
          </div>
        </div>

        {error ? <p className="text-sm text-red-600">{error}</p> : null}

        <div className="flex justify-end gap-2 pt-2">
          <Button variant="outline" onClick={onClose} disabled={saving}>Cancel</Button>
          <Button onClick={handleChange} disabled={saving || !tierId}>{saving ? 'Applying…' : 'Change plan'}</Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}
