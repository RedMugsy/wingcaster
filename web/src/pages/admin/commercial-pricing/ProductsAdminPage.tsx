import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { api } from '@/api/client'
import { useAuth } from '@/context/AuthContext'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { ProductStatusBadge } from '@/components/commercial-pricing/ProductStatusBadge'
import { formatMoneyMinor } from '@/components/commercial-pricing/subscription-helpers'
import { ProductFormDialog } from './ProductFormDialog'
import type { Product, ProductStatus, ProductType } from '@/types/commercialPricing'

const TYPE_OPTIONS: ProductType[] = ['plan', 'addon', 'bundle']
const STATUS_OPTIONS: ProductStatus[] = ['draft', 'active', 'deprecated', 'retired']

export function ProductsAdminPage() {
  const { isAdmin } = useAuth()
  const [products, setProducts] = useState<Product[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [includeAll, setIncludeAll] = useState(true)
  const [typeFilter, setTypeFilter] = useState<Set<ProductType>>(new Set())
  const [statusFilter, setStatusFilter] = useState<Set<ProductStatus>>(new Set())
  const [search, setSearch] = useState('')
  const [formOpen, setFormOpen] = useState(false)

  useEffect(() => { if (isAdmin) void load() }, [isAdmin, includeAll])

  async function load() {
    setLoading(true)
    setError(null)
    try {
      const { products } = await api.listAdminProducts({ include_all_statuses: includeAll })
      setProducts(products)
    } catch (err: any) {
      setError(err?.message || 'Failed to load products')
    } finally {
      setLoading(false)
    }
  }

  const filtered = useMemo(() => {
    const needle = search.trim().toLowerCase()
    return products.filter((p) => {
      if (typeFilter.size > 0 && !typeFilter.has(p.product_type)) return false
      if (statusFilter.size > 0 && !statusFilter.has(p.status)) return false
      if (needle && !`${p.code} ${p.name}`.toLowerCase().includes(needle)) return false
      return true
    })
  }, [products, typeFilter, statusFilter, search])

  function toggleType(v: ProductType) {
    setTypeFilter((prev) => {
      const next = new Set(prev)
      if (next.has(v)) next.delete(v); else next.add(v)
      return next
    })
  }

  function toggleStatus(v: ProductStatus) {
    setStatusFilter((prev) => {
      const next = new Set(prev)
      if (next.has(v)) next.delete(v); else next.add(v)
      return next
    })
  }

  if (!isAdmin) {
    return (
      <div className="container mx-auto max-w-2xl px-4 py-8">
        <Card>
          <CardHeader><CardTitle>Platform admin required</CardTitle></CardHeader>
          <CardContent className="text-sm text-muted-foreground">
            Product catalog is restricted to platform admins.
          </CardContent>
        </Card>
      </div>
    )
  }

  return (
    <div className="container mx-auto px-4 py-8">
      <div className="mb-6 flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold">Commercial Products</h1>
          <p className="text-sm text-muted-foreground">
            Plans, add-ons, and bundles. Version-pinned — publishing a new version grandfathers existing subscribers.
          </p>
        </div>
        <Button onClick={() => setFormOpen(true)}>+ New Product</Button>
      </div>

      <div className="mb-4 flex flex-wrap items-center gap-2">
        {TYPE_OPTIONS.map((v) => (
          <button
            key={v}
            onClick={() => toggleType(v)}
            className={
              'rounded-full border px-3 py-1 text-xs capitalize ' +
              (typeFilter.has(v) ? 'bg-primary text-primary-foreground' : 'bg-background text-foreground')
            }
          >
            {v}
          </button>
        ))}
        <span className="mx-2 h-4 w-px bg-border" />
        {STATUS_OPTIONS.map((v) => (
          <button
            key={v}
            onClick={() => toggleStatus(v)}
            className={
              'rounded-full border px-2 py-0.5 text-xs ' +
              (statusFilter.has(v) ? 'ring-2 ring-primary' : '')
            }
          >
            <ProductStatusBadge status={v} />
          </button>
        ))}
        <span className="mx-2 h-4 w-px bg-border" />
        <Input
          className="max-w-xs"
          placeholder="Search code or name…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        <label className="ml-2 flex cursor-pointer items-center gap-1 text-sm">
          <input type="checkbox" checked={includeAll} onChange={(e) => setIncludeAll(e.target.checked)} />
          Include deprecated / retired
        </label>
      </div>

      {error ? <p className="mb-3 text-sm text-red-600">{error}</p> : null}

      <div className="overflow-x-auto rounded-md border">
        <table className="w-full text-sm">
          <thead className="bg-muted/40 text-left">
            <tr>
              <th className="px-3 py-2 font-medium">Code</th>
              <th className="px-3 py-2 font-medium">Version</th>
              <th className="px-3 py-2 font-medium">Name</th>
              <th className="px-3 py-2 font-medium">Type</th>
              <th className="px-3 py-2 font-medium">Status</th>
              <th className="px-3 py-2 font-medium">Cadence</th>
              <th className="px-3 py-2 font-medium">Base price</th>
              <th className="px-3 py-2 font-medium">Public</th>
              <th className="px-3 py-2 text-right font-medium">Actions</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan={9} className="px-3 py-4 text-center text-muted-foreground">Loading…</td></tr>
            ) : filtered.length === 0 ? (
              <tr><td colSpan={9} className="px-3 py-4 text-center text-muted-foreground">No products match the filters.</td></tr>
            ) : filtered.map((p) => (
              <tr key={p.id} className="border-t hover:bg-muted/30">
                <td className="px-3 py-2 font-mono text-xs">{p.code}</td>
                <td className="px-3 py-2 tabular-nums">v{p.version}</td>
                <td className="px-3 py-2">
                  <Link to={`/admin/commercial-pricing/products/${p.id}`} className="hover:underline">
                    {p.name}
                  </Link>
                </td>
                <td className="px-3 py-2 capitalize">{p.product_type}</td>
                <td className="px-3 py-2"><ProductStatusBadge status={p.status} /></td>
                <td className="px-3 py-2 text-xs">{p.billing_cadence.replace('_', ' ')}</td>
                <td className="px-3 py-2 tabular-nums">{formatMoneyMinor(p.base_price_minor, p.currency)}</td>
                <td className="px-3 py-2 text-xs">{p.is_public ? 'yes' : 'no'}</td>
                <td className="px-3 py-2 text-right">
                  <Link to={`/admin/commercial-pricing/products/${p.id}`}>
                    <Button size="sm" variant="outline">Open</Button>
                  </Link>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <ProductFormDialog
        open={formOpen}
        mode="create"
        onClose={() => setFormOpen(false)}
        onSaved={() => { void load() }}
      />
    </div>
  )
}
