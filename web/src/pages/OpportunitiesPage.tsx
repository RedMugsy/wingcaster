import { useEffect, useMemo, useState } from 'react'
import { DollarSign, Loader2, Plus, TrendingUp, Target, ChevronRight } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import { useToast } from '@/components/ui/toast'
import { useAuth } from '@/context/AuthContext'
import { api } from '@/api/client'
import { usePageTitle } from '@/lib/usePageTitle'
import { cn } from '@/lib/utils'
import { CrmShell } from '@/components/layout/CrmShell'
import { CmdPageHeader } from '@/components/layout/CmdPageHeader'
import { CmdKpiStrip } from '@/components/layout/CmdKpiStrip'
import { CmdEmptyState } from '@/components/layout/CmdEmptyState'

interface Opportunity {
  id: string
  contact_id: string
  property_id: string | null
  stage: string
  deal_value: number | null
  currency: string
  probability: number
  expected_close_date: string | null
  lost_reason: string
  closed_at: string | null
  notes: string
  created_at: string
  updated_at: string
}

const STAGES = ['new', 'qualification', 'viewing', 'offer', 'negotiation', 'closed_won', 'closed_lost']
const OPEN_STAGES = STAGES.filter((s) => !['closed_won', 'closed_lost'].includes(s))

const STAGE_STYLE: Record<string, { pill: string; header: string }> = {
  new: { pill: 'border-slate-200 bg-slate-50 text-slate-600', header: 'border-t-slate-300' },
  qualification: { pill: 'border-blue-200 bg-blue-50 text-blue-700', header: 'border-t-blue-400' },
  viewing: { pill: 'border-indigo-200 bg-indigo-50 text-indigo-700', header: 'border-t-indigo-400' },
  offer: { pill: 'border-amber-200 bg-amber-50 text-amber-700', header: 'border-t-amber-400' },
  negotiation: { pill: 'border-orange-200 bg-orange-50 text-orange-700', header: 'border-t-orange-400' },
  closed_won: { pill: 'border-green-200 bg-green-50 text-green-700', header: 'border-t-green-500' },
  closed_lost: { pill: 'border-red-200 bg-red-50 text-red-700', header: 'border-t-red-400' },
}

function stageLabel(s: string) {
  return s.replace(/_/g, ' ').replace(/^\w/, (c) => c.toUpperCase())
}

