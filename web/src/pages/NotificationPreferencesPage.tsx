import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { api } from '@/api/client'
import { useAuth } from '@/context/AuthContext'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { formatRelativeIso } from '@/components/commercial-pricing/subscription-helpers'
import type { NotificationEventRow, NotificationPreferenceRow } from '@/types/commercialPricing'

const EVENT_LABELS: Record<string, string> = {
  'subscription.trial_ending': 'Trial ending soon',
  'subscription.trial_ended': 'Trial ended',
  'subscription.renewed': 'Renewal successful',
  'subscription.past_due': 'Past due (action required)',
  'subscription.reactivated': 'Subscription reactivated',
  'subscription.cancelled_at_period_end': 'Cancellation scheduled',
  'subscription.cancelled_immediately': 'Cancellation confirmation',
  'subscription.expired': 'Subscription ended',
  'subscription.paused': 'Subscription paused',
  'subscription.resumed': 'Subscription resumed',
  'subscription.upgraded': 'Plan upgraded',
  'subscription.downgraded': 'Plan downgraded',
  'subscription.migrated_version': 'Plan version migrated',
  'subscription.grandfathered': 'New plan version available',
  'credit_note.issued': 'Credit note issued',
}

export function NotificationPreferencesPage() {
  const { agent } = useAuth()
  const [prefs, setPrefs] = useState<NotificationPreferenceRow[]>([])
  const [history, setHistory] = useState<NotificationEventRow[]>([])
  const [pendingChanges, setPendingChanges] = useState<Record<string, boolean>>({})
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [status, setStatus] = useState<string | null>(null)

  useEffect(() => { if (agent) void load() }, [agent?.id])

  async function load() {
    setLoading(true)
    setError(null)
    try {
      const [prefRes, histRes] = await Promise.all([
        api.getMyNotificationPreferences(),
        api.getMyNotificationHistory(50),
      ])
      setPrefs(prefRes.preferences)
      setHistory(histRes.events)
      setPendingChanges({})
    } catch (err: any) {
      setError(err?.message || 'Failed to load preferences')
    } finally {
      setLoading(false)
    }
  }

  const keyOf = (eventKind: string, channel: string) => `${eventKind}|${channel}`

  function toggle(eventKind: string, channel: string, currentEnabled: boolean) {
    const key = keyOf(eventKind, channel)
    setPendingChanges((prev) => {
      const next = { ...prev }
      const currentUnchanged = next[key] === undefined
      // If reverting to server state, drop the pending entry.
      if (!currentUnchanged && next[key] === currentEnabled) {
        delete next[key]
        return next
      }
      next[key] = !currentEnabled
      return next
    })
  }

  async function save() {
    if (Object.keys(pendingChanges).length === 0) return
    setSaving(true)
    setError(null)
    setStatus(null)
    try {
      const updates = Object.entries(pendingChanges).map(([key, enabled]) => {
        const [event_kind, channel] = key.split('|')
        return { event_kind, channel, enabled }
      })
      await api.updateMyNotificationPreferences(updates)
      setStatus(`Saved ${updates.length} preference change(s).`)
      await load()
    } catch (err: any) {
      setError(err?.message || 'Save failed')
    } finally {
      setSaving(false)
    }
  }

  const displayValue = (row: NotificationPreferenceRow) => {
    const key = keyOf(row.event_kind, row.channel)
    if (key in pendingChanges) return pendingChanges[key]
    return row.enabled
  }

  const grouped = useMemo(() => {
    const byKind: Record<string, NotificationPreferenceRow[]> = {}
    for (const row of prefs) {
      if (!byKind[row.event_kind]) byKind[row.event_kind] = []
      byKind[row.event_kind].push(row)
    }
    return byKind
  }, [prefs])

  if (!agent) {
    return (
      <div className="container mx-auto max-w-2xl px-4 py-8">
        <Card>
          <CardHeader><CardTitle>Sign in required</CardTitle></CardHeader>
          <CardContent className="text-sm text-muted-foreground">
            <Link to="/login" className="underline">Sign in</Link> to manage your notification preferences.
          </CardContent>
        </Card>
      </div>
    )
  }

  const changedCount = Object.keys(pendingChanges).length

  return (
    <div className="container mx-auto px-4 py-8">
      <div className="mb-6">
        <h1 className="text-2xl font-bold">Notification Preferences</h1>
        <p className="text-sm text-muted-foreground">
          Turn individual notifications on or off. New event kinds we add later default to ON —
          come back here if you want to opt out.
        </p>
      </div>

      {error ? <p className="mb-3 text-sm text-red-600">{error}</p> : null}
      {status ? <p className="mb-3 rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-800">{status}</p> : null}
      {loading ? <p className="text-sm text-muted-foreground">Loading…</p> : null}

      <div className="grid gap-6 lg:grid-cols-3">
        <div className="lg:col-span-2">
          <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0">
              <CardTitle className="text-base">Email notifications</CardTitle>
              <Button size="sm" onClick={save} disabled={saving || changedCount === 0}>
                {saving ? 'Saving…' : changedCount > 0 ? `Save (${changedCount})` : 'Saved'}
              </Button>
            </CardHeader>
            <CardContent className="space-y-2">
              {Object.entries(grouped).map(([eventKind, rows]) => (
                <div key={eventKind} className="flex items-center justify-between rounded-md border p-3">
                  <div>
                    <div className="text-sm font-medium">{EVENT_LABELS[eventKind] || eventKind}</div>
                    <div className="text-xs font-mono text-muted-foreground">{eventKind}</div>
                  </div>
                  {rows.map((row) => {
                    const key = keyOf(row.event_kind, row.channel)
                    const isPending = key in pendingChanges
                    const value = displayValue(row)
                    return (
                      <label key={row.channel} className="flex cursor-pointer items-center gap-2 text-sm">
                        <input
                          type="checkbox"
                          checked={value}
                          onChange={() => toggle(row.event_kind, row.channel, row.enabled)}
                        />
                        <span className={isPending ? 'italic underline decoration-dotted' : ''}>
                          {value ? 'On' : 'Off'}
                        </span>
                      </label>
                    )
                  })}
                </div>
              ))}
            </CardContent>
          </Card>
        </div>

        <div className="lg:col-span-1">
          <Card>
            <CardHeader className="pb-2"><CardTitle className="text-sm">Recent notifications ({history.length})</CardTitle></CardHeader>
            <CardContent className="p-0">
              {history.length === 0 ? (
                <p className="p-4 text-sm text-muted-foreground">Nothing sent to you yet.</p>
              ) : (
                <ul className="divide-y max-h-[70vh] overflow-y-auto">
                  {history.map((ev) => (
                    <li key={ev.id} className="px-4 py-2 text-xs">
                      <div className="flex items-center justify-between">
                        <span className="font-medium">{EVENT_LABELS[ev.event_kind] || ev.event_kind}</span>
                        <span className="text-[10px] text-muted-foreground">{formatRelativeIso(ev.created_at)}</span>
                      </div>
                      {ev.subject ? <div className="mt-0.5 text-muted-foreground italic">{ev.subject}</div> : null}
                      <div className="mt-0.5 flex gap-1">
                        {(ev.deliveries_sent ?? 0) > 0 ? <Badge variant="outline" className="text-[9px] border-emerald-300 text-emerald-700">sent {ev.deliveries_sent}</Badge> : null}
                        {(ev.deliveries_skipped ?? 0) > 0 ? <Badge variant="outline" className="text-[9px]">skipped {ev.deliveries_skipped}</Badge> : null}
                        {(ev.deliveries_failed ?? 0) > 0 ? <Badge variant="outline" className="text-[9px] border-rose-300 text-rose-700">failed {ev.deliveries_failed}</Badge> : null}
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  )
}
