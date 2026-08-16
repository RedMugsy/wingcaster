import { useState } from 'react'
import { api } from '@/api/client'
import { useAuth } from '@/context/AuthContext'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import { SubscriptionStatusBadge } from '@/components/commercial-pricing/SubscriptionStatusBadge'
import {
  formatMoneyMinor,
  formatShortIso,
} from '@/components/commercial-pricing/subscription-helpers'
import type { TenantReconciliation } from '@/types/commercialPricing'

export function ReconciliationLookupPage() {
  const { isAdmin } = useAuth()
  const [tenantId, setTenantId] = useState('')
  const [billingPeriod, setBillingPeriod] = useState('')
  const [data, setData] = useState<TenantReconciliation | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function lookup() {
    if (!tenantId.trim()) { setError('Enter a tenant ID.'); return }
    setLoading(true)
    setError(null)
    try {
      const result = await api.getAdminTenantReconciliation(tenantId.trim(), billingPeriod.trim() || undefined)
      setData(result)
    } catch (err: any) {
      setError(err?.message || 'Lookup failed')
      setData(null)
    } finally {
      setLoading(false)
    }
  }

  if (!isAdmin) {
    return (
      <div className="container mx-auto max-w-2xl px-4 py-8">
        <Card>
          <CardHeader><CardTitle>Platform admin required</CardTitle></CardHeader>
          <CardContent className="text-sm text-muted-foreground">Reconciliation is restricted to platform admins.</CardContent>
        </Card>
      </div>
    )
  }

  return (
    <div className="container mx-auto px-4 py-8">
      <div className="mb-6">
        <h1 className="text-2xl font-bold">Tenant Reconciliation</h1>
        <p className="text-sm text-muted-foreground">
          Cross-ledger snapshot for a single tenant — subscriptions, quota consumption vs allowance,
          pending credit-note balance, lifecycle history counts, and anomaly detection.
        </p>
      </div>

      <Card className="mb-6">
        <CardContent className="flex items-end gap-3 pt-6">
          <div className="flex-1">
            <label className="text-xs text-muted-foreground">Tenant ID</label>
            <Input value={tenantId} onChange={(e) => setTenantId(e.target.value)} placeholder="agent-…" />
          </div>
          <div>
            <label className="text-xs text-muted-foreground">Billing period (optional)</label>
            <Input value={billingPeriod} onChange={(e) => setBillingPeriod(e.target.value)} placeholder="2026-08" className="w-32" />
          </div>
          <Button onClick={lookup} disabled={loading}>{loading ? 'Loading…' : 'Lookup'}</Button>
        </CardContent>
      </Card>

      {error ? <p className="mb-3 text-sm text-red-600">{error}</p> : null}

      {data ? (
        <div className="space-y-4">
          {data.anomalies.length > 0 ? (
            <Card>
              <CardHeader className="pb-2"><CardTitle className="text-sm">Anomalies ({data.anomalies.length})</CardTitle></CardHeader>
              <CardContent className="space-y-2">
                {data.anomalies.map((a, idx) => (
                  <div key={idx} className={
                    'rounded-md border px-3 py-2 text-sm ' +
                    (a.severity === 'high' ? 'border-rose-200 bg-rose-50 text-rose-900'
                      : a.severity === 'medium' ? 'border-amber-200 bg-amber-50 text-amber-900'
                      : 'border-slate-200 bg-slate-50 text-slate-800')
                  }>
                    <div className="flex items-center gap-2">
                      <Badge variant="outline" className="uppercase text-[10px]">{a.severity}</Badge>
                      <span className="font-mono text-xs">{a.kind}</span>
                    </div>
                    <div className="mt-1 text-xs">{a.detail}</div>
                  </div>
                ))}
              </CardContent>
            </Card>
          ) : null}

          <Card>
            <CardHeader className="pb-2"><CardTitle className="text-sm">Subscriptions ({data.subscriptions.length})</CardTitle></CardHeader>
            <CardContent className="p-0">
              {data.subscriptions.length === 0 ? (
                <p className="p-4 text-sm text-muted-foreground">No subscriptions for this tenant.</p>
              ) : (
                <table className="w-full text-sm">
                  <thead className="bg-muted/40 text-left">
                    <tr>
                      <th className="px-3 py-2 font-medium">Product / tier</th>
                      <th className="px-3 py-2 font-medium">Status</th>
                      <th className="px-3 py-2 font-medium">Price</th>
                      <th className="px-3 py-2 font-medium">Period</th>
                      <th className="px-3 py-2 font-medium">Next renewal</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.subscriptions.map((s) => (
                      <tr key={s.id} className="border-t">
                        <td className="px-3 py-2 text-xs">
                          {s.product_code} v{s.product_version}
                          <span className="ml-2 text-muted-foreground">· {s.tier_name || '—'}</span>
                        </td>
                        <td className="px-3 py-2"><SubscriptionStatusBadge status={s.status} /></td>
                        <td className="px-3 py-2 tabular-nums">{formatMoneyMinor(s.resolved_plan_price_minor, s.resolved_plan_currency)}</td>
                        <td className="px-3 py-2 text-xs">{formatShortIso(s.billing_period_start)} → {formatShortIso(s.billing_period_end)}</td>
                        <td className="px-3 py-2 text-xs">{formatShortIso(s.next_renewal_at)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-2"><CardTitle className="text-sm">Quota ledger (period {data.billing_period})</CardTitle></CardHeader>
            <CardContent className="p-0">
              {data.quota_ledger.length === 0 ? (
                <p className="p-4 text-sm text-muted-foreground">No ledger activity in this period.</p>
              ) : (
                <table className="w-full text-sm">
                  <thead className="bg-muted/40 text-left">
                    <tr>
                      <th className="px-3 py-2 font-medium">Quota</th>
                      <th className="px-3 py-2 text-right font-medium">Granted</th>
                      <th className="px-3 py-2 text-right font-medium">Top-up</th>
                      <th className="px-3 py-2 text-right font-medium">Consumed</th>
                      <th className="px-3 py-2 text-right font-medium">Overage</th>
                      <th className="px-3 py-2 text-right font-medium">Adjust</th>
                      <th className="px-3 py-2 text-right font-medium">Balance</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.quota_ledger.map((q) => (
                      <tr key={q.quota_key} className="border-t">
                        <td className="px-3 py-2 font-mono text-xs">{q.quota_key}</td>
                        <td className="px-3 py-2 text-right tabular-nums">{q.allowance_grant}</td>
                        <td className="px-3 py-2 text-right tabular-nums">{q.topup}</td>
                        <td className="px-3 py-2 text-right tabular-nums text-rose-700">{q.consumption}</td>
                        <td className="px-3 py-2 text-right tabular-nums text-amber-700">{q.overage}</td>
                        <td className="px-3 py-2 text-right tabular-nums">{q.adjustment}</td>
                        <td className={
                          'px-3 py-2 text-right tabular-nums font-medium ' +
                          (q.balance < 0 ? 'text-rose-700' : '')
                        }>{q.balance}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </CardContent>
          </Card>

          <div className="grid gap-3 lg:grid-cols-2">
            <Card>
              <CardHeader className="pb-2"><CardTitle className="text-sm">Pending credit balance</CardTitle></CardHeader>
              <CardContent>
                {Object.keys(data.credit_notes.pending_by_currency).length === 0 ? (
                  <p className="text-sm text-muted-foreground">No pending credit notes.</p>
                ) : (
                  <ul className="space-y-1">
                    {Object.entries(data.credit_notes.pending_by_currency).map(([cur, bal]) => (
                      <li key={cur} className="flex items-center justify-between text-sm">
                        <span className="font-medium">{cur}</span>
                        <span className={
                          'font-mono tabular-nums ' +
                          (bal > 0 ? 'text-emerald-700' : bal < 0 ? 'text-rose-700' : 'text-muted-foreground')
                        }>
                          {bal > 0 ? '+' : ''}{(bal / 100).toFixed(2)}
                        </span>
                      </li>
                    ))}
                  </ul>
                )}
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="pb-2"><CardTitle className="text-sm">Lifetime history counts</CardTitle></CardHeader>
              <CardContent>
                {data.history_counts.length === 0 ? (
                  <p className="text-sm text-muted-foreground">No history events.</p>
                ) : (
                  <ul className="space-y-1 text-sm">
                    {data.history_counts.map((h) => (
                      <li key={h.event} className="flex items-center justify-between">
                        <span className="capitalize">{h.event.replace(/_/g, ' ')}</span>
                        <span className="tabular-nums">{h.count}</span>
                      </li>
                    ))}
                  </ul>
                )}
              </CardContent>
            </Card>
          </div>
        </div>
      ) : null}
    </div>
  )
}
