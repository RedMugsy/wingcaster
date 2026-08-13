import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { AlertTriangle, ArrowLeft, BarChart3, Building2, Loader2, RefreshCw, Users } from 'lucide-react'
import { api } from '@/api/client'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { PriceHealthIndicator } from '@/components/market-pricing/PriceHealthIndicator'
import { TrendMiniChart } from '@/components/market-pricing/TrendMiniChart'
import { useAuth } from '@/context/AuthContext'
import { usePageTitle } from '@/lib/usePageTitle'
import { useToast } from '@/components/ui/toast'
import type { AgencyPricingPortfolio, PricePosition, PricingTrendSnapshot } from '@/types/marketPricing'

export function AgencyPricingPage() {
  const { agent, loading: authLoading } = useAuth()
  const { addToast } = useToast()
  const [portfolio, setPortfolio] = useState<AgencyPricingPortfolio | null>(null)
  const [loading, setLoading] = useState(true)
  const [agentFilter, setAgentFilter] = useState('')
  const [areaFilter, setAreaFilter] = useState('')
  const [typeFilter, setTypeFilter] = useState('')
  const [healthFilter, setHealthFilter] = useState<'' | PricePosition | 'unavailable'>('')
  const [trendKey, setTrendKey] = useState('')
  const [trends, setTrends] = useState<PricingTrendSnapshot[]>([])
  const [trendsLoading, setTrendsLoading] = useState(false)
  usePageTitle('Agency Price Health')

  const load = useCallback(async () => {
    if (!agent) return
    setLoading(true)
    try {
      setPortfolio(await api.getAgencyPricingPortfolio())
    } catch (err: any) {
      addToast({ title: 'Agency pricing unavailable', description: err.message, variant: 'error' })
    } finally {
      setLoading(false)
    }
  }, [agent, addToast])

  useEffect(() => { load() }, [load])

  const filterOptions = useMemo(() => {
    const listings = portfolio?.listings || []
    const agents = [...new Map(listings.flatMap((row) => row.agent_id
      ? [[row.agent_id, row.agent_name || row.agent_id] as const]
      : [])).entries()]
    const areas = [...new Set(listings.map((row) => row.neighborhood || row.city).filter(Boolean) as string[])].sort()
    const types = [...new Set(listings.map((row) => row.property_type).filter(Boolean) as string[])].sort()
    const trendPairs = [...new Map(listings
      .filter((row) => (row.area_id || row.area_profile_id) && row.property_type)
      .map((row) => {
        const id = row.area_id || row.area_profile_id || ''
        const key = `${id}|${row.property_type}`
        return [key, { key, label: `${row.neighborhood || row.city || id} · ${row.property_type}` }]
      })).values()]
    return { agents, areas, types, trendPairs }
  }, [portfolio])

  const listings = useMemo(() => (portfolio?.listings || []).filter((row) => {
    if (agentFilter && row.agent_id !== agentFilter) return false
    if (areaFilter && (row.neighborhood || row.city) !== areaFilter) return false
    if (typeFilter && row.property_type !== typeFilter) return false
    if (healthFilter === 'unavailable') return !row.pricing_analysis
    if (healthFilter && row.pricing_analysis?.target_vs_median !== healthFilter) return false
    return true
  }), [portfolio, agentFilter, areaFilter, typeFilter, healthFilter])

  useEffect(() => {
    if (!trendKey) { setTrends([]); return }
    const [areaId, propertyType] = trendKey.split('|')
    setTrendsLoading(true)
    api.getPricingTrends(areaId, propertyType)
      .then(setTrends)
      .catch((err: any) => { setTrends([]); addToast({ title: 'Trend data unavailable', description: err.message, variant: 'error' }) })
      .finally(() => setTrendsLoading(false))
  }, [trendKey, addToast])

  if (authLoading || loading) return <div className="flex min-h-[60vh] items-center justify-center"><Loader2 className="h-8 w-8 animate-spin text-primary" /><span className="sr-only">Loading agency pricing</span></div>
  if (!agent) return <div className="mx-auto max-w-md py-16 text-center"><Building2 className="mx-auto h-12 w-12 text-muted-foreground" /><h1 className="mt-4 text-2xl font-bold">Sign in to review agency pricing</h1><Link to="/login?returnTo=%2Fagency%2Fpricing"><Button className="mt-4">Sign in</Button></Link></div>

  const summary = portfolio?.summary
  const coverage = summary?.total_listings ? Math.round((summary.analyzed_listings / summary.total_listings) * 100) : 0

  return (
    <div className="min-h-screen bg-muted/20 px-4 py-8 sm:px-6 lg:px-8">
      <div className="mx-auto max-w-7xl space-y-6">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <Link to="/agency" className="mb-2 inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"><ArrowLeft className="h-4 w-4" />Agency management</Link>
            <h1 className="text-3xl font-bold">Agency Price Health</h1>
            <p className="text-muted-foreground">Portfolio distribution, team drill-down, evidence status, and area trends.</p>
          </div>
          <Button variant="outline" onClick={load} className="gap-2"><RefreshCw className="h-4 w-4" />Refresh</Button>
        </div>

        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
          <Metric label="Coverage" value={`${coverage}%`} />
          <Metric label="Above market" value={summary?.above_market || 0} tone="text-red-600" />
          <Metric label="Within range" value={summary?.at_market || 0} tone="text-green-600" />
          <Metric label="Below market" value={summary?.below_market || 0} tone="text-blue-600" />
          <Metric label="Unavailable" value={summary?.unavailable || 0} tone="text-amber-600" />
        </div>

        {((summary?.stale_rate || 0) > 0 || (summary?.low_confidence || 0) > 0) && (
          <div className="flex gap-3 rounded-lg border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900"><AlertTriangle className="h-5 w-5 shrink-0" /><p>{summary?.stale_rate || 0} stale-rate and {summary?.low_confidence || 0} low-confidence analyses need review before portfolio-wide decisions.</p></div>
        )}

        <div className="grid gap-6 lg:grid-cols-3">
          <Card className="lg:col-span-2">
            <CardHeader><CardTitle>Portfolio distribution</CardTitle><CardDescription>Counts reflect the latest analysis for each active agency listing.</CardDescription></CardHeader>
            <CardContent>
              <div className="grid gap-3 sm:grid-cols-3">
                <DistributionBlock label="Above" count={summary?.above_market || 0} total={summary?.analyzed_listings || 0} color="bg-red-500" />
                <DistributionBlock label="Within" count={summary?.at_market || 0} total={summary?.analyzed_listings || 0} color="bg-green-500" />
                <DistributionBlock label="Below" count={summary?.below_market || 0} total={summary?.analyzed_listings || 0} color="bg-blue-500" />
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardHeader><CardTitle className="flex items-center gap-2"><Users className="h-5 w-5" />Team coverage</CardTitle></CardHeader>
            <CardContent className="space-y-3">
              {portfolio?.agents.map((row) => (
                <button key={row.agent_id} type="button" className="flex w-full items-center justify-between rounded-lg border p-3 text-left hover:bg-muted/40" onClick={() => setAgentFilter(row.agent_id)}>
                  <span className="min-w-0"><span className="block truncate text-sm font-medium">{row.agent_name}</span><span className="text-xs text-muted-foreground">{row.analyzed_listings}/{row.total_listings} analyzed</span></span>
                  {row.above_market > 0 && <Badge variant="destructive">{row.above_market} above</Badge>}
                </button>
              ))}
            </CardContent>
          </Card>
        </div>

        <Card>
          <CardHeader><CardTitle>Portfolio listings</CardTitle><CardDescription>Filter and drill into individual listing evidence. Price changes remain an Agent-owned action.</CardDescription></CardHeader>
          <CardContent>
            <div className="mb-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              <FilterSelect label="Agent" value={agentFilter} onChange={setAgentFilter} options={filterOptions.agents.map(([value, label]) => ({ value, label }))} />
              <FilterSelect label="Area" value={areaFilter} onChange={setAreaFilter} options={filterOptions.areas.map((value) => ({ value, label: value }))} />
              <FilterSelect label="Property type" value={typeFilter} onChange={setTypeFilter} options={filterOptions.types.map((value) => ({ value, label: value.replace(/_/g, ' ') }))} />
              <FilterSelect label="Price health" value={healthFilter} onChange={(value) => setHealthFilter(value as typeof healthFilter)} options={[{ value: 'above', label: 'Above market' }, { value: 'at', label: 'Within range' }, { value: 'below', label: 'Below market' }, { value: 'unavailable', label: 'Unavailable' }]} />
            </div>
            <div className="space-y-3">
              {listings.map((listing) => (
                <div key={listing.id} className="grid gap-3 rounded-lg border p-4 md:grid-cols-[minmax(0,2fr)_minmax(0,1fr)_auto_auto] md:items-center">
                  <div className="min-w-0"><Link to={`/listings/${listing.id}`} className="font-medium hover:underline">{listing.title || listing.id}</Link><p className="truncate text-xs text-muted-foreground">{listing.agent_name || 'Unassigned'} · {[listing.neighborhood, listing.city, listing.property_type].filter(Boolean).join(' · ')}</p></div>
                  <div><p className="text-xs text-muted-foreground">List price</p><p className="font-semibold">{formatMoney(listing.price, listing.currency)}</p></div>
                  <PriceHealthIndicator analysis={listing.pricing_analysis} />
                  <Button asChild size="sm" variant="outline"><Link to={`/listings/${listing.id}`}>Evidence</Link></Button>
                </div>
              ))}
              {listings.length === 0 && <p className="py-8 text-center text-sm text-muted-foreground">No listings match these filters.</p>}
            </div>
          </CardContent>
        </Card>

        <div className="grid gap-6 lg:grid-cols-2">
          <Card>
            <CardHeader><CardTitle>Area trends</CardTitle><CardDescription>Select an explicit area/property type pair from the agency portfolio.</CardDescription></CardHeader>
            <CardContent className="space-y-4">
              <FilterSelect label="Area and property type" value={trendKey} onChange={setTrendKey} options={filterOptions.trendPairs.map((pair) => ({ value: pair.key, label: pair.label }))} />
              {trendsLoading ? <Loader2 className="mx-auto h-6 w-6 animate-spin text-primary" /> : <TrendMiniChart snapshots={trends} />}
            </CardContent>
          </Card>
          <Card>
            <CardHeader><CardTitle>Sold-price evidence pipeline</CardTitle><CardDescription>Agent submissions require verification before entering the estimator.</CardDescription></CardHeader>
            <CardContent className="space-y-3">
              {portfolio?.reports.slice(0, 10).map((report) => (
                <div key={report.id} className="flex items-center justify-between rounded-lg border p-3 text-sm"><div><p className="font-medium">{formatMoney(report.sold_price, report.currency)}</p><p className="text-xs text-muted-foreground">{report.sold_date ? new Date(report.sold_date).toLocaleDateString() : 'Date unavailable'}</p></div><Badge variant={report.status === 'verified' ? 'default' : report.status === 'rejected' ? 'destructive' : 'secondary'}>{report.status}</Badge></div>
              ))}
              {!portfolio?.reports.length && <p className="py-8 text-center text-sm text-muted-foreground">No team reports submitted yet.</p>}
            </CardContent>
          </Card>
        </div>

        <p className="text-xs text-muted-foreground"><BarChart3 className="mr-1 inline h-4 w-4" />Portfolio metrics are based on weighted comparable analysis and are not appraisals, guarantees, or completed-transaction valuations.</p>
      </div>
    </div>
  )
}

