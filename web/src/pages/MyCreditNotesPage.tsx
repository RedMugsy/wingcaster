import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { api } from '@/api/client'
import { useAuth } from '@/context/AuthContext'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { CreditNoteStatusBadge } from '@/components/commercial-pricing/CreditNoteStatusBadge'
import {
  CREDIT_NOTE_TYPE_LABELS,
  formatCreditNoteAmount,
  formatShortIso,
} from '@/components/commercial-pricing/subscription-helpers'
import type { CreditNote, CreditNoteStatus } from '@/types/commercialPricing'

const STATUS_OPTIONS: CreditNoteStatus[] = ['pending', 'applied', 'expired', 'voided']

export function MyCreditNotesPage() {
  const { agent } = useAuth()
  const [notes, setNotes] = useState<CreditNote[]>([])
  const [pending, setPending] = useState<Record<string, number>>({})
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [statusFilter, setStatusFilter] = useState<Set<CreditNoteStatus>>(new Set())

  useEffect(() => { if (agent) void load() }, [agent?.id])

  async function load() {
    setLoading(true)
    setError(null)
    try {
      const { notes, pending_balance_by_currency } = await api.getMyCreditNotes({ limit: 200 })
      setNotes(notes)
      setPending(pending_balance_by_currency || {})
    } catch (err: any) {
      setError(err?.message || 'Failed to load credit notes')
    } finally {
      setLoading(false)
    }
  }

  function toggle(status: CreditNoteStatus) {
    setStatusFilter((prev) => {
      const next = new Set(prev)
      if (next.has(status)) next.delete(status); else next.add(status)
      return next
    })
  }

  const filtered = useMemo(() => {
    if (statusFilter.size === 0) return notes
    return notes.filter((n) => statusFilter.has(n.status))
  }, [notes, statusFilter])

  if (!agent) {
    return (
      <div className="container mx-auto max-w-2xl px-4 py-8">
        <Card>
          <CardHeader><CardTitle>Sign in required</CardTitle></CardHeader>
          <CardContent className="text-sm text-muted-foreground">
            <Link to="/login" className="underline">Sign in</Link> to view your credit notes.
          </CardContent>
        </Card>
      </div>
    )
  }

  return (
    <div className="container mx-auto px-4 py-8">
      <div className="mb-6">
        <h1 className="text-2xl font-bold">My Credit Notes</h1>
        <p className="text-sm text-muted-foreground">
          Money owed to you (credits) or owed by you (debits), separate from your quota allowance.
        </p>
      </div>

      {Object.keys(pending).length > 0 ? (
        <div className="mb-4 grid gap-2 md:grid-cols-3">
          {Object.entries(pending).map(([cur, bal]) => (
            <Card key={cur}>
              <CardHeader className="pb-2"><CardTitle className="text-sm">{cur} pending</CardTitle></CardHeader>
              <CardContent>
                <div className={
                  bal > 0 ? 'text-2xl font-bold text-emerald-700'
                    : bal < 0 ? 'text-2xl font-bold text-rose-700'
                    : 'text-2xl font-bold text-muted-foreground'
                }>
                  {bal > 0 ? '+' : ''}{(bal / 100).toFixed(2)}
                </div>
                <div className="text-xs text-muted-foreground">
                  {bal > 0 ? 'owed to you — applied at next invoice' : bal < 0 ? 'owed by you — collected at next invoice' : 'balanced'}
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      ) : null}

      <div className="mb-4 flex flex-wrap items-center gap-2">
        {STATUS_OPTIONS.map((s) => (
          <button
            key={s}
            onClick={() => toggle(s)}
            className={
              'rounded-full border px-2 py-0.5 text-xs ' +
              (statusFilter.has(s) ? 'ring-2 ring-primary' : '')
            }
          >
            <CreditNoteStatusBadge status={s} />
          </button>
        ))}
      </div>

      {error ? <p className="mb-3 text-sm text-red-600">{error}</p> : null}

      <div className="overflow-x-auto rounded-md border">
        <table className="w-full text-sm">
          <thead className="bg-muted/40 text-left">
            <tr>
              <th className="px-3 py-2 font-medium">Date</th>
              <th className="px-3 py-2 font-medium">Type</th>
              <th className="px-3 py-2 font-medium">Amount</th>
              <th className="px-3 py-2 font-medium">Status</th>
              <th className="px-3 py-2 font-medium">Reason</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan={5} className="px-3 py-4 text-center text-muted-foreground">Loading…</td></tr>
            ) : filtered.length === 0 ? (
              <tr><td colSpan={5} className="px-3 py-4 text-center text-muted-foreground">No credit notes.</td></tr>
            ) : filtered.map((n) => {
              const amt = formatCreditNoteAmount(n.amount_minor, n.currency)
              return (
                <tr key={n.id} className="border-t">
                  <td className="px-3 py-2 text-xs">{formatShortIso(n.created_at)}</td>
                  <td className="px-3 py-2">{CREDIT_NOTE_TYPE_LABELS[n.type]}</td>
                  <td className={
                    'px-3 py-2 font-mono ' +
                    (amt.direction === 'credit' ? 'text-emerald-700'
                      : amt.direction === 'debit' ? 'text-rose-700'
                      : 'text-muted-foreground')
                  }>{amt.text}</td>
                  <td className="px-3 py-2"><CreditNoteStatusBadge status={n.status} /></td>
                  <td className="px-3 py-2 text-xs">{n.reason || <span className="text-muted-foreground">—</span>}</td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </div>
  )
}
