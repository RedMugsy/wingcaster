import { useEffect, useMemo, useState } from 'react'
import { Check, Loader2, TrendingUp, X } from 'lucide-react'
import { api, type ClosedTransaction } from '@/api/client'
import { useToast } from '@/components/ui/toast'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Badge } from '@/components/ui/badge'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'

interface Props {
  listingId: string
  listingTitle?: string
  originalListedPrice?: number | null
  currency?: string
  contactId?: string | null
  opportunityId?: string | null
  transactionType?: 'sale' | 'rent' | 'lease'
  onClose: () => void
  onSaved?: (row: ClosedTransaction) => void
}

/**
 * Universal Deal Closure Form.
 *
 * Two entry points auto-open this modal:
 *   1. Opportunity moves to closed_won (server signals via
 *      closure_prompt on the PATCH response — see OpportunitiesPage
 *      when it lands, or ListingProfile if the deal was recorded here)
 *   2. Listing status flips to archived from the StatusSetter on the
 *      Listing Profile
 *
 * Agent can Skip — the row will never be created if they close without
 * saving. Every field is optional except closed_at + final_sold_price.
 */
export function RecordClosureModal({
  listingId,
  listingTitle,
  originalListedPrice,
  currency = 'USD',
  contactId,
  opportunityId,
  transactionType = 'sale',
  onClose,
  onSaved,
}: Props) {
  const { addToast } = useToast()
  const [config, setConfig] = useState<Awaited<ReturnType<typeof api.getClosedTransactionsConfig>> | null>(null)
  const [tab, setTab] = useState('pricing')
  const [busy, setBusy] = useState(false)

  const [form, setForm] = useState({
    transaction_type: transactionType as 'sale' | 'rent' | 'lease',
    original_listed_price: originalListedPrice != null ? String(originalListedPrice) : '',
    final_sold_price: '',
    currency,
    price_reductions_count: '',
    listed_at: '',
    closed_at: new Date().toISOString().slice(0, 10),
    days_on_market: '',
    days_to_first_offer: '',
    offers_received_count: '',
    viewings_conducted: '',
    rejected_offer_max: '',
    rejected_offer_min: '',
    buyer_type: 'unknown',
    buyer_nationality: '',
    payment_method: 'unknown',
    down_payment_percent: '',
    mortgage_provider: '',
    close_reason: 'other',
    agent_notes: '',
    attribution_source: 'other',
  })

  useEffect(() => {
    api.getClosedTransactionsConfig()
      .then(setConfig)
      .catch(() => setConfig(null))
  }, [])

  // Derive days_on_market when listed_at + closed_at both provided.
  useEffect(() => {
    if (!form.listed_at || !form.closed_at) return
    const listed = new Date(form.listed_at).getTime()
    const closed = new Date(form.closed_at).getTime()
    if (!Number.isFinite(listed) || !Number.isFinite(closed) || closed < listed) return
    const days = Math.max(0, Math.round((closed - listed) / (24 * 3600 * 1000)))
    setForm((prev) => (prev.days_on_market ? prev : { ...prev, days_on_market: String(days) }))
  }, [form.listed_at, form.closed_at])

  const negotiationDelta = useMemo(() => {
    const orig = Number(form.original_listed_price)
    const sold = Number(form.final_sold_price)
    if (!Number.isFinite(orig) || !Number.isFinite(sold) || orig <= 0) return null
    const pct = ((sold - orig) / orig) * 100
    return { pct, up: pct >= 0 }
  }, [form.original_listed_price, form.final_sold_price])

  function setField<K extends keyof typeof form>(k: K, v: (typeof form)[K]) {
    setForm((prev) => ({ ...prev, [k]: v }))
  }

  async function save() {
    if (busy) return
    setBusy(true)
    try {
      const row = await api.recordClosedTransaction({
        listing_id: listingId,
        contact_id: contactId,
        opportunity_id: opportunityId,
        transaction_type: form.transaction_type,
        original_listed_price: form.original_listed_price ? Number(form.original_listed_price) : null,
        final_sold_price: form.final_sold_price ? Number(form.final_sold_price) : null,
        currency: form.currency,
        price_reductions_count: form.price_reductions_count ? Number(form.price_reductions_count) : null,
        listed_at: form.listed_at || null,
        closed_at: form.closed_at || new Date().toISOString().slice(0, 10),
        days_on_market: form.days_on_market ? Number(form.days_on_market) : null,
        days_to_first_offer: form.days_to_first_offer ? Number(form.days_to_first_offer) : null,
        offers_received_count: form.offers_received_count ? Number(form.offers_received_count) : null,
        viewings_conducted: form.viewings_conducted ? Number(form.viewings_conducted) : null,
        rejected_offer_max: form.rejected_offer_max ? Number(form.rejected_offer_max) : null,
        rejected_offer_min: form.rejected_offer_min ? Number(form.rejected_offer_min) : null,
        buyer_type: form.buyer_type,
        buyer_nationality: form.buyer_nationality || null,
        payment_method: form.payment_method,
        down_payment_percent: form.down_payment_percent ? Number(form.down_payment_percent) : null,
        mortgage_provider: form.mortgage_provider || null,
        close_reason: form.close_reason,
        agent_notes: form.agent_notes,
        attribution_source: form.attribution_source,
        origin: 'agent_form',
      })
      addToast({ title: 'Closed transaction recorded', variant: 'success' })
      onSaved?.(row)
      onClose()
    } catch (err: any) {
      addToast({ title: 'Save failed', description: err?.message, variant: 'error' })
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div className="flex max-h-[92vh] w-full max-w-3xl flex-col rounded-lg bg-white shadow-xl">
        <div className="flex items-start justify-between border-b p-4">
          <div>
            <div className="flex items-center gap-2">
              <TrendingUp className="h-5 w-5 text-emerald-600" />
              <h2 className="text-lg font-semibold">Record closed transaction</h2>
            </div>
            <p className="mt-0.5 text-xs text-muted-foreground">
              {listingTitle ? <>For <span className="font-medium">{listingTitle}</span>. </> : null}
              Optional but valuable — this is the training data behind future market intelligence.
              Skip if you don't have the details right now; you can add them later from Settings → Historical Transactions.
            </p>
          </div>
          <button type="button" onClick={onClose} className="rounded-full p-1 hover:bg-muted">
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-4">
          <Tabs value={tab} onValueChange={setTab}>
            <TabsList className="flex flex-wrap">
              <TabsTrigger value="pricing">Pricing</TabsTrigger>
              <TabsTrigger value="timing">Timing</TabsTrigger>
              <TabsTrigger value="demand">Demand</TabsTrigger>
              <TabsTrigger value="buyer">Buyer</TabsTrigger>
              <TabsTrigger value="context">Context</TabsTrigger>
            </TabsList>

            <TabsContent value="pricing" className="mt-3 space-y-3">
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                <label className="block">
                  <Label className="text-xs">Transaction type</Label>
                  <select
                    className="mt-1 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                    value={form.transaction_type}
                    onChange={(e) => setField('transaction_type', e.target.value as any)}
                  >
                    <option value="sale">Sale</option>
                    <option value="rent">Rent</option>
                    <option value="lease">Lease</option>
                  </select>
                </label>
                <label className="block sm:col-span-2">
                  <Label className="text-xs">Currency</Label>
                  <Input value={form.currency} onChange={(e) => setField('currency', e.target.value)} maxLength={5} />
                </label>
              </div>
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <label className="block">
                  <Label className="text-xs">Original listed price</Label>
                  <Input type="number" value={form.original_listed_price} onChange={(e) => setField('original_listed_price', e.target.value)} placeholder="e.g. 500000" />
                </label>
                <label className="block">
                  <Label className="text-xs">Final sold price *</Label>
                  <Input type="number" value={form.final_sold_price} onChange={(e) => setField('final_sold_price', e.target.value)} placeholder="e.g. 475000" />
                </label>
              </div>
              {negotiationDelta && (
                <div className={`rounded-md border px-3 py-2 text-xs ${negotiationDelta.up ? 'border-emerald-200 bg-emerald-50 text-emerald-800' : 'border-amber-200 bg-amber-50 text-amber-800'}`}>
                  Negotiation delta: {negotiationDelta.up ? '+' : ''}{negotiationDelta.pct.toFixed(1)}% vs. listed price
                </div>
              )}
              <label className="block sm:w-1/2">
                <Label className="text-xs">Price reductions during the listing</Label>
                <Input type="number" value={form.price_reductions_count} onChange={(e) => setField('price_reductions_count', e.target.value)} placeholder="0, 1, 2..." />
              </label>
            </TabsContent>

            <TabsContent value="timing" className="mt-3 space-y-3">
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <label className="block">
                  <Label className="text-xs">Listed on</Label>
                  <Input type="date" value={form.listed_at} onChange={(e) => setField('listed_at', e.target.value)} />
                </label>
                <label className="block">
                  <Label className="text-xs">Closed on *</Label>
                  <Input type="date" value={form.closed_at} onChange={(e) => setField('closed_at', e.target.value)} required />
                </label>
              </div>
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <label className="block">
                  <Label className="text-xs">Days on market (auto)</Label>
                  <Input type="number" value={form.days_on_market} onChange={(e) => setField('days_on_market', e.target.value)} />
                </label>
                <label className="block">
                  <Label className="text-xs">Days to first offer</Label>
                  <Input type="number" value={form.days_to_first_offer} onChange={(e) => setField('days_to_first_offer', e.target.value)} />
                </label>
              </div>
            </TabsContent>

            <TabsContent value="demand" className="mt-3 space-y-3">
              <p className="text-xs text-muted-foreground">
                Demand signals let a future AVM learn how competitive the market was — helpful for pricing similar properties later.
              </p>
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <label className="block">
                  <Label className="text-xs">Offers received</Label>
                  <Input type="number" value={form.offers_received_count} onChange={(e) => setField('offers_received_count', e.target.value)} />
                </label>
                <label className="block">
                  <Label className="text-xs">Viewings conducted</Label>
                  <Input type="number" value={form.viewings_conducted} onChange={(e) => setField('viewings_conducted', e.target.value)} />
                </label>
              </div>
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <label className="block">
                  <Label className="text-xs">Rejected offer (highest)</Label>
                  <Input type="number" value={form.rejected_offer_max} onChange={(e) => setField('rejected_offer_max', e.target.value)} />
                </label>
                <label className="block">
                  <Label className="text-xs">Rejected offer (lowest)</Label>
                  <Input type="number" value={form.rejected_offer_min} onChange={(e) => setField('rejected_offer_min', e.target.value)} />
                </label>
              </div>
            </TabsContent>

            <TabsContent value="buyer" className="mt-3 space-y-3">
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <label className="block">
                  <Label className="text-xs">Buyer type</Label>
                  <select className="mt-1 w-full rounded-md border border-input bg-background px-3 py-2 text-sm" value={form.buyer_type} onChange={(e) => setField('buyer_type', e.target.value)}>
                    {(config?.buyer_types || []).map((v) => (
                      <option key={v} value={v}>{v.replace(/_/g, ' ')}</option>
                    ))}
                  </select>
                </label>
                <label className="block">
                  <Label className="text-xs">Buyer nationality (optional)</Label>
                  <Input value={form.buyer_nationality} onChange={(e) => setField('buyer_nationality', e.target.value)} placeholder="e.g. Lebanese, Emirati, British…" />
                </label>
              </div>
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                <label className="block">
                  <Label className="text-xs">Payment method</Label>
                  <select className="mt-1 w-full rounded-md border border-input bg-background px-3 py-2 text-sm" value={form.payment_method} onChange={(e) => setField('payment_method', e.target.value)}>
                    {(config?.payment_methods || []).map((v) => (
                      <option key={v} value={v}>{v.replace(/_/g, ' ')}</option>
                    ))}
                  </select>
                </label>
                <label className="block">
                  <Label className="text-xs">Down payment %</Label>
                  <Input type="number" step="0.1" value={form.down_payment_percent} onChange={(e) => setField('down_payment_percent', e.target.value)} placeholder="e.g. 25" />
                </label>
                <label className="block">
                  <Label className="text-xs">Mortgage provider</Label>
                  <Input value={form.mortgage_provider} onChange={(e) => setField('mortgage_provider', e.target.value)} placeholder="e.g. Bank Audi, HSBC" />
                </label>
              </div>
            </TabsContent>

            <TabsContent value="context" className="mt-3 space-y-3">
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <label className="block">
                  <Label className="text-xs">Close reason</Label>
                  <select className="mt-1 w-full rounded-md border border-input bg-background px-3 py-2 text-sm" value={form.close_reason} onChange={(e) => setField('close_reason', e.target.value)}>
                    {(config?.close_reasons || []).map((v) => (
                      <option key={v} value={v}>{v.replace(/_/g, ' ')}</option>
                    ))}
                  </select>
                </label>
                <label className="block">
                  <Label className="text-xs">Attribution source</Label>
                  <select className="mt-1 w-full rounded-md border border-input bg-background px-3 py-2 text-sm" value={form.attribution_source} onChange={(e) => setField('attribution_source', e.target.value)}>
                    {(config?.attribution_sources || []).map((v) => (
                      <option key={v} value={v}>{v.replace(/_/g, ' ')}</option>
                    ))}
                  </select>
                </label>
              </div>
              <label className="block">
                <Label className="text-xs">Agent notes (freeform)</Label>
                <textarea
                  rows={4}
                  value={form.agent_notes}
                  onChange={(e) => setField('agent_notes', e.target.value)}
                  placeholder="Anything unusual about the deal — seller motivation, unexpected buyer profile, market timing…"
                  className="mt-1 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                />
              </label>
            </TabsContent>
          </Tabs>
        </div>

        <div className="flex items-center justify-between gap-2 border-t p-3">
          <Badge variant="outline" className="text-[10px]">Training data — not shown to buyers</Badge>
          <div className="flex gap-2">
            <Button variant="outline" onClick={onClose} disabled={busy}>Skip</Button>
            <Button onClick={save} disabled={busy || !form.final_sold_price} className="gap-1.5">
              {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}
              Save
            </Button>
          </div>
        </div>
      </div>
    </div>
  )
}
