import { useEffect, useMemo, useState } from 'react'
import { api } from '@/api/client'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { formatCurrencyMinor } from '@/components/commercial-pricing/helpers'
import type { CoreRateCard } from '@/types/commercialPricing'
import { Lock } from 'lucide-react'

interface RateCardEditorProps {
  card: CoreRateCard
  onUpdated: (card: CoreRateCard) => void
  onActivated: (card: CoreRateCard) => void
}

const GROUP_ORDER = [
  'publish',
  'message.out',
  'message.in',
  'ai',
  'render',
  'score',
  'avm',
  'staging',
  'webhook',
  'listing',
  'storage',
  'seat',
  'support',
] as const

export function groupActionKey(actionKey: string): string {
  for (const prefix of GROUP_ORDER) {
    if (actionKey === prefix || actionKey.startsWith(`${prefix}.`)) return prefix
  }
  const dot = actionKey.indexOf('.')
  return dot === -1 ? actionKey : actionKey.slice(0, dot)
}

export function groupRates(rates: Record<string, number>): Record<string, Array<[string, number]>> {
  const buckets: Record<string, Array<[string, number]>> = {}
  for (const [key, casts] of Object.entries(rates)) {
    const group = groupActionKey(key)
    if (!buckets[group]) buckets[group] = []
    buckets[group].push([key, casts])
  }
  for (const list of Object.values(buckets)) {
    list.sort(([a], [b]) => a.localeCompare(b))
  }
  return buckets
}

