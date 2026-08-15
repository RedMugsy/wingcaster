import { useEffect, useMemo, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { api } from '@/api/client'
import { useAuth } from '@/context/AuthContext'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { ProductStatusBadge } from '@/components/commercial-pricing/ProductStatusBadge'
import { ConfirmDeactivateDialog } from '@/components/commercial-pricing/ConfirmDeactivateDialog'
import { formatMoneyMinor, formatShortIso } from '@/components/commercial-pricing/subscription-helpers'
import { ProductFormDialog } from './ProductFormDialog'
import { TierFormDialog } from './TierFormDialog'
import { PricingOverrideFormDialog } from './PricingOverrideFormDialog'
import type { PricingOverride, Product, ProductTier, Territory } from '@/types/commercialPricing'

export function ProductDetailPage() {
  const { id } = useParams<{ id: string }>()
  const { isAdmin } = useAuth()
  const navigate = useNavigate()
  const [product, setProduct] = useState<Product | null>(null)
  const [tiers, setTiers] = useState<ProductTier[]>([])
  const [overrides, setOverrides] = useState<PricingOverride[]>([])
  const [territories, setTerritories] = useState<Territory[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [tab, setTab] = useState<'overview' | 'tiers' | 'overrides'>('overview')

  const [editProductOpen, setEditProductOpen] = useState(false)
  const [tierFormOpen, setTierFormOpen] = useState(false)
  const [editingTier, setEditingTier] = useState<ProductTier | null>(null)
  const [overrideFormOpen, setOverrideFormOpen] = useState(false)
  const [editingOverride, setEditingOverride] = useState<PricingOverride | null>(null)
  const [confirm, setConfirm] = useState<{ label: string; description: string; onConfirm: () => Promise<void> } | null>(null)

  useEffect(() => { if (isAdmin && id) void load() }, [isAdmin, id])

  async function load() {
    if (!id) return
    setLoading(true)
    setError(null)
    try {
      const [detail, terRes] = await Promise.all([
        api.getAdminProduct(id),
        api.listAdminTerritories({ include_inactive: false }),
      ])
      setProduct(detail.product)
      setTiers(detail.tiers)
      setOverrides(detail.overrides)
      setTerritories(terRes.territories)
    } catch (err: any) {
      setError(err?.message || 'Failed to load product')
    } finally {
      setLoading(false)
    }
  }

  const territoryById = useMemo(() => Object.fromEntries(territories.map((t) => [t.id, t])), [territories])
  const tierById = useMemo(() => Object.fromEntries(tiers.map((t) => [t.id, t])), [tiers])

  async function runAction<T>(fn: () => Promise<T>) {
    try {
      await fn()
      await load()
      setConfirm(null)
    } catch (err: any) {
      setError(err?.message || 'Action failed')
    }
  }

  if (!isAdmin) {
    return (
      <div className="container mx-auto max-w-2xl px-4 py-8">
        <Card>
          <CardHeader><CardTitle>Platform admin required</CardTitle></CardHeader>
          <CardContent className="text-sm text-muted-foreground">Product catalog is restricted to platform admins.</CardContent>
        </Card>
      </div>
    )
  }

  return (
    <div className="container mx-auto px-4 py-8">
      <div className="mb-4">
        <Link to="/admin/commercial-pricing/products" className="text-sm text-muted-foreground hover:underline">
          ← Products
        </Link>
      </div>

      {error ? <p className="mb-3 text-sm text-red-600">{error}</p> : null}
      {loading || !product ? (
        <p className="text-sm text-muted-foreground">Loading…</p>
      ) : (
        <>
          <div className="mb-6 flex items-start justify-between gap-4">
            <div>
              <div className="flex items-center gap-3">
                <span className="font-mono text-lg font-bold">{product.code}</span>
                <span className="text-xs text-muted-foreground">v{product.version}</span>
                <h1 className="text-2xl font-bold">{product.name}</h1>
                <ProductStatusBadge status={product.status} />
                <Badge variant="outline" className="capitalize">{product.product_type}</Badge>
              </div>
              <p className="mt-1 text-sm text-muted-foreground">
                {product.description || 'No description.'}
              </p>
            </div>
            <div className="flex flex-wrap gap-2">
              <Button variant="outline" onClick={() => setEditProductOpen(true)}>Edit</Button>
              {product.status === 'draft' ? (
                <Button onClick={() => setConfirm({
                  label: 'Publish product',
                  description: 'Publishing sets this version as active and grandfathers subscribers on any prior version. This action cannot be undone.',
                  onConfirm: async () => { await api.publishAdminProduct(product.id) },
                })}>Publish</Button>
              ) : null}
              {product.status === 'active' ? (
                <Button variant="outline" onClick={() => setConfirm({
                  label: 'Deprecate product',
                  description: 'Deprecating stops new subscriptions from being created on this version. Existing subscribers keep their subscription.',
                  onConfirm: async () => { await api.deprecateAdminProduct(product.id) },
                })}>Deprecate</Button>
              ) : null}
              {product.status === 'deprecated' ? (
                <Button variant="outline" onClick={() => setConfirm({
                  label: 'Retire product',
                  description: 'Retiring locks this version out entirely. Blocked when live subscribers still exist.',
                  onConfirm: async () => { await api.retireAdminProduct(product.id) },
                })}>Retire</Button>
              ) : null}
              <Button variant="outline" onClick={async () => {
                try {
                  const { product: cloned } = await api.cloneAdminProduct(product.id)
                  navigate(`/admin/commercial-pricing/products/${cloned.id}`)
                } catch (err: any) {
                  setError(err?.message || 'Clone failed')
                }
              }}>Clone as new version</Button>
            </div>
          </div>

          <Tabs value={tab} onValueChange={(v) => setTab(v as typeof tab)}>
            <TabsList>
              <TabsTrigger value="overview">Overview</TabsTrigger>
              <TabsTrigger value="tiers">Tiers ({tiers.length})</TabsTrigger>
              <TabsTrigger value="overrides">Pricing overrides ({overrides.length})</TabsTrigger>
            </TabsList>

            <TabsContent value="overview" className="space-y-4">
              <Card>
                <CardHeader className="pb-2"><CardTitle className="text-sm">Identity</CardTitle></CardHeader>
                <CardContent className="grid grid-cols-2 gap-3 text-sm">
                  <Field label="Code">{product.code}</Field>
                  <Field label="Version">v{product.version}</Field>
                  <Field label="Type"><span className="capitalize">{product.product_type}</span></Field>
                  <Field label="Public"><span>{product.is_public ? 'Yes' : 'No'}</span></Field>
                </CardContent>
              </Card>
              <Card>
                <CardHeader className="pb-2"><CardTitle className="text-sm">Pricing + cadence</CardTitle></CardHeader>
                <CardContent className="grid grid-cols-2 gap-3 text-sm">
                  <Field label="Base price">{formatMoneyMinor(product.base_price_minor, product.currency)}</Field>
                  <Field label="Currency">{product.currency}</Field>
                  <Field label="Billing cadence">{product.billing_cadence.replace('_', ' ')}</Field>
                </CardContent>
              </Card>
              <Card>
                <CardHeader className="pb-2"><CardTitle className="text-sm">Lifecycle</CardTitle></CardHeader>
                <CardContent className="grid grid-cols-2 gap-3 text-sm">
                  <Field label="Created">{formatShortIso(product.created_at)}</Field>
                  <Field label="Published">{formatShortIso(product.published_at)}</Field>
                  <Field label="Deprecated">{formatShortIso(product.deprecated_at)}</Field>
                  <Field label="Retired">{formatShortIso(product.retired_at)}</Field>
                </CardContent>
              </Card>
              {(product.entitlements?.length || 0) > 0 || (product.bundle_items?.length || 0) > 0 ? (
                <Card>
                  <CardHeader className="pb-2"><CardTitle className="text-sm">Entitlements + bundle</CardTitle></CardHeader>
                  <CardContent className="space-y-2 text-xs font-mono">
                    <div>Entitlements: {JSON.stringify(product.entitlements)}</div>
                    <div>Bundle items: {JSON.stringify(product.bundle_items)}</div>
                  </CardContent>
                </Card>
              ) : null}
            </TabsContent>

            <TabsContent value="tiers">
              <div className="mb-3 flex items-center justify-between">
                <p className="text-sm text-muted-foreground">Tiers are variants within this product version.</p>
                <Button size="sm" onClick={() => { setEditingTier(null); setTierFormOpen(true) }}>+ New Tier</Button>
              </div>
              <div className="overflow-x-auto rounded-md border">
                <table className="w-full text-sm">
                  <thead className="bg-muted/40 text-left">
                    <tr>
                      <th className="px-3 py-2 font-medium">Sort</th>
                      <th className="px-3 py-2 font-medium">Code</th>
                      <th className="px-3 py-2 font-medium">Name</th>
                      <th className="px-3 py-2 font-medium">Status</th>
                      <th className="px-3 py-2 font-medium">Public</th>
                      <th className="px-3 py-2 font-medium">Price</th>
                      <th className="px-3 py-2 font-medium">Features</th>
                      <th className="px-3 py-2 font-medium">Quotas</th>
                      <th className="px-3 py-2 text-right font-medium">Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {tiers.length === 0 ? (
                      <tr><td colSpan={9} className="px-3 py-4 text-center text-muted-foreground">No tiers yet.</td></tr>
                    ) : tiers.slice().sort((a, b) => (a.sort_order || 0) - (b.sort_order || 0)).map((tier) => (
                      <tr key={tier.id} className="border-t">
                        <td className="px-3 py-2 tabular-nums">{tier.sort_order}</td>
                        <td className="px-3 py-2 font-mono text-xs">{tier.code}</td>
                        <td className="px-3 py-2">{tier.name}</td>
                        <td className="px-3 py-2"><ProductStatusBadge status={tier.status} /></td>
                        <td className="px-3 py-2 text-xs">{tier.is_public ? 'yes' : 'no'}</td>
                        <td className="px-3 py-2 tabular-nums">
                          {tier.price_minor != null ? formatMoneyMinor(tier.price_minor, tier.currency || product.currency) : <span className="text-muted-foreground">(inherits)</span>}
                        </td>
                        <td className="px-3 py-2 text-xs">
                          {tier.features.length > 0 ? tier.features.join(', ') : <span className="text-muted-foreground">—</span>}
                        </td>
                        <td className="px-3 py-2 text-xs">
                          {Object.keys(tier.quotas).length > 0
                            ? Object.entries(tier.quotas).map(([k, v]) => `${k}=${v}`).join(', ')
                            : <span className="text-muted-foreground">—</span>}
                        </td>
                        <td className="px-3 py-2 text-right">
                          <Button size="sm" variant="outline" onClick={() => { setEditingTier(tier); setTierFormOpen(true) }}>Edit</Button>
                          {tier.status === 'draft' ? (
                            <Button size="sm" className="ml-2" onClick={() => runAction(() => api.activateAdminTier(tier.id))}>Activate</Button>
                          ) : null}
                          {tier.status === 'active' ? (
                            <Button size="sm" variant="outline" className="ml-2" onClick={() => setConfirm({
                              label: `Deprecate ${tier.name}?`,
                              description: 'Deprecated tiers stop accepting new subscribers. Existing subscribers stay.',
                              onConfirm: async () => { await api.deprecateAdminTier(tier.id) },
                            })}>Deprecate</Button>
                          ) : null}
                          {tier.status === 'deprecated' ? (
                            <Button size="sm" variant="outline" className="ml-2" onClick={() => setConfirm({
                              label: `Retire ${tier.name}?`,
                              description: 'Retiring locks this tier out entirely. Blocked when live subscribers still exist.',
                              onConfirm: async () => { await api.retireAdminTier(tier.id) },
                            })}>Retire</Button>
                          ) : null}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </TabsContent>

            <TabsContent value="overrides">
              <div className="mb-3 flex items-center justify-between">
                <p className="text-sm text-muted-foreground">Per-territory price overrides. Tier-specific wins over product-wide.</p>
                <Button size="sm" onClick={() => { setEditingOverride(null); setOverrideFormOpen(true) }}>+ New Override</Button>
              </div>
              <div className="overflow-x-auto rounded-md border">
                <table className="w-full text-sm">
                  <thead className="bg-muted/40 text-left">
                    <tr>
                      <th className="px-3 py-2 font-medium">Territory</th>
                      <th className="px-3 py-2 font-medium">Tier</th>
                      <th className="px-3 py-2 font-medium">Price</th>
                      <th className="px-3 py-2 font-medium">Active</th>
                      <th className="px-3 py-2 text-right font-medium">Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {overrides.length === 0 ? (
                      <tr><td colSpan={5} className="px-3 py-4 text-center text-muted-foreground">No pricing overrides.</td></tr>
                    ) : overrides.map((o) => (
                      <tr key={o.id} className="border-t">
                        <td className="px-3 py-2">
                          <span className="font-mono text-xs">{territoryById[o.territory_id]?.code || '?'}</span>
                          <span className="ml-2 text-xs text-muted-foreground">{territoryById[o.territory_id]?.name || ''}</span>
                        </td>
                        <td className="px-3 py-2 text-xs">
                          {o.tier_id ? (tierById[o.tier_id]?.name || o.tier_id) : <span className="text-muted-foreground">Product-wide</span>}
                        </td>
                        <td className="px-3 py-2 tabular-nums">{formatMoneyMinor(o.price_minor, o.currency)}</td>
                        <td className="px-3 py-2 text-xs">{o.active ? 'yes' : 'no'}</td>
                        <td className="px-3 py-2 text-right">
                          <Button size="sm" variant="outline" onClick={() => { setEditingOverride(o); setOverrideFormOpen(true) }}>Edit</Button>
                          {o.active ? (
                            <Button size="sm" variant="outline" className="ml-2" onClick={() => runAction(() => api.deleteAdminProductOverride(o.id))}>
                              Deactivate
                            </Button>
                          ) : null}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </TabsContent>
          </Tabs>
        </>
      )}

      {product ? (
        <>
          <ProductFormDialog
            open={editProductOpen}
            mode="edit"
            initial={product}
            onClose={() => setEditProductOpen(false)}
            onSaved={() => { void load() }}
          />
          <TierFormDialog
            open={tierFormOpen}
            mode={editingTier ? 'edit' : 'create'}
            product={product}
            initial={editingTier}
            onClose={() => { setTierFormOpen(false); setEditingTier(null) }}
            onSaved={() => { void load() }}
          />
          <PricingOverrideFormDialog
            open={overrideFormOpen}
            mode={editingOverride ? 'edit' : 'create'}
            product={product}
            tiers={tiers}
            territories={territories}
            initial={editingOverride}
            onClose={() => { setOverrideFormOpen(false); setEditingOverride(null) }}
            onSaved={() => { void load() }}
          />
        </>
      ) : null}
      <ConfirmDeactivateDialog
        open={Boolean(confirm)}
        title={confirm?.label || ''}
        description={confirm?.description || ''}
        confirmLabel="Confirm"
        onConfirm={confirm?.onConfirm || (async () => {})}
        onCancel={() => setConfirm(null)}
      />
    </div>
  )
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="text-xs text-muted-foreground">{label}</div>
      <div>{children}</div>
    </div>
  )
}
