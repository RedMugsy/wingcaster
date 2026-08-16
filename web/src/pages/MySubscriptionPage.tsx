import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { api } from '@/api/client'
import { useAuth } from '@/context/AuthContext'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { SubscriptionStatusBadge } from '@/components/commercial-pricing/SubscriptionStatusBadge'
import {
  daysUntilIso,
  formatCreditNoteAmount,
  formatMoneyMinor,
  formatRelativeIso,
  formatShortIso,
  permittedActions,
} from '@/components/commercial-pricing/subscription-helpers'
import { ConfirmDeactivateDialog } from '@/components/commercial-pricing/ConfirmDeactivateDialog'
import { ChangeTierDialog } from './ChangeTierDialog'
import type { CreditNote, Subscription, SubscriptionHistoryEvent } from '@/types/commercialPricing'

export function MySubscriptionPage() {
  const { agent } = useAuth()
  const [subscription, setSubscription] = useState<Subscription | null>(null)
  const [others, setOthers] = useState<Subscription[]>([])
  const [history, setHistory] = useState<SubscriptionHistoryEvent[]>([])
  const [creditNotes, setCreditNotes] = useState<CreditNote[]>([])
  const [pending, setPending] = useState<Record<string, number>>({})
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [changeOpen, setChangeOpen] = useState(false)
  const [confirm, setConfirm] = useState<{ label: string; description: string; onConfirm: () => Promise<void> } | null>(null)

  useEffect(() => { if (agent) void load() }, [agent?.id])

  async function load() {
    setLoading(true)
    setError(null)
    try {
      const [mine, notes] = await Promise.all([
        api.getMySubscription(),
        api.getMyCreditNotes({ limit: 25 }),
      ])
      setSubscription(mine.subscription)
      setOthers(mine.other_subscriptions || [])
      setHistory(mine.history || [])
      setCreditNotes(notes.notes || [])
      setPending(notes.pending_balance_by_currency || {})
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

  const trialDaysLeft = useMemo(() => daysUntilIso(subscription?.trial_ends_at), [subscription?.trial_ends_at])
  const nextRenewalDays = useMemo(() => daysUntilIso(subscription?.next_renewal_at), [subscription?.next_renewal_at])

  if (!agent) {
    return (
      <div className="container mx-auto max-w-2xl px-4 py-8">
        <Card>
          <CardHeader><CardTitle>Sign in required</CardTitle></CardHeader>
          <CardContent className="text-sm text-muted-foreground">
            <Link to="/login" className="underline">Sign in</Link> to manage your subscription.
          </CardContent>
        </Card>
      </div>
    )
  }

  return (
    <div className="container mx-auto px-4 py-8">
      <h1 className="mb-6 text-2xl font-bold">My Subscription</h1>

      {error ? <p className="mb-3 text-sm text-red-600">{error}</p> : null}
      {loading ? <p className="text-sm text-muted-foreground">Loading…</p> : null}

      {!loading && !subscription ? (
        <Card>
          <CardContent className="py-12 text-center">
            <p className="text-sm text-muted-foreground">You do not have an active subscription.</p>
            <Link to="/pricing"><Button className="mt-4">Browse plans</Button></Link>
          </CardContent>
        </Card>
      ) : null}

      {subscription ? (
        <>
          {/* State-driven notifications */}
          {trialDaysLeft != null && trialDaysLeft <= 7 ? (
            <div className="mb-4 rounded-md border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
              Your trial ends in {trialDaysLeft} day{trialDaysLeft !== 1 ? 's' : ''}. The first billing period starts automatically after that.
            </div>
          ) : null}
          {subscription.status === 'past_due' ? (
            <div className="mb-4 rounded-md border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-900">
              Your subscription is past due. Contact support to resolve payment before your next renewal.
            </div>
          ) : null}
          {subscription.cancel_at_period_end ? (
            <div className="mb-4 rounded-md border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-900">
              Your subscription will end on {formatShortIso(subscription.billing_period_end)} and will not renew.
              {' '}
              <button className="underline" onClick={() => setConfirm({
                label: 'Undo cancellation',
                description: 'Resume auto-renewal for this subscription.',
                onConfirm: async () => {
                  await api.changeMyTier({
                    subscription_id: subscription.id,
                    target_tier_id: subscription.tier_id!,
                    prorate: false,
                  }).catch(() => null)
                },
              })}>Reconsider</button>
            </div>
          ) : null}
          {subscription.grandfathered_at ? (
            <div className="mb-4 rounded-md border border-indigo-200 bg-indigo-50 px-4 py-3 text-sm text-indigo-900">
              A newer version of your plan is available. You are grandfathered on v{subscription.product_version} — click below to see the new plan.
              <div className="mt-2">
                <Link to="/pricing"><Button size="sm" variant="outline">See new plan</Button></Link>
              </div>
            </div>
          ) : null}

          <div className="grid gap-6 lg:grid-cols-3">
            <div className="lg:col-span-2 space-y-4">
              <Card>
                <CardHeader className="pb-2">
                  <div className="flex items-center justify-between gap-2">
                    <CardTitle className="text-base">Current plan</CardTitle>
                    <SubscriptionStatusBadge status={subscription.status} />
                  </div>
                </CardHeader>
                <CardContent className="space-y-3 text-sm">
                  <div>
                    <div className="text-xs text-muted-foreground">Version</div>
                    <div className="font-mono">v{subscription.product_version}</div>
                  </div>
                  <div>
                    <div className="text-xs text-muted-foreground">Price</div>
                    <div className="text-lg font-semibold">
                      {formatMoneyMinor(subscription.resolved_plan_price_minor, subscription.resolved_plan_currency)}
                    </div>
                  </div>
                  <div>
                    <div className="text-xs text-muted-foreground">Next renewal</div>
                    <div>
                      {formatShortIso(subscription.next_renewal_at)}
                      {nextRenewalDays != null ? <span className="ml-1 text-xs text-muted-foreground">(in {nextRenewalDays} day{nextRenewalDays !== 1 ? 's' : ''})</span> : null}
                    </div>
                  </div>
                  {subscription.auto_renew ? null : (
                    <Badge variant="outline">Auto-renew off</Badge>
                  )}
                </CardContent>
              </Card>

              <Card>
                <CardHeader className="pb-2"><CardTitle className="text-sm">Actions</CardTitle></CardHeader>
                <CardContent className="flex flex-wrap gap-2">
                  {(() => {
                    const acts = permittedActions(subscription.status)
                    return (
                      <>
                        {acts.migrate ? (
                          <Button onClick={() => setChangeOpen(true)}>Change plan</Button>
                        ) : null}
                        {acts.pause ? (
                          <Button variant="outline" onClick={() => setConfirm({
                            label: 'Pause subscription',
                            description: 'Freezes your current period. You can resume at any time.',
                            onConfirm: async () => { await api.pauseMySubscription({ subscription_id: subscription.id }) },
                          })}>Pause</Button>
                        ) : null}
                        {acts.resume ? (
                          <Button onClick={() => runAction(() => api.resumeMySubscription({ subscription_id: subscription.id }))}>Resume</Button>
                        ) : null}
                        {acts.cancel ? (
                          <Button variant="outline" onClick={() => setConfirm({
                            label: 'Cancel at period end',
                            description: 'Your subscription stays active until the current period ends, then expires. No further charges.',
                            onConfirm: async () => { await api.cancelMySubscription({ subscription_id: subscription.id, immediate: false }) },
                          })}>Cancel at period end</Button>
                        ) : null}
                        {acts.cancel ? (
                          <Button variant="destructive" onClick={() => setConfirm({
                            label: 'Cancel immediately',
                            description: 'You will lose access right now. This cannot be undone. Contact support if you need a refund.',
                            onConfirm: async () => { await api.cancelMySubscription({ subscription_id: subscription.id, immediate: true }) },
                          })}>Cancel immediately</Button>
                        ) : null}
                      </>
                    )
                  })()}
                </CardContent>
              </Card>

              <Card>
                <CardHeader className="pb-2"><CardTitle className="text-sm">Billing period</CardTitle></CardHeader>
                <CardContent className="grid grid-cols-2 gap-3 text-sm">
                  <Field label="Period start">{formatShortIso(subscription.billing_period_start)}</Field>
                  <Field label="Period end">{formatShortIso(subscription.billing_period_end)}</Field>
                  <Field label="Trial ends">{formatShortIso(subscription.trial_ends_at)}</Field>
                  <Field label="Auto renew">{subscription.auto_renew ? 'Yes' : 'No'}</Field>
                </CardContent>
              </Card>

              {others.length > 0 ? (
                <Card>
                  <CardHeader className="pb-2"><CardTitle className="text-sm">Other subscriptions ({others.length})</CardTitle></CardHeader>
                  <CardContent className="space-y-2 text-sm">
                    {others.map((o) => (
                      <div key={o.id} className="flex items-center justify-between rounded-md border p-2">
                        <div>
                          <div className="font-mono text-xs">product {o.product_id.slice(0, 8)}… tier {o.tier_id?.slice(0, 8) || '—'}…</div>
                          <div className="text-xs text-muted-foreground">
                            {formatMoneyMinor(o.resolved_plan_price_minor, o.resolved_plan_currency)}
                          </div>
                        </div>
                        <SubscriptionStatusBadge status={o.status} />
                      </div>
                    ))}
                  </CardContent>
                </Card>
              ) : null}

              <Card>
                <CardHeader className="pb-2 flex items-center justify-between">
                  <CardTitle className="text-sm">Recent credit notes</CardTitle>
                  <Link to="/credit-notes" className="text-xs text-muted-foreground hover:underline">See all →</Link>
                </CardHeader>
                <CardContent className="p-0">
                  {Object.keys(pending).length > 0 ? (
                    <div className="border-b bg-muted/30 px-4 py-2 text-xs">
                      {Object.entries(pending).map(([cur, bal]) => (
                        <div key={cur}>
                          Pending balance {cur}: {bal > 0 ? `+${(bal / 100).toFixed(2)}` : `${(bal / 100).toFixed(2)}`}
                        </div>
                      ))}
                    </div>
                  ) : null}
                  {creditNotes.length === 0 ? (
                    <p className="p-4 text-sm text-muted-foreground">No credit notes.</p>
                  ) : (
                    <ul className="divide-y">
                      {creditNotes.slice(0, 8).map((note) => {
                        const { text, direction } = formatCreditNoteAmount(note.amount_minor, note.currency)
                        return (
                          <li key={note.id} className="flex items-center justify-between px-4 py-2 text-sm">
                            <div>
                              <div className="text-xs uppercase text-muted-foreground">{note.type} · {note.status}</div>
                              <div className="text-xs text-muted-foreground">{formatShortIso(note.created_at)}</div>
                            </div>
                            <div className={
                              direction === 'credit' ? 'font-mono text-emerald-700'
                                : direction === 'debit' ? 'font-mono text-rose-700'
                                : 'font-mono text-muted-foreground'
                            }>{text}</div>
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
                <CardHeader className="pb-2"><CardTitle className="text-sm">History</CardTitle></CardHeader>
                <CardContent className="p-0">
                  <ul className="divide-y max-h-[70vh] overflow-y-auto">
                    {history.length === 0 ? (
                      <li className="p-4 text-sm text-muted-foreground">No history yet.</li>
                    ) : history.map((ev) => (
                      <li key={ev.id} className="px-4 py-2 text-xs">
                        <div className="flex items-center justify-between">
                          <span className="font-medium">{ev.event.replace(/_/g, ' ')}</span>
                          <span className="text-[10px] text-muted-foreground">{formatRelativeIso(ev.created_at)}</span>
                        </div>
                        {ev.reason ? <div className="mt-0.5 italic">{ev.reason}</div> : null}
                      </li>
                    ))}
                  </ul>
                </CardContent>
              </Card>
            </div>
          </div>

          <ChangeTierDialog
            open={changeOpen}
            subscription={subscription}
            onClose={() => setChangeOpen(false)}
            onChanged={() => { void load() }}
          />
        </>
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
