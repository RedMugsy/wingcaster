import { useEffect, useState } from 'react'
import { api } from '@/api/client'
import { useAuth } from '@/context/AuthContext'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { formatMoneyMinor } from '@/components/commercial-pricing/subscription-helpers'
import type {
  ChurnReport,
  CreditExposureRow,
  MrrReport,
  TerritoryMrrReport,
  TierSubscribersRow,
} from '@/types/commercialPricing'

export function ReportsAdminPage() {
  const { isAdmin } = useAuth()
  const [mrr, setMrr] = useState<MrrReport | null>(null)
  const [territoryMrr, setTerritoryMrr] = useState<TerritoryMrrReport | null>(null)
  const [churn, setChurn] = useState<ChurnReport | null>(null)
  const [tiers, setTiers] = useState<TierSubscribersRow[]>([])
  const [exposure, setExposure] = useState<CreditExposureRow[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [windowDays, setWindowDays] = useState(30)

  useEffect(() => { if (isAdmin) void load() }, [isAdmin, windowDays])

  async function load() {
    setLoading(true)
    setError(null)
    try {
      const [mrrRes, terRes, churnRes, tierRes, expRes] = await Promise.all([
        api.getAdminMrrReport(),
        api.getAdminMrrByTerritory(),
        api.getAdminChurnReport(windowDays),
        api.getAdminSubscribersByTier(),
        api.getAdminCreditExposure(),
      ])
      setMrr(mrrRes)
      setTerritoryMrr(terRes)
      setChurn(churnRes)
      setTiers(tierRes.rows)
      setExposure(expRes.rows)
    } catch (err: any) {
      setError(err?.message || 'Failed to load reports')
    } finally {
      setLoading(false)
    }
  }

  if (!isAdmin) {
    return (
      <div className="container mx-auto max-w-2xl px-4 py-8">
        <Card>
          <CardHeader><CardTitle>Platform admin required</CardTitle></CardHeader>
          <CardContent className="text-sm text-muted-foreground">Reports are restricted to platform admins.</CardContent>
        </Card>
      </div>
    )
  }

  return (
    <div className="container mx-auto px-4 py-8">
      <div className="mb-6 flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold">Billing Reports</h1>
          <p className="text-sm text-muted-foreground">
            Live from the ledger — no cached snapshots. Numbers reflect the DB right now.
          </p>
        </div>
        <div className="flex gap-2">
          <a href={api.adminCsvExportUrl('subscriptions')} target="_blank" rel="noreferrer">
            <Button size="sm" variant="outline">Export subscriptions.csv</Button>
          </a>
          <a href={api.adminCsvExportUrl('credit-notes')} target="_blank" rel="noreferrer">
            <Button size="sm" variant="outline">Export credit-notes.csv</Button>
          </a>
          <a href={api.adminCsvExportUrl('subscription-history')} target="_blank" rel="noreferrer">
            <Button size="sm" variant="outline">Export history.csv</Button>
          </a>
        </div>
      </div>

      {error ? <p className="mb-3 text-sm text-red-600">{error}</p> : null}
      {loading ? <p className="text-sm text-muted-foreground">Loading…</p> : null}

      {mrr ? (
        <div className="mb-6">
          <h2 className="mb-3 text-lg font-semibold">Recurring revenue</h2>
          <div className="grid gap-3 lg:grid-cols-3">
            {mrr.by_currency.map((b) => (
              <Card key={b.currency}>
                <CardHeader className="pb-2"><CardTitle className="text-sm">{b.currency}</CardTitle></CardHeader>
                <CardContent className="space-y-2 text-sm">
                  <Stat label="Active MRR" value={formatMoneyMinor(b.active_mrr_minor, b.currency)} bold />
                  <Stat label="ARR (active × 12)" value={formatMoneyMinor(b.arr_minor, b.currency)} />
                  <Stat label="Trialing MRR" value={formatMoneyMinor(b.trialing_mrr_minor, b.currency)} muted />
                  <Stat label="Past-due MRR" value={formatMoneyMinor(b.past_due_mrr_minor, b.currency)} muted />
                  <Stat label="Paused MRR" value={formatMoneyMinor(b.paused_mrr_minor, b.currency)} muted />
                  <Stat label="Committed MRR" value={formatMoneyMinor(b.total_committed_mrr_minor, b.currency)} />
                  <Stat label="Subscribers" value={String(b.subscribers)} />
                </CardContent>
              </Card>
            ))}
            {mrr.by_currency.length === 0 ? (
              <Card className="lg:col-span-3">
                <CardContent className="py-6 text-center text-sm text-muted-foreground">
                  No live subscriptions yet — MRR will appear here as tenants subscribe.
                </CardContent>
              </Card>
            ) : null}
          </div>
        </div>
      ) : null}

      {churn ? (
        <div className="mb-6">
          <div className="mb-3 flex items-center justify-between">
            <h2 className="text-lg font-semibold">Churn</h2>
            <select
              className="h-8 rounded-md border bg-background px-2 text-sm"
              value={windowDays}
              onChange={(e) => setWindowDays(Number(e.target.value))}
            >
              <option value={7}>7 days</option>
              <option value={30}>30 days</option>
              <option value={90}>90 days</option>
              <option value={365}>365 days</option>
            </select>
          </div>
          <Card>
            <CardContent className="grid grid-cols-3 gap-4 pt-6 text-sm">
              <Stat label="Opening subscribers" value={String(churn.opening_subscribers)} />
              <Stat label={`Churned in last ${churn.window_days}d`} value={String(churn.churned)} />
              <Stat label="Churn rate" value={`${(churn.churn_rate * 100).toFixed(2)}%`} bold />
            </CardContent>
          </Card>
        </div>
      ) : null}

      {territoryMrr && territoryMrr.by_territory.length > 0 ? (
        <div className="mb-6">
          <h2 className="mb-3 text-lg font-semibold">MRR by territory</h2>
          <Card>
            <CardContent className="p-0">
              <table className="w-full text-sm">
                <thead className="bg-muted/40 text-left">
                  <tr>
                    <th className="px-3 py-2 font-medium">Territory</th>
                    <th className="px-3 py-2 font-medium">Currency</th>
                    <th className="px-3 py-2 text-right font-medium">Active MRR</th>
                    <th className="px-3 py-2 text-right font-medium">Subscribers</th>
                  </tr>
                </thead>
                <tbody>
                  {territoryMrr.by_territory.map((r) => (
                    <tr key={`${r.territory_code}|${r.currency}`} className="border-t">
                      <td className="px-3 py-2">
                        <span className="font-mono text-xs">{r.territory_code}</span>
                        <span className="ml-2 text-muted-foreground text-xs">{r.territory_name}</span>
                      </td>
                      <td className="px-3 py-2 text-xs">{r.currency}</td>
                      <td className="px-3 py-2 text-right tabular-nums">{formatMoneyMinor(r.active_mrr_minor, r.currency)}</td>
                      <td className="px-3 py-2 text-right tabular-nums">{r.subscribers}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </CardContent>
          </Card>
        </div>
      ) : null}

      {tiers.length > 0 ? (
        <div className="mb-6">
          <h2 className="mb-3 text-lg font-semibold">Subscribers by status × tier</h2>
          <Card>
            <CardContent className="p-0">
              <table className="w-full text-sm">
                <thead className="bg-muted/40 text-left">
                  <tr>
                    <th className="px-3 py-2 font-medium">Status</th>
                    <th className="px-3 py-2 font-medium">Product</th>
                    <th className="px-3 py-2 font-medium">Tier</th>
                    <th className="px-3 py-2 text-right font-medium">Subscribers</th>
                    <th className="px-3 py-2 text-right font-medium">Total plan value</th>
                  </tr>
                </thead>
                <tbody>
                  {tiers.map((r, idx) => (
                    <tr key={`${r.status}|${r.product_code}|${r.tier_code}|${idx}`} className="border-t">
                      <td className="px-3 py-2 capitalize">{r.status.replace('_', ' ')}</td>
                      <td className="px-3 py-2 font-mono text-xs">{r.product_code} v{r.product_version}</td>
                      <td className="px-3 py-2">{r.tier_name} <span className="text-muted-foreground text-xs">({r.tier_code})</span></td>
                      <td className="px-3 py-2 text-right tabular-nums">{r.subscribers}</td>
                      <td className="px-3 py-2 text-right tabular-nums">{formatMoneyMinor(r.total_price_minor, r.currency)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </CardContent>
          </Card>
        </div>
      ) : null}

      {exposure.length > 0 ? (
        <div className="mb-6">
          <h2 className="mb-3 text-lg font-semibold">Pending credit-note exposure</h2>
          <Card>
            <CardContent className="p-0">
              <table className="w-full text-sm">
                <thead className="bg-muted/40 text-left">
                  <tr>
                    <th className="px-3 py-2 font-medium">Currency</th>
                    <th className="px-3 py-2 text-right font-medium">Credits owed to tenants</th>
                    <th className="px-3 py-2 text-right font-medium">Debits owed by tenants</th>
                    <th className="px-3 py-2 text-right font-medium">Net liability</th>
                    <th className="px-3 py-2 text-right font-medium">Pending count</th>
                  </tr>
                </thead>
                <tbody>
                  {exposure.map((r) => (
                    <tr key={r.currency} className="border-t">
                      <td className="px-3 py-2 text-xs">{r.currency}</td>
                      <td className="px-3 py-2 text-right tabular-nums text-emerald-700">{formatMoneyMinor(r.credit_owed_minor, r.currency)}</td>
                      <td className="px-3 py-2 text-right tabular-nums text-rose-700">{formatMoneyMinor(r.debit_owed_minor, r.currency)}</td>
                      <td className={
                        'px-3 py-2 text-right tabular-nums font-medium ' +
                        (r.net_liability_minor > 0 ? 'text-emerald-700' : r.net_liability_minor < 0 ? 'text-rose-700' : 'text-muted-foreground')
                      }>{formatMoneyMinor(r.net_liability_minor, r.currency)}</td>
                      <td className="px-3 py-2 text-right tabular-nums">{r.pending_count}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </CardContent>
          </Card>
        </div>
      ) : null}
    </div>
  )
}

function Stat({ label, value, bold, muted }: { label: string; value: string; bold?: boolean; muted?: boolean }) {
  return (
    <div>
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className={
        bold ? 'text-lg font-bold tabular-nums'
          : muted ? 'text-muted-foreground tabular-nums'
          : 'font-medium tabular-nums'
      }>{value}</div>
    </div>
  )
}
