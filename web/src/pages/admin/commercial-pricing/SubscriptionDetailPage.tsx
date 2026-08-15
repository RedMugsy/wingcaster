import { useEffect, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { api } from '@/api/client'
import { useAuth } from '@/context/AuthContext'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { SubscriptionStatusBadge } from '@/components/commercial-pricing/SubscriptionStatusBadge'
import {
  dailyRateMinor,
  formatCreditNoteAmount,
  formatMoneyMinor,
  formatRelativeIso,
  formatShortIso,
  permittedActions,
} from '@/components/commercial-pricing/subscription-helpers'
import { ConfirmDeactivateDialog } from '@/components/commercial-pricing/ConfirmDeactivateDialog'
import { MigrateSubscriptionDialog } from './MigrateSubscriptionDialog'
import type { CreditNote, Subscription, SubscriptionHistoryEvent } from '@/types/commercialPricing'

export function SubscriptionDetailPage() {
  const { id } = useParams<{ id: string }>()
  const { isAdmin } = useAuth()
  const [subscription, setSubscription] = useState<Subscription | null>(null)
  const [history, setHistory] = useState<SubscriptionHistoryEvent[]>([])
  const [creditNotes, setCreditNotes] = useState<CreditNote[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [migrateOpen, setMigrateOpen] = useState(false)
  const [confirm, setConfirm] = useState<{ label: string; description: string; onConfirm: () => Promise<void> } | null>(null)

  useEffect(() => { if (isAdmin && id) void load() }, [isAdmin, id])

  async function load() {
    if (!id) return
    setLoading(true)
    setError(null)
    try {
      const [detail, notesRes] = await Promise.all([
        api.getAdminSubscription(id),
        api.listAdminCreditNotes({ subscription_id: id, limit: 100 }),
      ])
      setSubscription(detail.subscription)
      setHistory(detail.history)
      setCreditNotes(notesRes.notes)
    } catch (err: any) {
      setError(err?.message || 'Failed to load subscription')
    } finally {
      setLoading(false)
    }
  }

  async function runAction<T>(fn: () => Promise<T>) {
    try { await fn(); await load(); setConfirm(null) }
    catch (err: any) { setError(err?.message || 'Action failed') }
  }

  if (!isAdmin) {
    return (
      <div className="container mx-auto max-w-2xl px-4 py-8">
        <Card>
          <CardHeader><CardTitle>Platform admin required</CardTitle></CardHeader>
          <CardContent className="text-sm text-muted-foreground">Subscription detail is restricted to platform admins.</CardContent>
        </Card>
      </div>
    )
  }

  const perDay = subscription
    ? dailyRateMinor(subscription.resolved_plan_price_minor, subscription.billing_period_start, subscription.billing_period_end)
    : null

  return (
    <div className="container mx-auto px-4 py-8">
      <div className="mb-4">
        <Link to="/admin/commercial-pricing/subscriptions" className="text-sm text-muted-foreground hover:underline">
          ← Subscriptions
        </Link>
      </div>

      {error ? <p className="mb-3 text-sm text-red-600">{error}</p> : null}
      {loading || !subscription ? (
        <p className="text-sm text-muted-foreground">Loading…</p>
      ) : (
        <>
          <div className="mb-6 flex items-start justify-between gap-4">
            <div>
              <div className="flex items-center gap-3">
                <h1 className="text-2xl font-bold font-mono">{subscription.id.slice(0, 8)}…</h1>
                <SubscriptionStatusBadge status={subscription.status} />
                {subscription.grandfathered_at ? <Badge variant="outline">Grandfathered</Badge> : null}
                {subscription.cancel_at_period_end ? <Badge variant="outline">Cancels at period end</Badge> : null}
                {!subscription.auto_renew && subscription.status === 'active' ? <Badge variant="outline">Auto-renew off</Badge> : null}
              </div>
              <div className="mt-1 text-xs text-muted-foreground font-mono">
                tenant {subscription.tenant_id}
              </div>
            </div>
            <div className="flex flex-wrap gap-2">
              {(() => {
                const acts = permittedActions(subscription.status)
                return (
                  <>
                    {acts.migrate ? (
                      <Button onClick={() => setMigrateOpen(true)}>Migrate</Button>
                    ) : null}
                    {/*
                      Pause / resume are tenant-only actions (self-serve). The admin
                      surface intentionally does not expose them — admins force
                      terminal states (cancel / expire) or resolve payment state
                      (past-due flags).
                    */}
                    {acts.markPastDue ? (
                      <Button variant="outline" onClick={() => setConfirm({
                        label: 'Mark past-due',
                        description: 'Flags the subscription for follow-up. Metering continues to be granted but new payment attempts are expected before renewal.',
                        onConfirm: () => runAction(() => api.markAdminSubscriptionPastDue(subscription.id)) as unknown as Promise<void>,
                      })}>Mark past-due</Button>
                    ) : null}
                    {acts.resolvePastDue ? (
                      <Button variant="outline" onClick={() => runAction(() => api.resolveAdminSubscriptionPastDue(subscription.id))}>Resolve past-due</Button>
                    ) : null}
                    {acts.cancel ? (
                      <Button variant="outline" onClick={() => setConfirm({
                        label: 'Cancel at period end',
                        description: 'Sets cancel_at_period_end. Tenant keeps access until the current period ends, at which point the scanner expires the subscription.',
                        onConfirm: () => runAction(() => api.cancelAdminSubscription(subscription.id, { immediate: false })) as unknown as Promise<void>,
                      })}>Cancel at period end</Button>
                    ) : null}
                    {acts.cancel ? (
                      <Button variant="destructive" onClick={() => setConfirm({
                        label: 'Cancel immediately',
                        description: 'Terminates the subscription NOW. Tenant loses access. Metering hard-stops. Use only when the tenant explicitly requested immediate termination.',
                        onConfirm: () => runAction(() => api.cancelAdminSubscription(subscription.id, { immediate: true })) as unknown as Promise<void>,
                      })}>Cancel immediately</Button>
                    ) : null}
                  </>
                )
              })()}
            </div>
          </div>

          <div className="grid gap-6 lg:grid-cols-3">
            <div className="lg:col-span-2 space-y-4">
              <Card>
                <CardHeader className="pb-2"><CardTitle className="text-sm">Product + tier</CardTitle></CardHeader>
                <CardContent className="grid grid-cols-2 gap-3 text-sm">
                  <Field label="Product">{subscription.product_id}</Field>
                  <Field label="Version">v{subscription.product_version}</Field>
                  <Field label="Tier">{subscription.tier_id || '—'}</Field>
                  <Field label="Territory">{subscription.territory_id || '—'}</Field>
                </CardContent>
              </Card>
              <Card>
                <CardHeader className="pb-2"><CardTitle className="text-sm">Pricing snapshot</CardTitle></CardHeader>
                <CardContent className="grid grid-cols-2 gap-3 text-sm">
                  <Field label="Plan price (per period)">
                    {formatMoneyMinor(subscription.resolved_plan_price_minor, subscription.resolved_plan_currency)}
                  </Field>
                  <Field label="Source">{subscription.resolved_plan_source || '—'}</Field>
                  <Field label="Per day">{perDay != null ? formatMoneyMinor(perDay, subscription.resolved_plan_currency) : '—'}</Field>
                  <Field label="Cast value lock">{subscription.price_locked_minor != null ? formatMoneyMinor(subscription.price_locked_minor) : '—'}</Field>
                </CardContent>
              </Card>
              <Card>
                <CardHeader className="pb-2"><CardTitle className="text-sm">Period</CardTitle></CardHeader>
                <CardContent className="grid grid-cols-2 gap-3 text-sm">
                  <Field label="Period start">{formatShortIso(subscription.billing_period_start)}</Field>
                  <Field label="Period end">{formatShortIso(subscription.billing_period_end)}</Field>
                  <Field label="Trial ends">{formatShortIso(subscription.trial_ends_at)}</Field>
                  <Field label="Next renewal">{formatShortIso(subscription.next_renewal_at)}</Field>
                  <Field label="Auto renew">{subscription.auto_renew ? 'Yes' : 'No'}</Field>
                  <Field label="Cancel at period end">{subscription.cancel_at_period_end ? 'Yes' : 'No'}</Field>
                  <Field label="Grandfathered at">{formatShortIso(subscription.grandfathered_at)}</Field>
                  <Field label="Cancelled at">{formatShortIso(subscription.cancelled_at)}</Field>
                </CardContent>
              </Card>
              <Card>
                <CardHeader className="pb-2"><CardTitle className="text-sm">Credit notes ({creditNotes.length})</CardTitle></CardHeader>
                <CardContent className="p-0">
                  {creditNotes.length === 0 ? (
                    <p className="p-4 text-sm text-muted-foreground">No credit notes for this subscription.</p>
                  ) : (
                    <ul className="divide-y">
                      {creditNotes.map((note) => {
                        const { text, direction } = formatCreditNoteAmount(note.amount_minor, note.currency)
                        return (
                          <li key={note.id} className="flex items-center justify-between px-4 py-2 text-sm">
                            <div>
                              <div className="text-xs uppercase text-muted-foreground">{note.type} · {note.status}</div>
                              <div>{note.reason || <span className="text-muted-foreground italic">no reason</span>}</div>
                              <div className="text-[10px] text-muted-foreground">{formatShortIso(note.created_at)}</div>
                            </div>
                            <div className={
                              direction === 'credit' ? 'font-mono text-emerald-700'
                                : direction === 'debit' ? 'font-mono text-rose-700'
                                : 'font-mono text-muted-foreground'
                            }>
                              {text}
                            </div>
                          </li>
                        )
                      })}
                    </ul>
                  )}
                </CardContent>
              </Card>
            </div>
            <div className="lg:col-span-1">
              <Card>
                <CardHeader className="pb-2"><CardTitle className="text-sm">History ({history.length})</CardTitle></CardHeader>
                <CardContent className="p-0">
                  <ul className="divide-y max-h-[70vh] overflow-y-auto">
                    {history.length === 0 ? (
                      <li className="p-4 text-sm text-muted-foreground">No history yet.</li>
                    ) : history.map((ev) => (
                      <li key={ev.id} className="px-4 py-2 text-xs">
                        <div className="flex items-center justify-between">
                          <span className="font-medium">{ev.event}</span>
                          <span className="text-[10px] text-muted-foreground">{formatRelativeIso(ev.created_at)}</span>
                        </div>
                        <div className="text-[10px] text-muted-foreground">
                          {ev.actor_type || 'unknown'}{ev.actor_id ? ` · ${ev.actor_id.slice(0, 8)}…` : ''}
                        </div>
                        {ev.reason ? <div className="mt-0.5 italic">{ev.reason}</div> : null}
                      </li>
                    ))}
                  </ul>
                </CardContent>
              </Card>
            </div>
          </div>
        </>
      )}

      {subscription ? (
        <MigrateSubscriptionDialog
          open={migrateOpen}
          subscription={subscription}
          onClose={() => setMigrateOpen(false)}
          onMigrated={() => { void load() }}
        />
      ) : null}
      <ConfirmDeactivateDialog
        open={Boolean(confirm)}
        title={confirm?.label || ''}
        description={confirm?.description || ''}
        confirmLabel="Confirm"
        onConfirm={confirm?.onConfirm || (async () => {})}
        onCancel={() => setConfirm(null)}
      />
    </div>
  )
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="text-xs text-muted-foreground">{label}</div>
      <div>{children}</div>
    </div>
  )
}
