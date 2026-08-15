import { useEffect, useState } from 'react'
import { api } from '@/api/client'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { formatMoneyMinor } from '@/components/commercial-pricing/subscription-helpers'
import type { Product, ProductTier, Subscription } from '@/types/commercialPricing'

interface MigrateSubscriptionDialogProps {
  open: boolean
  subscription: Subscription
  onClose: () => void
  onMigrated: (sub: Subscription) => void
}

export function MigrateSubscriptionDialog({ open, subscription, onClose, onMigrated }: MigrateSubscriptionDialogProps) {
  const [products, setProducts] = useState<Product[]>([])
  const [tiers, setTiers] = useState<ProductTier[]>([])
  const [loading, setLoading] = useState(false)
  const [productId, setProductId] = useState<string>('')
  const [tierId, setTierId] = useState<string>('')
  const [prorate, setProrate] = useState(true)
  const [reason, setReason] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!open) return
    setProductId('')
    setTierId('')
    setReason('')
    setError(null)
    setLoading(true)
    api.listAdminProducts({ include_all_statuses: false }).then(({ products }) => {
      setProducts(products.filter((p) => p.status === 'active'))
    }).catch((err) => setError(err?.message || 'Failed to load products'))
      .finally(() => setLoading(false))
  }, [open])

  useEffect(() => {
    if (!productId) { setTiers([]); return }
    setLoading(true)
    api.listAdminTiers(productId).then(({ tiers }) => {
      setTiers(tiers.filter((t) => t.status === 'active'))
    }).catch((err) => setError(err?.message || 'Failed to load tiers'))
      .finally(() => setLoading(false))
  }, [productId])

  async function handleMigrate() {
    if (!tierId) { setError('Target tier is required'); return }
    setSaving(true)
    setError(null)
    try {
      const { subscription: migrated } = await api.migrateAdminSubscription(subscription.id, {
        target_product_id: productId || undefined,
        target_tier_id: tierId,
        prorate,
        reason: reason || undefined,
      })
      onMigrated(migrated)
      onClose()
    } catch (err: any) {
      setError(err?.message || 'Migration failed')
    } finally {
      setSaving(false)
    }
  }

  const selectedTier = tiers.find((t) => t.id === tierId)

  return (
    <Dialog open={open} onOpenChange={(next) => { if (!next && !saving) onClose() }}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Migrate subscription</DialogTitle>
          <DialogDescription>
            Move this tenant to a different product / tier. When prorate is on, the price delta becomes a
            credit note (positive = credit owed to tenant, negative = debit).
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          <div>
            <Label htmlFor="mig-product">Target product</Label>
            <select
              id="mig-product"
              className="h-10 w-full rounded-md border bg-background px-3 text-sm"
              value={productId}
              onChange={(e) => { setProductId(e.target.value); setTierId('') }}
              disabled={loading}
            >
              <option value="">Select a product…</option>
              {products.map((p) => (
                <option key={p.id} value={p.id}>{p.code} v{p.version} — {p.name}</option>
              ))}
            </select>
          </div>
          <div>
            <Label htmlFor="mig-tier">Target tier</Label>
            <select
              id="mig-tier"
              className="h-10 w-full rounded-md border bg-background px-3 text-sm"
              value={tierId}
              onChange={(e) => setTierId(e.target.value)}
              disabled={!productId || loading}
            >
              <option value="">Select a tier…</option>
              {tiers.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name} — {formatMoneyMinor(t.price_minor, t.currency || 'USD')}
                </option>
              ))}
            </select>
          </div>
          {selectedTier && subscription.resolved_plan_price_minor != null ? (
            <div className="rounded-md border bg-muted/30 p-2 text-xs text-muted-foreground">
              Current plan: {formatMoneyMinor(subscription.resolved_plan_price_minor, subscription.resolved_plan_currency || 'USD')}<br />
              New plan:     {formatMoneyMinor(selectedTier.price_minor, selectedTier.currency || 'USD')}<br />
              {prorate ? 'A proration credit note will be issued based on days remaining in the current period.' : 'Proration disabled — no credit note will be issued.'}
            </div>
          ) : null}
          <div className="flex items-center gap-2">
            <input id="mig-prorate" type="checkbox" checked={prorate} onChange={(e) => setProrate(e.target.checked)} />
            <Label htmlFor="mig-prorate" className="cursor-pointer">Prorate remainder of current period</Label>
          </div>
          <div>
            <Label htmlFor="mig-reason">Reason (optional, audit-visible)</Label>
            <Input id="mig-reason" value={reason} onChange={(e) => setReason(e.target.value)} />
          </div>
        </div>

        {error ? <p className="text-sm text-red-600">{error}</p> : null}

        <div className="flex justify-end gap-2 pt-2">
          <Button variant="outline" onClick={onClose} disabled={saving}>Cancel</Button>
          <Button onClick={handleMigrate} disabled={saving || !tierId}>{saving ? 'Migrating…' : 'Migrate'}</Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}
