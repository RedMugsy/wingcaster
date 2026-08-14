import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import {
  ArrowLeft, Download, FileText, Loader2, Plus, Trash2, Upload,
} from 'lucide-react'
import { api, type ClosedTransaction } from '@/api/client'
import { useAuth } from '@/context/AuthContext'
import { useToast } from '@/components/ui/toast'
import { usePageTitle } from '@/lib/usePageTitle'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { RecordClosureModal } from '@/components/closed-transactions/RecordClosureModal'

const CSV_TEMPLATE_HEADERS = [
  'listing_id', 'external_reference', 'transaction_type',
  'original_listed_price', 'final_sold_price', 'currency',
  'listed_at', 'closed_at', 'days_on_market',
  'offers_received_count', 'viewings_conducted',
  'buyer_type', 'buyer_nationality', 'payment_method',
  'down_payment_percent', 'mortgage_provider',
  'close_reason', 'attribution_source', 'agent_notes',
]

export function HistoricalTransactionsPage() {
  const { agent, loading: authLoading } = useAuth()
  const { addToast } = useToast()
  usePageTitle('Historical Transactions')

  const [rows, setRows] = useState<ClosedTransaction[]>([])
  const [loading, setLoading] = useState(true)
  const [importOpen, setImportOpen] = useState(false)
  const [manualOpen, setManualOpen] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const r = await api.listClosedTransactions({ limit: 500 })
      setRows(r.transactions)
    } catch (err: any) {
      addToast({ title: 'Failed to load', description: err?.message, variant: 'error' })
    } finally {
      setLoading(false)
    }
  }, [addToast])

  useEffect(() => { if (!authLoading && agent) load() }, [authLoading, agent, load])

  async function handleDelete(id: string) {
    if (!window.confirm('Delete this transaction record? This is training data — think twice.')) return
    try {
      await api.deleteClosedTransaction(id)
      setRows((prev) => prev.filter((r) => r.id !== id))
    } catch (err: any) {
      addToast({ title: 'Delete failed', description: err?.message, variant: 'error' })
    }
  }

  function downloadCsvTemplate() {
    const csv = CSV_TEMPLATE_HEADERS.join(',') + '\n' +
      'example-listing-id,REF-2023-014,sale,500000,475000,USD,2023-01-15,2023-04-02,77,3,12,owner_occupier,Lebanese,mortgage,25,Bank Audi,market_price,past_client,Sold to a repeat client\n'
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' })
    const link = document.createElement('a')
    link.href = URL.createObjectURL(blob)
    link.download = 'wingcaster-historical-transactions-template.csv'
    link.click()
    URL.revokeObjectURL(link.href)
  }

  const totals = useMemo(() => {
    const t = { count: rows.length, backfilled: 0, sold_gross: 0, currency: 'USD' as string | null }
    for (const r of rows) {
      if (r.is_backfilled) t.backfilled++
      if (r.final_sold_price) t.sold_gross += Number(r.final_sold_price)
      if (!t.currency && r.currency) t.currency = r.currency
    }
    return t
  }, [rows])

  if (authLoading || loading) {
    return (
      <div className="flex min-h-[60vh] items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    )
  }
  if (!agent) {
    return (
      <div className="mx-auto max-w-lg py-16 text-center">
        <h1 className="text-2xl font-semibold">Sign in to manage historical transactions</h1>
        <Link to="/login" className="mt-3 inline-block"><Button>Sign in</Button></Link>
      </div>
    )
  }

  return (
    <div className="mx-auto max-w-6xl px-4 py-6 sm:px-6 lg:px-8">
      <div className="mb-4 flex items-center gap-2 text-sm text-muted-foreground">
        <Link to="/dashboard" className="inline-flex items-center gap-1 hover:text-foreground">
          <ArrowLeft className="h-4 w-4" /> Dashboard
        </Link>
        <span>·</span>
        <span>Settings</span>
      </div>

      <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Historical Transactions</h1>
          <p className="mt-1 max-w-2xl text-sm text-muted-foreground">
            Every deal you close on Wingcaster is captured automatically. Deals you closed BEFORE joining
            Wingcaster can be backfilled here — one at a time or via CSV upload. This data trains the
            future property valuator; the more you have, the better the market intelligence gets.
          </p>
        </div>
        <div className="flex gap-2">
          <Button size="sm" variant="outline" className="gap-1.5" onClick={downloadCsvTemplate}>
            <Download className="h-4 w-4" />
            CSV template
          </Button>
          <Button size="sm" variant="outline" className="gap-1.5" onClick={() => setImportOpen(true)}>
            <Upload className="h-4 w-4" />
            Import CSV
          </Button>
          <Button size="sm" className="gap-1.5" onClick={() => setManualOpen(true)}>
            <Plus className="h-4 w-4" />
            Add manually
          </Button>
        </div>
      </div>

      <div className="mb-6 grid grid-cols-2 gap-3 md:grid-cols-4">
        <StatTile label="Total recorded" value={totals.count.toLocaleString()} />
        <StatTile label="Backfilled" value={totals.backfilled.toLocaleString()} />
        <StatTile label="From platform" value={(totals.count - totals.backfilled).toLocaleString()} />
        <StatTile
          label="Gross closed volume"
          value={totals.sold_gross ? `${totals.currency} ${Math.round(totals.sold_gross).toLocaleString()}` : '—'}
        />
      </div>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-lg">Recorded transactions</CardTitle>
        </CardHeader>
        <CardContent>
          {rows.length === 0 ? (
            <div className="rounded-md border border-dashed bg-slate-50 p-8 text-center text-sm text-muted-foreground">
              <FileText className="mx-auto mb-2 h-6 w-6" />
              No transactions recorded yet. Add manually or import a CSV to seed your history.
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="min-w-full divide-y divide-slate-200">
                <thead className="bg-slate-50 text-left text-xs uppercase tracking-wide text-muted-foreground">
                  <tr>
                    <th className="px-3 py-2">Closed</th>
                    <th className="px-3 py-2">Type</th>
                    <th className="px-3 py-2">Listing</th>
                    <th className="px-3 py-2">Sold</th>
                    <th className="px-3 py-2">Δ</th>
                    <th className="px-3 py-2">Buyer</th>
                    <th className="px-3 py-2">Payment</th>
                    <th className="px-3 py-2">DOM</th>
                    <th className="px-3 py-2"></th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 text-sm">
                  {rows.map((r) => {
                    const orig = r.original_listed_price
                    const sold = r.final_sold_price
                    const delta = orig && sold ? ((sold - orig) / orig) * 100 : null
                    return (
                      <tr key={r.id} className="hover:bg-slate-50">
                        <td className="whitespace-nowrap px-3 py-2 text-xs text-muted-foreground">
                          {r.closed_at ? new Date(r.closed_at).toLocaleDateString() : '—'}
                        </td>
                        <td className="px-3 py-2 capitalize text-xs">{r.transaction_type}</td>
                        <td className="px-3 py-2">
                          {r.listing_id.startsWith('backfill:') ? (
                            <Badge variant="outline" className="text-[10px]">backfill · {r.listing_id.replace('backfill:', '')}</Badge>
                          ) : (
                            <Link to={`/listings/${r.listing_id}`} className="text-xs text-primary hover:underline">
                              {r.listing_id.slice(0, 10)}…
                            </Link>
                          )}
                        </td>
                        <td className="whitespace-nowrap px-3 py-2 font-medium">
                          {r.final_sold_price != null ? `${r.currency} ${r.final_sold_price.toLocaleString()}` : '—'}
                        </td>
                        <td className={`whitespace-nowrap px-3 py-2 text-xs ${delta == null ? 'text-muted-foreground' : delta >= 0 ? 'text-emerald-600' : 'text-amber-600'}`}>
                          {delta == null ? '—' : `${delta >= 0 ? '+' : ''}${delta.toFixed(1)}%`}
                        </td>
                        <td className="px-3 py-2 text-xs capitalize">{r.buyer_type.replace(/_/g, ' ')}</td>
                        <td className="px-3 py-2 text-xs capitalize">{r.payment_method.replace(/_/g, ' ')}</td>
                        <td className="px-3 py-2 text-xs text-muted-foreground">{r.days_on_market ?? '—'}</td>
                        <td className="px-3 py-2 text-right">
                          <button type="button" onClick={() => handleDelete(r.id)} className="text-rose-600 hover:text-rose-800">
                            <Trash2 className="h-4 w-4" />
                          </button>
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>

      {importOpen && (
        <ImportCsvModal
          onClose={() => setImportOpen(false)}
          onDone={() => { setImportOpen(false); load() }}
        />
      )}

      {manualOpen && (
        <RecordClosureModal
          listingId={`backfill:${Date.now()}`}
          listingTitle="Manual backfill entry"
          onClose={() => setManualOpen(false)}
          onSaved={() => { setManualOpen(false); load() }}
        />
      )}
    </div>
  )
}

function StatTile({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border bg-white p-3">
      <div className="text-2xl font-semibold text-slate-900">{value}</div>
      <div className="mt-0.5 text-[10px] uppercase tracking-wide text-muted-foreground">{label}</div>
    </div>
  )
}

function ImportCsvModal({
  onClose, onDone,
}: {
  onClose: () => void
  onDone: () => void
}) {
  const { addToast } = useToast()
  const [csvText, setCsvText] = useState('')
  const [busy, setBusy] = useState(false)
  const [result, setResult] = useState<Awaited<ReturnType<typeof api.importClosedTransactionsCsv>> | null>(null)

  async function upload() {
    if (busy || !csvText.trim()) return
    setBusy(true)
    try {
      const r = await api.importClosedTransactionsCsv(csvText)
      setResult(r)
      if (r.imported > 0) {
        addToast({ title: `Imported ${r.imported} transaction${r.imported === 1 ? '' : 's'}`, variant: 'success' })
      }
    } catch (err: any) {
      addToast({ title: 'Import failed', description: err?.message, variant: 'error' })
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div className="flex max-h-[92vh] w-full max-w-3xl flex-col rounded-lg bg-white shadow-xl">
        <div className="flex items-start justify-between border-b p-4">
          <div>
            <h2 className="text-lg font-semibold">Import historical transactions (CSV)</h2>
            <p className="mt-0.5 text-xs text-muted-foreground">
              Paste CSV content below. Required columns: <code>final_sold_price</code>, <code>closed_at</code>,
              and either <code>listing_id</code> or <code>external_reference</code>. Everything else is optional.
              Download the template for the full column list.
            </p>
          </div>
          <Button variant="ghost" size="sm" onClick={onClose}>×</Button>
        </div>
        <div className="flex-1 space-y-3 overflow-y-auto p-4">
          <textarea
            value={csvText}
            onChange={(e) => setCsvText(e.target.value)}
            rows={18}
            placeholder="listing_id,external_reference,transaction_type,final_sold_price,closed_at,..."
            className="w-full rounded-md border border-input bg-background px-3 py-2 font-mono text-xs"
          />
          {result && (
            <div className={`rounded-md border px-3 py-2 text-xs ${result.imported ? 'border-emerald-200 bg-emerald-50 text-emerald-800' : 'border-amber-200 bg-amber-50 text-amber-800'}`}>
              Imported: {result.imported} · Skipped: {result.skipped}
              {result.errors.length > 0 && (
                <ul className="mt-1 list-disc pl-4">
                  {result.errors.slice(0, 8).map((e, i) => (
                    <li key={i}>Row {e.row}: {e.error}</li>
                  ))}
                  {result.errors.length > 8 && <li>… and {result.errors.length - 8} more</li>}
                </ul>
              )}
            </div>
          )}
        </div>
        <div className="flex justify-end gap-2 border-t p-3">
          <Button variant="outline" onClick={onClose} disabled={busy}>Close</Button>
          <Button onClick={upload} disabled={busy || !csvText.trim()} className="gap-1.5">
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />}
            Import
          </Button>
          {result && (
            <Button variant="outline" onClick={onDone}>Done</Button>
          )}
        </div>
      </div>
    </div>
  )
}
