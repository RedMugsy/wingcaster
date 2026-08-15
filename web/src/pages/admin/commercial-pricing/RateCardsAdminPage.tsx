import { useEffect, useMemo, useState } from 'react'
import { api } from '@/api/client'
import { useAuth } from '@/context/AuthContext'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { RateCardEditor } from './RateCardEditor'
import type { CoreRateCard } from '@/types/commercialPricing'

export function sortRateCards(cards: CoreRateCard[], activeId: string | null): CoreRateCard[] {
  return [...cards].sort((a, b) => {
    if (a.id === activeId && b.id !== activeId) return -1
    if (b.id === activeId && a.id !== activeId) return 1
    return b.version - a.version
  })
}

export function RateCardsAdminPage() {
  const { isAdmin } = useAuth()
  const [cards, setCards] = useState<CoreRateCard[]>([])
  const [activeId, setActiveId] = useState<string | null>(null)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [newOpen, setNewOpen] = useState(false)

  useEffect(() => { if (isAdmin) void load() }, [isAdmin])

  async function load() {
    setLoading(true)
    setError(null)
    try {
      const { cards, active_id } = await api.listAdminRateCards()
      setCards(cards)
      setActiveId(active_id)
      if (!selectedId && cards.length > 0) {
        setSelectedId(active_id || cards[0].id)
      }
    } catch (err: any) {
      setError(err?.message || 'Failed to load rate cards')
    } finally {
      setLoading(false)
    }
  }

  const sorted = useMemo(() => sortRateCards(cards, activeId), [cards, activeId])
  const selected = useMemo(() => sorted.find((c) => c.id === selectedId) || null, [sorted, selectedId])
  const activeCard = useMemo(() => cards.find((c) => c.id === activeId) || null, [cards, activeId])

  function handleCardUpdated(updated: CoreRateCard) {
    setCards((prev) => prev.map((c) => (c.id === updated.id ? updated : c)))
  }

  function handleCardActivated(activated: CoreRateCard) {
    void load().then(() => setSelectedId(activated.id))
  }

  if (!isAdmin) {
    return (
      <div className="container mx-auto max-w-2xl px-4 py-8">
        <Card>
          <CardHeader><CardTitle>Platform admin required</CardTitle></CardHeader>
          <CardContent className="text-sm text-muted-foreground">
            Rate-card configuration is restricted to platform admins.
          </CardContent>
        </Card>
      </div>
    )
  }

  return (
    <div className="container mx-auto px-4 py-8">
      <div className="mb-6 flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold">Commercial Rate Cards</h1>
          <p className="text-sm text-muted-foreground">
            Version-pinned casts-per-action + base cast value. Exactly one may be active.
          </p>
        </div>
        <Button onClick={() => setNewOpen(true)}>+ New Version</Button>
      </div>

      {error ? <p className="mb-3 text-sm text-red-600">{error}</p> : null}

      <div className="grid gap-6 lg:grid-cols-3">
        <div className="lg:col-span-1">
          <Card>
            <CardHeader><CardTitle className="text-sm">Versions</CardTitle></CardHeader>
            <CardContent className="p-0">
              {loading ? (
                <p className="p-4 text-sm text-muted-foreground">Loading…</p>
              ) : sorted.length === 0 ? (
                <p className="p-4 text-sm text-muted-foreground">No rate cards yet.</p>
              ) : (
                <ul className="divide-y">
                  {sorted.map((card) => {
                    const isSelected = selectedId === card.id
                    const isActive = card.id === activeId
                    return (
                      <li
                        key={card.id}
                        onClick={() => setSelectedId(card.id)}
                        className={
                          'cursor-pointer px-4 py-3 text-sm ' +
                          (isSelected ? 'bg-muted/60' : 'hover:bg-muted/30')
                        }
                      >
                        <div className="flex items-center justify-between">
                          <div className="font-mono text-xs font-semibold">v{card.version}</div>
                          {isActive ? (
                            <Badge className="bg-emerald-500/15 text-emerald-700 border-emerald-500/30" variant="outline">Active</Badge>
                          ) : (
                            <Badge variant="outline">Draft</Badge>
                          )}
                        </div>
                        <div className="mt-1 truncate">{card.name}</div>
                        <div className="mt-0.5 text-xs text-muted-foreground">
                          {card.currency} · ${(card.cast_value_minor / 100).toFixed(4)} / cast
                        </div>
                      </li>
                    )
                  })}
                </ul>
              )}
            </CardContent>
          </Card>
        </div>

        <div className="lg:col-span-2">
          {selected ? (
            <RateCardEditor
              key={selected.id}
              card={selected}
              onUpdated={handleCardUpdated}
              onActivated={handleCardActivated}
            />
          ) : (
            <Card>
              <CardContent className="py-12 text-center text-sm text-muted-foreground">
                Select a rate card version on the left.
              </CardContent>
            </Card>
          )}
        </div>
      </div>

      <NewRateCardDialog
        open={newOpen}
        seedCard={activeCard}
        onClose={() => setNewOpen(false)}
        onCreated={(card) => {
          setNewOpen(false)
          void load().then(() => setSelectedId(card.id))
        }}
      />
    </div>
  )
}