function Metric({ label, value, tone = '' }: { label: string; value: string | number; tone?: string }) {
  return <Card><CardContent className="p-5"><p className={`text-2xl font-bold ${tone}`}>{value}</p><p className="text-sm text-muted-foreground">{label}</p></CardContent></Card>
}

function DistributionBlock({ label, count, total, color }: { label: string; count: number; total: number; color: string }) {
  const percent = total ? Math.round((count / total) * 100) : 0
  return <div className="rounded-lg border p-4"><div className="flex justify-between"><span className="font-medium">{label}</span><span>{count}</span></div><div className="mt-3 h-2 overflow-hidden rounded-full bg-muted"><div className={`h-full ${color}`} style={{ width: `${percent}%` }} /></div><p className="mt-1 text-xs text-muted-foreground">{percent}% of analyzed listings</p></div>
}

function FilterSelect({ label, value, onChange, options }: { label: string; value: string; onChange: (value: string) => void; options: { value: string; label: string }[] }) {
  return <label className="text-sm"><span className="mb-1 block font-medium">{label}</span><select className="h-10 w-full rounded-md border bg-background px-3 text-sm" value={value} onChange={(event) => onChange(event.target.value)}><option value="">All</option>{options.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}</select></label>
}

function formatMoney(value?: number | null, currency = 'USD') {
  if (value == null || !Number.isFinite(Number(value))) return 'N/A'
  try { return new Intl.NumberFormat(undefined, { style: 'currency', currency: currency || 'USD', maximumFractionDigits: 0 }).format(Number(value)) } catch { return `${Number(value).toLocaleString()} ${currency}` }
}
