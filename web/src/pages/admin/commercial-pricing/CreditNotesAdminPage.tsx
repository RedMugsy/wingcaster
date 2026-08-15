import { useEffect, useMemo, useState } from 'react'
import { api } from '@/api/client'
import { useAuth } from '@/context/AuthContext'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { CreditNoteStatusBadge } from '@/components/commercial-pricing/CreditNoteStatusBadge'
import {
  CREDIT_NOTE_TYPE_LABELS,
  formatCreditNoteAmount,
  formatShortIso,
} from '@/components/commercial-pricing/subscription-helpers'
import { ConfirmDeactivateDialog } from '@/components/commercial-pricing/ConfirmDeactivateDialog'
import { CreditNoteFormDialog } from './CreditNoteFormDialog'
import type { CreditNote, CreditNoteStatus } from '@/types/commercialPricing'

const STATUS_OPTIONS: CreditNoteStatus[] = ['pending', 'applied', 'expired', 'voided']

export function CreditNotesAdminPage() {
  const { isAdmin } = useAuth()
  const [notes, setNotes] = useState<CreditNote[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [statusFilter, setStatusFilter] = useState<Set<CreditNoteStatus>>(new Set(['pending']))
  const [tenantFilter, setTenantFilter] = useState('')
  const [formOpen, setFormOpen] = useState(false)
  const [voidTarget, setVoidTarget] = useState<CreditNote | null>(null)
  const [voidReason, setVoidReason] = useState('')

  useEffect(() => { if (isAdmin) void load() }, [isAdmin, JSON.stringify([...statusFilter].sort()), tenantFilter])

  async function load() {
    setLoading(true)
    setError(null)
    try {
      const { notes } = await api.listAdminCreditNotes({
        status: statusFilter.size === 1 ? Array.from(statusFilter)[0] : undefined,
        tenant_id: tenantFilter.trim() || undefined,
        limit: 500,
      })
      // Client-side filter for multi-status selection (backend accepts one at a time).
      const filtered = statusFilter.size > 1
        ? notes.filter((n) => statusFilter.has(n.status))
        : notes
      setNotes(filtered)
    } catch (err: any) {
      setError(err?.message || 'Failed to load credit notes')
    } finally {
      setLoading(false)
    }
  }

  function toggleStatus(s: CreditNoteStatus) {
    setStatusFilter((prev) => {
      const next = new Set(prev)
      if (next.has(s)) next.delete(s); else next.add(s)
      return next
    })
  }

  async function handleVoid() {
    if (!voidTarget) return
    try {
      await api.voidAdminCreditNote(voidTarget.id, { reason: voidReason || undefined })
      setVoidTarget(null)
      setVoidReason('')
      await load()
    } catch (err: any) {
      setError(err?.message || 'Void failed')
    }
  }

  const totals = useMemo(() => {
    const byCurrency: Record<string, { credit: number; debit: number }> = {}
    for (const n of notes) {
      if (n.status !== 'pending') continue
      if (!byCurrency[n.currency]) byCurrency[n.currency] = { credit: 0, debit: 0 }
      if (n.amount_minor > 0) byCurrency[n.currency].credit += n.amount_minor
      else byCurrency[n.currency].debit += Math.abs(n.amount_minor)
    }
    return byCurrency
  }, [notes])

  if (!isAdmin) {
    return (
      <div className="container mx-auto max-w-2xl px-4 py-8">
        <Card>
          <CardHeader><CardTitle>Platform admin required</CardTitle></CardHeader>
          <CardContent className="text-sm text-muted-foreground">Credit-note management is restricted to platform admins.</CardContent>
        </Card>
      </div>
    )
  }

  return (
    <div className="container mx-auto px-4 py-8">
      <div className="mb-6 flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold">Credit Notes</h1>
          <p className="text-sm text-muted-foreground">
            Dollar-denominated ledger. Proration + refund + courtesy credits.
            Positive = platform owes tenant; negative = tenant owes platform.
          </p>
        </div>
        <Button onClick={() => setFormOpen(true)}>+ Issue Credit</Button>
      </div>

      {Object.keys(totals).length > 0 ? (
        <div className="mb-4 flex flex-wrap gap-3">
          {Object.entries(totals).map(([cur, t]) => (
            <div key={cur} className="rounded-md border bg-muted/30 px-3 py-2 text-xs">
              <div className="font-medium">{cur} pending</div>
              <div className="text-emerald-700">Credits owed: {formatCreditNoteAmount(t.credit, cur).text.replace(/^\+/, '')}</div>
              <div className="text-rose-700">Debits owed: {formatCreditNoteAmount(-t.debit, cur).text.replace(/^−/, '')}</div>
            </div>
          ))}
        </div>
      ) : null}

      <div className="mb-4 flex flex-wrap items-center gap-2">
        {STATUS_OPTIONS.map((s) => (
          <button
            key={s}
            onClick={() => toggleStatus(s)}
            className={
              'rounded-full border px-2 py-0.5 text-xs ' +
              (statusFilter.has(s) ? 'ring-2 ring-primary' : '')
            }
          >
            <CreditNoteStatusBadge status={s} />
          </button>
        ))}
        <span className="mx-2 h-4 w-px bg-border" />
        <Input className="max-w-xs" placeholder="Filter by tenant id…" value={tenantFilter} onChange={(e) => setTenantFilter(e.target.value)} />
      </div>

      {error ? <p className="mb-3 text-sm text-red-600">{error}</p> : null}

      <div className="overflow-x-auto rounded-md border">
        <table className="w-full text-sm">
          <thead className="bg-muted/40 text-left">
            <tr>
              <th className="px-3 py-2 font-medium">Created</th>
              <th className="px-3 py-2 font-medium">Tenant</th>
              <th className="px-3 py-2 font-medium">Subscription</th>
              <th className="px-3 py-2 font-medium">Type</th>
              <th className="px-3 py-2 font-medium">Amount</th>
              <th className="px-3 py-2 font-medium">Status</th>
              <th className="px-3 py-2 font-medium">Reason</th>
              <th className="px-3 py-2 text-right font-medium">Actions</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan={8} className="px-3 py-4 text-center text-muted-foreground">Loading…</td></tr>
            ) : notes.length === 0 ? (
              <tr><td colSpan={8} className="px-3 py-4 text-center text-muted-foreground">No credit notes match the filters.</td></tr>
            ) : notes.map((n) => {
              const amount = formatCreditNoteAmount(n.amount_minor, n.currency)
              return (
                <tr key={n.id} className="border-t">
                  <td className="px-3 py-2 text-xs">{formatShortIso(n.created_at)}</td>
                  <td className="px-3 py-2 font-mono text-xs">{n.tenant_id.slice(0, 8)}…</td>
                  <td className="px-3 py-2 font-mono text-xs">{n.subscription_id ? n.subscription_id.slice(0, 8) + '…' : <span className="text-muted-foreground">—</span>}</td>
                  <td className="px-3 py-2 text-xs">{CREDIT_NOTE_TYPE_LABELS[n.type]}</td>
                  <td className={
                    'px-3 py-2 font-mono ' +
                    (amount.direction === 'credit' ? 'text-emerald-700'
                      : amount.direction === 'debit' ? 'text-rose-700'
                      : 'text-muted-foreground')
                  }>{amount.text}</td>
                  <td className="px-3 py-2"><CreditNoteStatusBadge status={n.status} /></td>
                  <td className="px-3 py-2 text-xs">{n.reason || <span className="text-muted-foreground">—</span>}</td>
                  <td className="px-3 py-2 text-right">
                    {n.status === 'pending' ? (
                      <Button size="sm" variant="outline" onClick={() => { setVoidTarget(n); setVoidReason('') }}>Void</Button>
                    ) : null}
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>

      <CreditNoteFormDialog
        open={formOpen}
        onClose={() => setFormOpen(false)}
        onSaved={() => { void load() }}
      />

      <ConfirmDeactivateDialog
        open={Boolean(voidTarget)}
        title={`Void credit note?`}
        description={voidTarget ? `${CREDIT_NOTE_TYPE_LABELS[voidTarget.type]} · ${formatCreditNoteAmount(voidTarget.amount_minor, voidTarget.currency).text} · tenant ${voidTarget.tenant_id.slice(0, 8)}…. Voided notes cannot be re-activated.` : ''}
        confirmLabel="Void"
        onConfirm={handleVoid}
        onCancel={() => { setVoidTarget(null); setVoidReason('') }}
      />
    </div>
  )
}
