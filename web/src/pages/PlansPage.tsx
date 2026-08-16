import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { api } from '@/api/client'
import { useAuth } from '@/context/AuthContext'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { formatMoneyMinor } from '@/components/commercial-pricing/subscription-helpers'
import { SubscribeDialog } from './SubscribeDialog'
import type { Product, ProductTier, Subscription, TenantPlanEntry } from '@/types/commercialPricing'

export function PlansPage() {
  const { agent } = useAuth()
  const [plans, setPlans] = useState<TenantPlanEntry[]>([])
  const [current, setCurrent] = useState<Subscription | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [chosen, setChosen] = useState<{ product: Product; tier: ProductTier } | null>(null)

  useEffect(() => { void load() }, [agent?.id])

  async function load() {
    setLoading(true)
    setError(null)
    try {
      const [{ plans }, mine] = await Promise.all([
        api.listBillingPlans(),
        agent ? api.getMySubscription().catch(() => ({ subscription: null })) : Promise.resolve({ subscription: null }),
      ])
      setPlans(plans)
      setCurrent(mine.subscription)
    } catch (err: any) {
      setError(err?.message || 'Failed to load plans')
    } finally {
      setLoading(false)
    }
  }

  const grouped = useMemo(() => {
    const byType: Record<string, TenantPlanEntry[]> = { plan: [], addon: [], bundle: [] }
    for (const entry of plans) {
      const key = entry.product.product_type || 'plan'
      if (byType[key]) byType[key].push(entry)
    }
    return byType
  }, [plans])

  function isSubscribedTo(product: Product, tier: ProductTier) {
    if (!current) return false
    return current.product_id === product.id && current.tier_id === tier.id && ['trialing', 'active', 'past_due', 'paused'].includes(current.status)
  }

  return (
    <div className="container mx-auto px-4 py-8">
      <div className="mb-6">
        <h1 className="text-2xl font-bold">Plans</h1>
        <p className="text-sm text-muted-foreground">
          Choose the plan that fits your business. Pricing shown reflects your market.
        </p>
      </div>

      {error ? <p className="mb-3 text-sm text-red-600">{error}</p> : null}
      {loading ? <p className="text-sm text-muted-foreground">Loading…</p> : null}

      {agent && current ? (
        <div className="mb-6 rounded-md border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm">
          <div className="font-medium text-emerald-900">
            You have an active subscription.
          </div>
          <div className="mt-1 text-xs text-emerald-800">
            To upgrade / downgrade / cancel, visit <Link to="/subscription" className="underline">My Subscription</Link>.
          </div>
        </div>
      ) : null}

      {(['plan', 'addon', 'bundle'] as const).map((section) => {
        const entries = grouped[section] || []
        if (entries.length === 0) return null
        return (
          <div key={section} className="mb-10">
            <h2 className="mb-3 text-lg font-semibold capitalize">{section === 'addon' ? 'Add-ons' : `${section}s`}</h2>
            <div className="grid gap-4 lg:grid-cols-3">
              {entries.flatMap((entry) => entry.tiers.map((tier) => (
                <Card key={tier.id} className="flex flex-col">
                  <CardHeader>
                    <div className="flex items-center gap-2">
                      <CardTitle className="text-base">{tier.name}</CardTitle>
                      <Badge variant="outline" className="text-[10px]">{entry.product.name}</Badge>
                    </div>
                    <div className="mt-2 text-2xl font-bold">
                      {formatMoneyMinor(tier.price_minor ?? entry.product.base_price_minor, tier.currency || entry.product.currency)}
                    </div>
                    <div className="text-xs text-muted-foreground">
                      per {entry.product.billing_cadence.replace('_', ' ')}
                    </div>
                  </CardHeader>
                  <CardContent className="flex flex-1 flex-col justify-between space-y-3">
                    <div>
                      {tier.description ? (
                        <p className="mb-3 text-sm text-muted-foreground">{tier.description}</p>
                      ) : null}
                      {tier.features.length > 0 ? (
                        <div className="mb-3">
                          <div className="text-xs font-semibold uppercase text-muted-foreground">Features</div>
                          <ul className="mt-1 space-y-0.5 text-sm">
                            {tier.features.map((f) => <li key={f}>• {f}</li>)}
                          </ul>
                        </div>
                      ) : null}
                      {Object.keys(tier.quotas).length > 0 ? (
                        <div>
                          <div className="text-xs font-semibold uppercase text-muted-foreground">Included every {entry.product.billing_cadence.replace('_', ' ')}</div>
                          <ul className="mt-1 space-y-0.5 text-sm">
                            {Object.entries(tier.quotas).map(([k, v]) => (
                              <li key={k} className="tabular-nums">
                                {v.toLocaleString()} × <span className="font-mono text-xs">{k}</span>
                              </li>
                            ))}
                          </ul>
                        </div>
                      ) : null}
                    </div>
                    <div className="pt-3">
                      {!agent ? (
                        <Link to="/register">
                          <Button className="w-full">Register to subscribe</Button>
                        </Link>
                      ) : isSubscribedTo(entry.product, tier) ? (
                        <Button variant="outline" className="w-full" disabled>Current plan</Button>
                      ) : (
                        <Button
                          className="w-full"
                          onClick={() => setChosen({ product: entry.product, tier })}
                        >Subscribe</Button>
                      )}
                    </div>
                  </CardContent>
                </Card>
              )))}
            </div>
          </div>
        )
      })}

      {plans.length === 0 && !loading ? (
        <Card>
          <CardContent className="py-12 text-center text-sm text-muted-foreground">
            No plans are currently offered. Check back later.
          </CardContent>
        </Card>
      ) : null}

      {chosen ? (
        <SubscribeDialog
          open
          product={chosen.product}
          tier={chosen.tier}
          onClose={() => setChosen(null)}
          onSubscribed={() => { void load() }}
        />
      ) : null}
    </div>
  )
}