export function OpportunitiesPage() {
  const { agent } = useAuth()
  const { addToast } = useToast()
  usePageTitle('Opportunities')
  const [opportunities, setOpportunities] = useState<Opportunity[]>([])
  const [contacts, setContacts] = useState<any[]>([])
  const [loading, setLoading] = useState(true)
  const [creating, setCreating] = useState(false)
  const [showForm, setShowForm] = useState(false)
  const [stageFilter, setStageFilter] = useState<'open' | 'all' | string>('open')
  const [form, setForm] = useState({
    contact_id: '',
    stage: 'new',
    deal_value: '',
    expected_close_date: '',
    notes: '',
  })

  const loadAll = async () => {
    if (!agent) return
    try {
      const [opps, c] = await Promise.all([api.getOpportunities(), api.getContacts()])
      setOpportunities(opps || [])
      setContacts(c || [])
    } catch (e: any) {
      addToast({ title: 'Failed to load opportunities', description: e.message, variant: 'error' })
    }
  }

  useEffect(() => {
    setLoading(true)
    loadAll().finally(() => setLoading(false))
  }, [agent])

  const visibleStages = useMemo(() => {
    if (stageFilter === 'all') return STAGES
    if (stageFilter === 'open') return OPEN_STAGES
    return [stageFilter]
  }, [stageFilter])

  const grouped = useMemo(() => {
    const groups: Record<string, Opportunity[]> = {}
    STAGES.forEach((s) => (groups[s] = []))
    opportunities.forEach((o) => {
      if (!groups[o.stage]) groups[o.stage] = []
      groups[o.stage].push(o)
    })
    return groups
  }, [opportunities])

  const summary = useMemo(() => {
    const open = opportunities.filter((o) => OPEN_STAGES.includes(o.stage))
    const won = opportunities.filter((o) => o.stage === 'closed_won')
    const total = open.reduce((sum, o) => sum + (Number(o.deal_value) || 0), 0)
    const weighted = open.reduce(
      (sum, o) => sum + ((Number(o.deal_value) || 0) * (Number(o.probability) || 0)) / 100,
      0,
    )
    const wonValue = won.reduce((sum, o) => sum + (Number(o.deal_value) || 0), 0)
    return { total, weighted: Math.round(weighted), count: open.length, wonValue }
  }, [opportunities])

  const handleCreate = async () => {
    if (!form.contact_id) return
    setCreating(true)
    try {
      await api.createOpportunity({
        contact_id: form.contact_id,
        stage: form.stage,
        deal_value: form.deal_value ? Number(form.deal_value) : null,
        expected_close_date: form.expected_close_date ? new Date(form.expected_close_date).toISOString() : null,
        notes: form.notes,
      })
      setForm({ contact_id: '', stage: 'new', deal_value: '', expected_close_date: '', notes: '' })
      setShowForm(false)
      await loadAll()
      addToast({ title: 'Opportunity created', variant: 'success' })
    } catch (e: any) {
      addToast({ title: 'Failed to create opportunity', description: e.message, variant: 'error' })
    } finally {
      setCreating(false)
    }
  }

  const handleStageAdvance = async (o: Opportunity) => {
    const idx = STAGES.indexOf(o.stage)
    if (idx < 0 || idx >= STAGES.length - 1) return
    const next = STAGES[idx + 1]
    try {
      await api.updateOpportunity(o.id, { stage: next })
      setOpportunities((prev) => prev.map((x) => (x.id === o.id ? { ...x, stage: next } : x)))
    } catch (e: any) {
      addToast({ title: 'Failed to advance stage', description: e.message, variant: 'error' })
    }
  }

  const contactName = (id: string) => contacts.find((c) => c.id === id)?.name || 'Unknown'

  return (
    <CrmShell>
      <CmdPageHeader
        title="Opportunities"
        subtitle={`${summary.count} open deals`}
        actions={
          <Button size="sm" onClick={() => setShowForm((v) => !v)} className="gap-1.5">
            <Plus className="h-4 w-4" /> New deal
          </Button>
        }
      />

      <CmdKpiStrip
        items={[
          {
            label: 'Open pipeline',
            value: `$${summary.total.toLocaleString()}`,
            icon: <DollarSign className="h-4 w-4 text-muted-foreground" />,
          },
          {
            label: 'Weighted value',
            value: `$${summary.weighted.toLocaleString()}`,
            icon: <TrendingUp className="h-4 w-4 text-muted-foreground" />,
          },
          {
            label: 'Open deals',
            value: summary.count,
            icon: <Target className="h-4 w-4 text-muted-foreground" />,
          },
          {
            label: 'Won revenue',
            value: `$${summary.wonValue.toLocaleString()}`,
            valueClass: 'text-green-700',
            icon: <TrendingUp className="h-4 w-4 text-green-500" />,
          },
        ]}
      />

      {/* Quick-create form */}
      {showForm && (
        <div className="shrink-0 border-b border-[#E4E3E0] bg-white px-6 py-4">
          <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-start">
            <select
              className="h-10 min-w-[160px] flex-1 rounded-md border border-[#E4E3E0] bg-background px-2 text-sm"
              value={form.contact_id}
              onChange={(e) => setForm((f) => ({ ...f, contact_id: e.target.value }))}
            >
              <option value="">Select contact…</option>
              {contacts.map((c) => (
                <option key={c.id} value={c.id}>{c.name}</option>
              ))}
            </select>
            <select
              className="h-10 w-36 shrink-0 rounded-md border border-[#E4E3E0] bg-background px-2 text-sm"
              value={form.stage}
              onChange={(e) => setForm((f) => ({ ...f, stage: e.target.value }))}
            >
              {STAGES.map((s) => <option key={s} value={s}>{stageLabel(s)}</option>)}
            </select>
            <Input
              placeholder="Deal value ($)"
              type="number"
              className="h-10 w-36 shrink-0"
              value={form.deal_value}
              onChange={(e) => setForm((f) => ({ ...f, deal_value: e.target.value }))}
            />
            <Input
              type="date"
              className="h-10 w-36 shrink-0"
              value={form.expected_close_date}
              onChange={(e) => setForm((f) => ({ ...f, expected_close_date: e.target.value }))}
            />
            <div className="flex gap-2">
              <Button size="sm" onClick={handleCreate} disabled={creating || !form.contact_id}>
                {creating ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Save'}
              </Button>
              <Button size="sm" variant="ghost" onClick={() => setShowForm(false)}>Cancel</Button>
            </div>
          </div>
        </div>
      )}

      {/* Stage filter */}
      <div className="flex shrink-0 items-center gap-2 border-b border-[#E4E3E0] bg-white px-6 py-2">
        {[
          { label: 'Open', value: 'open' },
          { label: 'All', value: 'all' },
          ...STAGES.map((s) => ({ label: stageLabel(s), value: s })),
        ].map((f) => (
          <button
            key={f.value}
            onClick={() => setStageFilter(f.value)}
            className={cn(
              'rounded-md px-3 py-1 text-xs font-medium capitalize transition-colors',
              stageFilter === f.value
                ? 'bg-[#0F0F0F] text-white'
                : 'text-muted-foreground hover:bg-[#F0EFED] hover:text-foreground',
            )}
          >
            {f.label}
          </button>
        ))}
      </div>

      {/* Kanban board */}
      <div className="flex-1 overflow-auto p-6">
        {loading ? (
          <div className="flex justify-center py-16">
            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
          </div>
        ) : opportunities.length === 0 ? (
          <CmdEmptyState
            icon={<TrendingUp className="h-8 w-8" />}
            title="No deals yet"
            description="Create your first deal above or complete a viewing with 'Interested' outcome."
            action={
              <Button size="sm" onClick={() => setShowForm(true)} className="gap-1.5">
                <Plus className="h-4 w-4" /> New deal
              </Button>
            }
          />
        ) : (
          <div className="flex gap-4 overflow-x-auto pb-4">
            {visibleStages.map((stage) => {
              const cards = grouped[stage] || []
              const style = STAGE_STYLE[stage] || { pill: '', header: '' }
              return (
                <div key={stage} className="w-60 shrink-0">
                  {/* Column header */}
                  <div className={cn('mb-3 flex items-center justify-between rounded-t-md border-t-[3px] bg-white px-3 py-2.5 shadow-sm', style.header)}>
                    <span className="text-xs font-semibold capitalize">{stageLabel(stage)}</span>
                    <Badge variant="outline" className={cn('text-[10px]', style.pill)}>{cards.length}</Badge>
                  </div>

                  {/* Cards */}
                  <div className="space-y-2">
                    {cards.length === 0 && (
                      <div className="rounded-md border border-dashed border-[#E4E3E0] px-3 py-4 text-center">
                        <p className="text-[11px] text-muted-foreground">No deals</p>
                      </div>
                    )}
                    {cards.map((o) => {
                      const isLast = STAGES.indexOf(o.stage) >= STAGES.length - 1
                      return (
                        <div
                          key={o.id}
                          className="group rounded-md border border-[#E4E3E0] bg-white p-3 shadow-sm transition-shadow hover:shadow-md"
                        >
                          <div className="flex items-start justify-between gap-2">
                            <p className="text-sm font-medium leading-snug">{contactName(o.contact_id)}</p>
                            <Badge variant="outline" className="shrink-0 text-[10px]">{o.probability}%</Badge>
                          </div>
                          {o.deal_value != null && (
                            <p className="mt-1 text-sm font-semibold text-[#0F0F0F]">
                              ${Number(o.deal_value).toLocaleString()}
                              <span className="ml-1 text-[10px] font-normal text-muted-foreground">{o.currency}</span>
                            </p>
                          )}
                          {o.expected_close_date && (
                            <p className="mt-0.5 text-[11px] text-muted-foreground">
                              Close: {new Date(o.expected_close_date).toLocaleDateString()}
                            </p>
                          )}
                          {/* One-click advance */}
                          {!isLast && (
                            <button
                              onClick={() => handleStageAdvance(o)}
                              className="mt-2.5 flex w-full items-center justify-center gap-1 rounded-md border border-[#E4E3E0] py-1.5 text-[11px] font-medium text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100 hover:bg-[#F0EFED]"
                            >
                              Advance <ChevronRight className="h-3 w-3" />
                            </button>
                          )}
                        </div>
                      )
                    })}
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </div>
    </CrmShell>
  )
}