interface NewRateCardDialogProps {
  open: boolean
  seedCard: CoreRateCard | null
  onClose: () => void
  onCreated: (card: CoreRateCard) => void
}

function NewRateCardDialog({ open, seedCard, onClose, onCreated }: NewRateCardDialogProps) {
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [currency, setCurrency] = useState(seedCard?.currency || 'USD')
  const [castValueDollars, setCastValueDollars] = useState(String(((seedCard?.cast_value_minor ?? 10) / 100).toFixed(2)))
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (open) {
      setName('')
      setDescription('')
      setCurrency(seedCard?.currency || 'USD')
      setCastValueDollars(String(((seedCard?.cast_value_minor ?? 10) / 100).toFixed(2)))
      setError(null)
    }
  }, [open, seedCard?.id])

  async function handleSave() {
    if (!name.trim()) { setError('Name is required'); return }
    const dollars = Number(castValueDollars)
    if (!Number.isFinite(dollars) || dollars <= 0) { setError('Cast value must be a positive number'); return }
    if (!/^[A-Z]{3}$/.test(currency)) { setError('Currency must be 3 uppercase letters'); return }

    setSaving(true)
    setError(null)
    try {
      const { card } = await api.createAdminRateCard({
        name,
        description: description || null,
        currency,
        cast_value_minor: Math.round(dollars * 100),
        rates: seedCard?.rates || {},
      })
      onCreated(card)
    } catch (err: any) {
      setError(err?.message || 'Failed to create rate card')
    } finally {
      setSaving(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={(next) => { if (!next && !saving) onClose() }}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>New Rate Card Version</DialogTitle>
          <DialogDescription>
            {seedCard
              ? `Clones the action rates from v${seedCard.version}. You can edit rates on the new draft before activating.`
              : 'No active rate card yet — starts with an empty rates map.'}
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div>
            <Label htmlFor="new-rc-name">Name</Label>
            <Input id="new-rc-name" value={name} onChange={(e) => setName(e.target.value)} />
          </div>
          <div>
            <Label htmlFor="new-rc-desc">Description (optional)</Label>
            <Input id="new-rc-desc" value={description} onChange={(e) => setDescription(e.target.value)} />
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div>
              <Label htmlFor="new-rc-currency">Currency</Label>
              <Input
                id="new-rc-currency"
                maxLength={3}
                value={currency}
                onChange={(e) => setCurrency(e.target.value.toUpperCase())}
              />
            </div>
            <div>
              <Label htmlFor="new-rc-cast">Cast value ($)</Label>
              <Input
                id="new-rc-cast"
                type="number"
                min="0.01"
                step="0.01"
                value={castValueDollars}
                onChange={(e) => setCastValueDollars(e.target.value)}
              />
            </div>
          </div>
        </div>
        {error ? <p className="text-sm text-red-600">{error}</p> : null}
        <div className="flex justify-end gap-2 pt-2">
          <Button variant="outline" onClick={onClose} disabled={saving}>Cancel</Button>
          <Button onClick={handleSave} disabled={saving}>{saving ? 'Creating…' : 'Create draft'}</Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}