export function RateCardEditor({ card, onUpdated, onActivated }: RateCardEditorProps) {
  const [name, setName] = useState(card.name)
  const [description, setDescription] = useState(card.description || '')
  const [currency, setCurrency] = useState(card.currency)
  const [castValueMinor, setCastValueMinor] = useState<number>(card.cast_value_minor)
  const [rates, setRates] = useState<Record<string, number>>({ ...card.rates })
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [activateConfirmOpen, setActivateConfirmOpen] = useState(false)
  const [activating, setActivating] = useState(false)

  useEffect(() => {
    setName(card.name)
    setDescription(card.description || '')
    setCurrency(card.currency)
    setCastValueMinor(card.cast_value_minor)
    setRates({ ...card.rates })
    setError(null)
  }, [card.id])

  const locked = card.is_active
  const grouped = useMemo(() => groupRates(rates), [rates])
  const groups = Object.keys(grouped).sort(sortGroups)

  async function handleSave() {
    setSaving(true)
    setError(null)
    try {
      const { card: updated } = await api.updateAdminRateCard(card.id, {
        name,
        description: description || null,
        currency,
        cast_value_minor: Math.max(1, Math.round(castValueMinor)),
        rates,
      })
      onUpdated(updated)
    } catch (err: any) {
      setError(err?.message || 'Failed to save changes')
    } finally {
      setSaving(false)
    }
  }

  async function handleActivate() {
    setActivating(true)
    try {
      const { active } = await api.activateAdminRateCard(card.id)
      onActivated(active)
      setActivateConfirmOpen(false)
    } catch (err: any) {
      setError(err?.message || 'Activation failed')
    } finally {
      setActivating(false)
    }
  }

  const castValueDollarsInput = (castValueMinor / 100).toFixed(2)

  return (
    <Card>
      <CardHeader>
        <div className="flex items-start justify-between gap-3">
          <div>
            <CardTitle className="text-base">
              v{card.version} — {card.name}
            </CardTitle>
            <div className="mt-1 flex items-center gap-2 text-xs text-muted-foreground">
              {card.is_active ? <Badge className="bg-emerald-500/15 text-emerald-700 border-emerald-500/30" variant="outline">Active</Badge> : <Badge variant="outline">Draft</Badge>}
              {card.activated_at ? <span>Activated {new Date(card.activated_at).toLocaleDateString()}</span> : null}
              {card.created_by ? <span>· by {card.created_by}</span> : null}
            </div>
          </div>
          {locked ? (
            <div className="flex items-center gap-1 rounded-md border border-amber-200 bg-amber-50 px-2 py-1 text-xs text-amber-800">
              <Lock className="h-3 w-3" />
              Locked (active version — create a new draft to change rates)
            </div>
          ) : null}
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid grid-cols-2 gap-3">
          <div>
            <Label htmlFor="rc-name">Name</Label>
            <Input id="rc-name" disabled={locked} value={name} onChange={(e) => setName(e.target.value)} />
          </div>
          <div>
            <Label htmlFor="rc-currency">Currency</Label>
            <Input
              id="rc-currency"
              disabled={locked}
              maxLength={3}
              value={currency}
              onChange={(e) => setCurrency(e.target.value.toUpperCase())}
            />
          </div>
          <div className="col-span-2">
            <Label htmlFor="rc-desc">Description</Label>
            <Input id="rc-desc" disabled={locked} value={description} onChange={(e) => setDescription(e.target.value)} />
          </div>
          <div>
            <Label htmlFor="rc-cast">Cast value ($ per cast)</Label>
            <Input
              id="rc-cast"
              type="number"
              min="0.01"
              step="0.01"
              disabled={locked}
              value={castValueDollarsInput}
              onChange={(e) => {
                const dollars = Number(e.target.value)
                if (Number.isFinite(dollars) && dollars > 0) setCastValueMinor(Math.round(dollars * 100))
              }}
            />
            <p className="mt-1 text-xs text-muted-foreground">Stored as {castValueMinor} minor units.</p>
          </div>
        </div>

        <div className="space-y-4">
          <h3 className="text-sm font-semibold">Action rates (casts per action)</h3>
          {groups.map((group) => (
            <div key={group} className="rounded-md border">
              <div className="border-b bg-muted/30 px-3 py-1 text-xs font-medium uppercase text-muted-foreground">
                {group}
              </div>
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-xs text-muted-foreground">
                    <th className="px-3 py-1 font-normal">Action key</th>
                    <th className="px-3 py-1 text-right font-normal">Casts</th>
                    <th className="px-3 py-1 text-right font-normal">Effective price (1×)</th>
                  </tr>
                </thead>
                <tbody>
                  {grouped[group].map(([key, casts]) => {
                    const priceMinor = Number(casts) * castValueMinor
                    return (
                      <tr key={key} className="border-t">
                        <td className="px-3 py-1 font-mono text-xs">{key}</td>
                        <td className="px-3 py-1 text-right">
                          <Input
                            className="ml-auto h-7 w-20 text-right"
                            type="number"
                            min={0}
                            step={1}
                            disabled={locked}
                            value={casts}
                            onChange={(e) => {
                              const n = Number(e.target.value)
                              if (!Number.isFinite(n) || n < 0) return
                              setRates((prev) => ({ ...prev, [key]: Math.round(n) }))
                            }}
                          />
                        </td>
                        <td className="px-3 py-1 text-right tabular-nums text-xs">
                          {formatCurrencyMinor(priceMinor, currency)}
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          ))}
        </div>

        {error ? <p className="text-sm text-red-600">{error}</p> : null}

        <div className="flex flex-wrap items-center justify-end gap-2">
          {!locked ? (
            <>
              <Button variant="outline" onClick={handleSave} disabled={saving}>{saving ? 'Saving…' : 'Save changes'}</Button>
              <Button onClick={() => setActivateConfirmOpen(true)} disabled={saving || activating}>
                Activate this version
              </Button>
            </>
          ) : (
            <p className="text-xs text-muted-foreground">This rate card is active. Create a new version to make changes.</p>
          )}
        </div>
      </CardContent>

      <Dialog open={activateConfirmOpen} onOpenChange={(next) => { if (!next && !activating) setActivateConfirmOpen(false) }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Activate v{card.version} — {card.name}?</DialogTitle>
            <DialogDescription>
              This will deactivate the currently active rate card. New usage events will resolve against this version
              from now. Existing subscriptions pinned to a prior version stay on that version.
            </DialogDescription>
          </DialogHeader>
          <div className="flex justify-end gap-2 pt-2">
            <Button variant="outline" onClick={() => setActivateConfirmOpen(false)} disabled={activating}>Cancel</Button>
            <Button onClick={handleActivate} disabled={activating}>{activating ? 'Activating…' : 'Activate'}</Button>
          </div>
        </DialogContent>
      </Dialog>
    </Card>
  )
}

function sortGroups(a: string, b: string): number {
  const ia = (GROUP_ORDER as readonly string[]).indexOf(a)
  const ib = (GROUP_ORDER as readonly string[]).indexOf(b)
  const posA = ia === -1 ? Number.MAX_SAFE_INTEGER : ia
  const posB = ib === -1 ? Number.MAX_SAFE_INTEGER : ib
  if (posA !== posB) return posA - posB
  return a.localeCompare(b)
}
