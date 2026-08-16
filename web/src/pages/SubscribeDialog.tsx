import { useState } from 'react'
import { api } from '@/api/client'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { formatMoneyMinor } from '@/components/commercial-pricing/subscription-helpers'
import type { Product, ProductTier, Subscription } from '@/types/commercialPricing'

interface SubscribeDialogProps {
  open: boolean
  product: Product
  tier: ProductTier
  onClose: () => void
  onSubscribed: (subscription: Subscription) => void
}

export function SubscribeDialog({ open, product, tier, onClose, onSubscribed }: SubscribeDialogProps) {
  const [trialDays, setTrialDays] = useState(0)
  const [autoRenew, setAutoRenew] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [errorCode, setErrorCode] = useState<string | null>(null)

  async function handleSubscribe() {
    setSaving(true)
    setError(null)
    setErrorCode(null)
    try {
      const { subscription } = await api.subscribeToTier({
        product_id: product.id,
        tier_id: tier.id,
        trial_days: trialDays > 0 ? trialDays : undefined,
        auto_renew: autoRenew,
      })
      onSubscribed(subscription)
      onClose()
    } catch (err: any) {
      setError(err?.message || 'Subscription failed')
      setErrorCode(err?.code || null)
    } finally {
      setSaving(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={(next) => { if (!next && !saving) onClose() }}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Subscribe to {tier.name}</DialogTitle>
          <DialogDescription>
            {product.name} v{product.version} — {product.billing_cadence.replace('_', ' ')} billing.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          <div className="rounded-md border bg-muted/30 p-3 text-sm">
            <div className="font-medium">{formatMoneyMinor(tier.price_minor ?? product.base_price_minor, tier.currency || product.currency)}</div>
            <div className="text-xs text-muted-foreground">per {product.billing_cadence.replace('_', ' ')}</div>
            {tier.features.length > 0 ? (
              <div className="mt-2 text-xs">
                <div className="font-medium">Features:</div>
                <ul className="ml-4 list-disc">
                  {tier.features.map((f) => <li key={f} className="font-mono">{f}</li>)}
                </ul>
              </div>
            ) : null}
            {Object.keys(tier.quotas).length > 0 ? (
              <div className="mt-2 text-xs">
                <div className="font-medium">Quotas per period:</div>
                <ul className="ml-4 list-disc">
                  {Object.entries(tier.quotas).map(([k, v]) => (
                    <li key={k} className="font-mono">{k}: {v.toLocaleString()}</li>
                  ))}
                </ul>
              </div>
            ) : null}
          </div>

          <div>
            <Label htmlFor="sub-trial">Trial days (optional)</Label>
            <Input
              id="sub-trial"
              type="number"
              min={0}
              max={90}
              value={trialDays}
              onChange={(e) => setTrialDays(Math.max(0, Number(e.target.value) || 0))}
            />
            <p className="mt-1 text-xs text-muted-foreground">
              Free trial before the first billing period. Set 0 to bill immediately.
            </p>
          </div>

          <div className="flex items-center gap-2">
            <input
              id="sub-auto-renew"
              type="checkbox"
              checked={autoRenew}
              onChange={(e) => setAutoRenew(e.target.checked)}
            />
            <Label htmlFor="sub-auto-renew" className="cursor-pointer">Auto-renew at period end</Label>
          </div>
        </div>

        {error ? (
          <div className="rounded-md border border-red-200 bg-red-50 p-2 text-sm text-red-700">
            {error}
            {errorCode === 'PLAN_ALREADY_SUBSCRIBED' ? (
              <div className="mt-1 text-xs">
                You already have an active plan. Visit <a href="/subscription" className="underline">My Subscription</a> to change or cancel it.
              </div>
            ) : null}
          </div>
        ) : null}

        <div className="flex justify-end gap-2 pt-2">
          <Button variant="outline" onClick={onClose} disabled={saving}>Cancel</Button>
          <Button onClick={handleSubscribe} disabled={saving}>
            {saving ? 'Subscribing…' : trialDays > 0 ? `Start ${trialDays}-day trial` : 'Subscribe'}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}
