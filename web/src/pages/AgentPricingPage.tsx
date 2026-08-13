import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { AlertTriangle, ArrowLeft, BarChart3, Check, DollarSign, FileCheck2, Loader2, RefreshCw, Save } from 'lucide-react'
import { api } from '@/api/client'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { PriceHealthIndicator } from '@/components/market-pricing/PriceHealthIndicator'
import { useAuth } from '@/context/AuthContext'
import { usePageTitle } from '@/lib/usePageTitle'
import { useToast } from '@/components/ui/toast'
import type { AgentPricingPortfolio, PricePosition, PricingPortfolioListing } from '@/types/marketPricing'

const EMPTY_REPORT = {
  property_id: '',
  sold_price: '',
  currency: 'USD',
  sold_date: '',
  notes: '',
}

export function AgentPricingPage() {
  const { agent, loading: authLoading } = useAuth()
  const { addToast } = useToast()
  const [portfolio, setPortfolio] = useState<AgentPricingPortfolio | null>(null)
  const [loading, setLoading] = useState(true)
  const [filter, setFilter] = useState<'all' | PricePosition | 'unavailable'>('all')
  const [adjusting, setAdjusting] = useState<PricingPortfolioListing | null>(null)
  const [newPrice, setNewPrice] = useState('')
  const [reason, setReason] = useState('')
  const [saving, setSaving] = useState(false)
  const [report, setReport] = useState(EMPTY_REPORT)
  const [reporting, setReporting] = useState(false)
  usePageTitle('Price Health')

  const load = useCallback(async () => {
    if (!agent) return
    setLoading(true)
    try {
      setPortfolio(await api.getAgentPricingPortfolio())
    } catch (err: any) {
      addToast({ title: 'Pricing portfolio unavailable', description: err.message, variant: 'error' })
    } finally {
      setLoading(false)
    }
  }, [agent, addToast])

  useEffect(() => { load() }, [load])

  const listings = useMemo(() => {
    const rows = portfolio?.listings || []
    if (filter === 'all') return rows
    if (filter === 'unavailable') return rows.filter((row) => !row.pricing_analysis)
    return rows.filter((row) => row.pricing_analysis?.target_vs_median === filter)
  }, [portfolio, filter])

  async function keepPrice(listing: PricingPortfolioListing) {
    try {
      await api.keepAgentListingPrice(listing.id, 'Reviewed against current REB Price Index')
      addToast({ title: 'Price decision recorded', description: 'The current price was kept and added to the audit history.', variant: 'success' })
      await load()
    } catch (err: any) {
      addToast({ title: 'Could not record decision', description: err.message, variant: 'error' })
    }
  }

  async function adjustPrice() {
    if (!adjusting) return
    const value = Number(newPrice)
    if (!Number.isFinite(value) || value <= 0) {
      addToast({ title: 'Enter a valid positive price', variant: 'error' })
      return
    }
    setSaving(true)
    try {
      await api.adjustAgentListingPrice(adjusting.id, value, reason)
      addToast({ title: 'Listing price updated', description: 'The change was audited and nearby analyses were queued for refresh.', variant: 'success' })
      setAdjusting(null)
      setNewPrice('')
      setReason('')
      await load()
    } catch (err: any) {
      addToast({ title: 'Price update failed', description: err.message, variant: 'error' })
    } finally {
      setSaving(false)
    }
  }

  async function submitReport(event: React.FormEvent) {
    event.preventDefault()
    const soldPrice = Number(report.sold_price)
    if (!report.property_id || !Number.isFinite(soldPrice) || soldPrice <= 0 || !report.sold_date) return
    setReporting(true)
    try {
      await api.submitAgentPriceReport({ ...report, sold_price: soldPrice })
      setReport(EMPTY_REPORT)
      addToast({ title: 'Sold-price report submitted', description: 'Platform review is required before it becomes valuation evidence.', variant: 'success' })
      await load()
    } catch (err: any) {
      addToast({ title: 'Report submission failed', description: err.message, variant: 'error' })
    } finally {
      setReporting(false)
    }
  }

  if (authLoading || loading) return <LoadingState />
  if (!agent) return <SignInState />

  const summary = portfolio?.summary
  return (
    <div className="min-h-screen bg-muted/20 px-4 py-8 sm:px-6 lg:px-8">
      <div className="mx-auto max-w-7xl space-y-6">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <Link to="/dashboard" className="mb-2 inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"><ArrowLeft className="h-4 w-4" />Dashboard</Link>
            <h1 className="text-3xl font-bold">Price Health</h1>
            <p className="text-muted-foreground">Review listing position, document pricing decisions, and contribute verified transaction evidence.</p>
          </div>
          <Button variant="outline" onClick={load} className="gap-2"><RefreshCw className="h-4 w-4" />Refresh</Button>
        </div>

        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <SummaryCard label="Listings analyzed" value={`${summary?.analyzed_listings || 0}/${summary?.total_listings || 0}`} />
          <SummaryCard label="Above market" value={summary?.above_market || 0} tone="text-red-600" />
          <SummaryCard label="Within range" value={summary?.at_market || 0} tone="text-green-600" />
          <SummaryCard label="Needs attention" value={(summary?.low_confidence || 0) + (summary?.stale_rate || 0) + (summary?.unavailable || 0)} tone="text-amber-600" />
        </div>

        {(summary?.stale_rate || 0) > 0 && (
          <div className="flex gap-3 rounded-lg border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
            <AlertTriangle className="h-5 w-5 shrink-0" />
            <p>{summary?.stale_rate} analysis result(s) use an exchange rate older than 24 hours. Review rate provenance before changing a listing.</p>
          </div>
        )}

        <Card>
          <CardHeader>
            <CardTitle>Listing price health</CardTitle>
            <CardDescription>The index is decision support, not a formal appraisal. Keep and Adjust actions are recorded for accountability.</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="mb-4 flex flex-wrap gap-2" aria-label="Filter listings by price position">
              {(['all', 'above', 'at', 'below', 'unavailable'] as const).map((value) => (
                <Button key={value} size="sm" variant={filter === value ? 'default' : 'outline'} onClick={() => setFilter(value)}>
                  {value === 'all' ? 'All' : value === 'at' ? 'Within range' : value.charAt(0).toUpperCase() + value.slice(1)}
                </Button>
              ))}
            </div>
            <div className="space-y-3">
              {listings.map((listing) => (
                <div key={listing.id} className="flex flex-col gap-4 rounded-lg border p-4 lg:flex-row lg:items-center">
                  <div className="min-w-0 flex-1">
                    <Link to={`/listings/${listing.id}`} className="font-medium hover:underline">{listing.title || listing.id}</Link>
                    <p className="text-sm text-muted-foreground">{[listing.neighborhood, listing.city, listing.property_type].filter(Boolean).join(' · ') || 'Location unavailable'}</p>
                  </div>
                  <div className="w-36">
                    <p className="text-xs text-muted-foreground">Current price</p>
                    <p className="font-semibold">{formatMoney(listing.price, listing.currency)}</p>
                  </div>
                  <div className="w-40">
                    <PriceHealthIndicator analysis={listing.pricing_analysis} />
                    {listing.pricing_analysis && <p className="mt-1 text-xs text-muted-foreground">{listing.pricing_analysis.confidence} confidence</p>}
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <Button size="sm" variant="outline" onClick={() => keepPrice(listing)} disabled={!listing.pricing_analysis}><Check className="mr-1 h-4 w-4" />Keep price</Button>
                    <Button size="sm" onClick={() => { setAdjusting(listing); setNewPrice(String(listing.price || '')); setReason('') }}><DollarSign className="mr-1 h-4 w-4" />Adjust</Button>
                  </div>
                </div>
              ))}
              {listings.length === 0 && <p className="py-8 text-center text-sm text-muted-foreground">No listings match this filter.</p>}
            </div>
          </CardContent>
        </Card>

        <div className="grid gap-6 lg:grid-cols-2">
          <Card>
            <CardHeader><CardTitle>Report a completed sale</CardTitle><CardDescription>Reports remain pending until Platform Admin verification.</CardDescription></CardHeader>
            <CardContent>
              <form className="space-y-4" onSubmit={submitReport}>
                <div><Label htmlFor="report-property">Listing</Label><select id="report-property" className="h-10 w-full rounded-md border bg-background px-3 text-sm" value={report.property_id} onChange={(e) => setReport({ ...report, property_id: e.target.value })} required><option value="">Select listing</option>{portfolio?.listings.map((listing) => <option key={listing.id} value={listing.id}>{listing.title || listing.id}</option>)}</select></div>
                <div className="grid gap-4 sm:grid-cols-2">
                  <div><Label htmlFor="sold-price">Sold price</Label><Input id="sold-price" type="number" min="1" value={report.sold_price} onChange={(e) => setReport({ ...report, sold_price: e.target.value })} required /></div>
                  <div><Label htmlFor="sold-currency">Currency</Label><select id="sold-currency" className="h-10 w-full rounded-md border bg-background px-3 text-sm" value={report.currency} onChange={(e) => setReport({ ...report, currency: e.target.value })}><option>USD</option><option>LBP</option></select></div>
                </div>
                <div><Label htmlFor="sold-date">Completion date</Label><Input id="sold-date" type="date" max={new Date().toISOString().slice(0, 10)} value={report.sold_date} onChange={(e) => setReport({ ...report, sold_date: e.target.value })} required /></div>
                <div><Label htmlFor="report-notes">Evidence notes</Label><Input id="report-notes" value={report.notes} onChange={(e) => setReport({ ...report, notes: e.target.value })} placeholder="Contract reference or verification context" /></div>
                <Button type="submit" disabled={reporting} className="gap-2">{reporting ? <Loader2 className="h-4 w-4 animate-spin" /> : <FileCheck2 className="h-4 w-4" />}Submit for review</Button>
              </form>
            </CardContent>
          </Card>

          <Card>
            <CardHeader><CardTitle>Evidence status</CardTitle><CardDescription>Your recent sold-price submissions and their review state.</CardDescription></CardHeader>
            <CardContent className="space-y-3">
              {portfolio?.reports.slice(0, 10).map((item) => (
                <div key={item.id} className="flex items-center justify-between gap-3 rounded-lg border p-3 text-sm">
                  <div><p className="font-medium">{formatMoney(item.sold_price, item.currency)}</p><p className="text-xs text-muted-foreground">{item.sold_date ? new Date(item.sold_date).toLocaleDateString() : 'Date unavailable'}</p></div>
                  <Badge variant={item.status === 'verified' ? 'default' : item.status === 'rejected' ? 'destructive' : 'secondary'}>{item.status}</Badge>
                </div>
              ))}
              {!portfolio?.reports.length && <p className="py-8 text-center text-sm text-muted-foreground">No reports submitted yet.</p>}
            </CardContent>
          </Card>
        </div>

        {adjusting && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4" role="dialog" aria-modal="true" aria-labelledby="adjust-price-title">
            <Card className="w-full max-w-md">
              <CardHeader><CardTitle id="adjust-price-title">Adjust listing price</CardTitle><CardDescription>{adjusting.title || adjusting.id} · Current {formatMoney(adjusting.price, adjusting.currency)}</CardDescription></CardHeader>
              <CardContent className="space-y-4">
                <div><Label htmlFor="new-price">New price</Label><Input id="new-price" type="number" min="1" value={newPrice} onChange={(e) => setNewPrice(e.target.value)} autoFocus /></div>
                <div><Label htmlFor="price-reason">Reason</Label><Input id="price-reason" value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Market review, seller instruction, or campaign change" /></div>
                <p className="text-xs text-muted-foreground">Saving updates the public listing, records the old and new price, and queues affected market analyses for recalculation.</p>
                <div className="flex justify-end gap-2"><Button variant="outline" onClick={() => setAdjusting(null)} disabled={saving}>Cancel</Button><Button onClick={adjustPrice} disabled={saving} className="gap-2">{saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}Save price</Button></div>
              </CardContent>
            </Card>
          </div>
        )}
      </div>
    </div>
  )
}

function SummaryCard({ label, value, tone = '' }: { label: string; value: string | number; tone?: string }) {
  return <Card><CardContent className="p-5"><p className={`text-2xl font-bold ${tone}`}>{value}</p><p className="text-sm text-muted-foreground">{label}</p></CardContent></Card>
}

function LoadingState() {
  return <div className="flex min-h-[60vh] items-center justify-center"><Loader2 className="h-8 w-8 animate-spin text-primary" /><span className="sr-only">Loading pricing portfolio</span></div>
}

function SignInState() {
  return <div className="mx-auto max-w-md py-16 text-center"><BarChart3 className="mx-auto h-12 w-12 text-muted-foreground" /><h1 className="mt-4 text-2xl font-bold">Sign in to review Price Health</h1><Link to="/login?returnTo=%2Fagent%2Fpricing"><Button className="mt-4">Sign in</Button></Link></div>
}

function formatMoney(value?: number | null, currency = 'USD') {
  if (value == null || !Number.isFinite(Number(value))) return 'N/A'
  try { return new Intl.NumberFormat(undefined, { style: 'currency', currency: currency || 'USD', maximumFractionDigits: 0 }).format(Number(value)) } catch { return `${Number(value).toLocaleString()} ${currency}` }
}
