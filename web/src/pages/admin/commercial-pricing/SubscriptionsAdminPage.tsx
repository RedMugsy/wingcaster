import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { api } from '@/api/client'
import { useAuth } from '@/context/AuthContext'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { SubscriptionStatusBadge } from '@/components/commercial-pricing/SubscriptionStatusBadge'
import {
  SUBSCRIPTION_STATUS_LABELS,
  formatMoneyMinor,
  formatShortIso,
} from '@/components/commercial-pricing/subscription-helpers'
import type { Subscription, SubscriptionStatus } from '@/types/commercialPricing'

const STATUS_OPTIONS: SubscriptionStatus[] = ['trialing', 'active', 'past_due', 'paused', 'cancelled', 'expired']

export function SubscriptionsAdminPage() {
  const { isAdmin } = useAuth()
  const [subs, setSubs] = useState<Subscription[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [statusFilter, setStatusFilter] = useState<Set<SubscriptionStatus>>(new Set(['trialing', 'active', 'past_due', 'paused']))
  const [tenantFilter, setTenantFilter] = useState('')
  const [ticking, setTicking] = useState(false)
  const [tickResult, setTickResult] = useState<string | null>(null)

  useEffect(() => { if (isAdmin) void load() }, [isAdmin, JSON.stringify([...statusFilter].sort()), tenantFilter])

  async function load() {
    setLoading(true)
    setError(null)
    try {
      const { subscriptions } = await api.listAdminSubscriptions({
        status: statusFilter.size > 0 ? Array.from(statusFilter) : undefined,
        tenant_id: tenantFilter.trim() || undefined,
        limit: 500,
      })
      setSubs(subscriptions)
    } catch (err: any) {
      setError(err?.message || 'Failed to load subscriptions')
    } finally {
      setLoading(false)
    }
  }

  function toggleStatus(status: SubscriptionStatus) {
    setStatusFilter((prev) => {
      const next = new Set(prev)
      if (next.has(status)) next.delete(status); else next.add(status)
      return next
    })
  }

  const grouped = useMemo(() => {
    const counts: Record<SubscriptionStatus, number> = {
      trialing: 0, active: 0, past_due: 0, paused: 0, cancelled: 0, expired: 0,
    }
    for (const s of subs) counts[s.status] += 1
    return counts
  }, [subs])

  async function handleTick() {
    setTicking(true)
    setTickResult(null)
    try {
      const summary = await api.tickRenewalSweep()
      setTickResult(`Renewed ${summary.renewed} · trials ended ${summary.trials_ended} · expired ${summary.expired} · credit-notes swept ${summary.credit_notes_expired}${summary.errors.length ? ` · ${summary.errors.length} error(s)` : ''}`)
      await load()
    } catch (err: any) {
      setError(err?.message || 'Tick failed')
    } finally {
      setTicking(false)
    }
  }

  if (!isAdmin) {
    return (
      <div className="container mx-auto max-w-2xl px-4 py-8">
        <Card>
          <CardHeader><CardTitle>Platform admin required</CardTitle></CardHeader>
          <CardContent className="text-sm text-muted-foreground">Subscription management is restricted to platform admins.</CardContent>
        </Card>
      </div>
    )
  }

  return (
    <div className="container mx-auto px-4 py-8">
      <div className="mb-6 flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold">Subscriptions</h1>
          <p className="text-sm text-muted-foreground">
            Every tenant subscription across every product + tier. Scheduler ticks every 15 min by default.
          </p>
        </div>
        <Button variant="outline" onClick={handleTick} disabled={ticking}>
          {ticking ? 'Ticking…' : 'Force renewal sweep'}
        </Button>
      </div>

      {tickResult ? <p className="mb-3 rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-800">{tickResult}</p> : null}
      {error ? <p className="mb-3 text-sm text-red-600">{error}</p> : null}

      <div className="mb-4 flex flex-wrap items-center gap-2">
        {STATUS_OPTIONS.map((status) => (
          <button
            key={status}
            onClick={() => toggleStatus(status)}
            className={
              'rounded-full border px-2 py-0.5 text-xs ' +
              (statusFilter.has(status) ? 'ring-2 ring-primary' : '')
            }
          >
            <SubscriptionStatusBadge status={status} />
            <span className="ml-1 text-[10px] text-muted-foreground">({grouped[status]})</span>
          </button>
        ))}
        <span className="mx-2 h-4 w-px bg-border" />
        <Input
          className="max-w-xs"
          placeholder="Filter by tenant id…"
          value={tenantFilter}
          onChange={(e) => setTenantFilter(e.target.value)}
        />
      </div>

      <div className="overflow-x-auto rounded-md border">
        <table className="w-full text-sm">
          <thead className="bg-muted/40 text-left">
            <tr>
              <th className="px-3 py-2 font-medium">Tenant</th>
              <th className="px-3 py-2 font-medium">Product / Tier</th>
              <th className="px-3 py-2 font-medium">Version</th>
              <th className="px-3 py-2 font-medium">Status</th>
              <th className="px-3 py-2 font-medium">Plan price</th>
              <th className="px-3 py-2 font-medium">Next renewal</th>
              <th className="px-3 py-2 font-medium">Flags</th>
              <th className="px-3 py-2 text-right font-medium">Actions</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan={8} className="px-3 py-4 text-center text-muted-foreground">Loading…</td></tr>
            ) : subs.length === 0 ? (
              <tr><td colSpan={8} className="px-3 py-4 text-center text-muted-foreground">No subscriptions match the filters.</td></tr>
            ) : subs.map((s) => (
              <tr key={s.id} className="border-t hover:bg-muted/30">
                <td className="px-3 py-2 font-mono text-xs">{s.tenant_id.slice(0, 8)}…</td>
                <td className="px-3 py-2 font-mono text-xs">
                  <div>{s.product_id.slice(0, 8)}…</div>
                  <div className="text-[10px] text-muted-foreground">tier {s.tier_id ? s.tier_id.slice(0, 8) + '…' : '—'}</div>
                </td>
                <td className="px-3 py-2 tabular-nums">v{s.product_version}</td>
                <td className="px-3 py-2"><SubscriptionStatusBadge status={s.status} /></td>
                <td className="px-3 py-2 tabular-nums">{formatMoneyMinor(s.resolved_plan_price_minor, s.resolved_plan_currency)}</td>
                <td className="px-3 py-2 text-xs">{formatShortIso(s.next_renewal_at)}</td>
                <td className="px-3 py-2 text-xs">
                  {[
                    s.grandfathered_at ? 'grandfathered' : null,
                    s.eligible_for_migration ? 'eligible-migration' : null,
                    s.cancel_at_period_end ? 'cancel@period-end' : null,
                    !s.auto_renew ? 'no-auto-renew' : null,
                  ].filter(Boolean).join(' · ') || <span className="text-muted-foreground">—</span>}
                </td>
                <td className="px-3 py-2 text-right">
                  <Link to={`/admin/commercial-pricing/subscriptions/${s.id}`}>
                    <Button size="sm" variant="outline">Open</Button>
                  </Link>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="mt-2 text-xs text-muted-foreground">
        Status legend: {STATUS_OPTIONS.map((s) => SUBSCRIPTION_STATUS_LABELS[s]).join(' · ')}
      </p>
    </div>
  )
}
