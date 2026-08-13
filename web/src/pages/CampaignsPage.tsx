/**
 * CampaignsPage — Gateway for Concept C / Guided Workflow Studio.
 * Phase 1: CRUD list of campaigns with enrollment status.
 * Phase 2: Visual builder will be a separate route /campaigns/:id/builder.
 */
import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import {
  Loader2,
  Megaphone,
  Plus,
  Play,
  Pause,
  Trash2,
  Users,
  Mail,
  MessageSquare,
  Phone,
  ChevronRight,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
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

interface Campaign {
  id: string
  name: string
  description: string
  status: 'draft' | 'active' | 'paused' | 'archived'
  trigger: string
  target_channel: string
  steps: any[]
  tags_filter: string[]
  created_at: string
  updated_at: string
}

const STATUS_STYLE: Record<string, string> = {
  draft: 'border-slate-200 bg-slate-50 text-slate-600',
  active: 'border-green-200 bg-green-50 text-green-700',
  paused: 'border-amber-200 bg-amber-50 text-amber-700',
  archived: 'border-slate-200 bg-slate-50 text-slate-400',
}

const CHANNEL_ICON: Record<string, React.ReactNode> = {
  email: <Mail className="h-3.5 w-3.5" />,
  whatsapp: <MessageSquare className="h-3.5 w-3.5" />,
  sms: <Phone className="h-3.5 w-3.5" />,
}

export function CampaignsPage() {
  const { agent } = useAuth()
  const { addToast } = useToast()
  usePageTitle('Campaigns')
  const [campaigns, setCampaigns] = useState<Campaign[]>([])
  const [loading, setLoading] = useState(true)
  const [toggling, setToggling] = useState<string | null>(null)

  useEffect(() => {
    if (!agent) return
    setLoading(true)
    api.getCampaigns()
      .then((data: Campaign[]) => setCampaigns(data || []))
      .catch((e: any) => addToast({ title: 'Failed to load campaigns', description: e.message, variant: 'error' }))
      .finally(() => setLoading(false))
  }, [agent])

  const handleToggle = async (c: Campaign) => {
    const next = c.status === 'active' ? 'paused' : 'active'
    setToggling(c.id)
    try {
      await api.updateCampaign(c.id, { status: next })
      setCampaigns((prev) => prev.map((x) => (x.id === c.id ? { ...x, status: next as Campaign['status'] } : x)))
    } catch (e: any) {
      addToast({ title: 'Failed to update campaign', description: e.message, variant: 'error' })
    } finally {
      setToggling(null)
    }
  }

  const handleDelete = async (id: string) => {
    if (!confirm('Delete this campaign?')) return
    try {
      await api.deleteCampaign(id)
      setCampaigns((prev) => prev.filter((c) => c.id !== id))
      addToast({ title: 'Campaign deleted', variant: 'success' })
    } catch (e: any) {
      addToast({ title: 'Failed to delete campaign', description: e.message, variant: 'error' })
    }
  }

  const counts = {
    active: campaigns.filter((c) => c.status === 'active').length,
    draft: campaigns.filter((c) => c.status === 'draft').length,
    total: campaigns.length,
  }

  return (
    <CrmShell>
      <CmdPageHeader
        title="Campaigns"
        subtitle="Drip sequences and nurture journeys"
        actions={
          <Link to="/campaigns/new">
            <Button size="sm" className="gap-1.5">
              <Plus className="h-4 w-4" /> New campaign
            </Button>
          </Link>
        }
      />

      <CmdKpiStrip
        items={[
          { label: 'Total campaigns', value: counts.total, icon: <Megaphone className="h-4 w-4 text-muted-foreground" /> },
          {
            label: 'Active',
            value: counts.active,
            valueClass: counts.active > 0 ? 'text-green-700' : undefined,
            icon: <Play className="h-4 w-4 text-muted-foreground" />,
          },
          { label: 'Draft', value: counts.draft, icon: <Pause className="h-4 w-4 text-muted-foreground" /> },
          {
            label: 'Contacts enrolled',
            value: '—',
            icon: <Users className="h-4 w-4 text-muted-foreground" />,
          },
        ]}
      />

      {/* Campaign builder callout */}
      <div className="shrink-0 border-b border-[#E4E3E0] bg-[#FAFAF9] px-6 py-3">
        <div className="flex items-center justify-between gap-4">
          <div>
            <p className="text-sm font-medium">Visual Workflow Builder</p>
            <p className="text-xs text-muted-foreground">
              Design multi-step omnichannel journeys with branching and simulation — coming in Phase 2.
            </p>
          </div>
          <Badge variant="outline" className="shrink-0 border-blue-200 bg-blue-50 text-blue-700">Roadmap</Badge>
        </div>
      </div>

      {/* Campaign list */}
      <div className="flex-1 overflow-y-auto">
        {loading ? (
          <div className="flex justify-center py-16">
            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
          </div>
        ) : campaigns.length === 0 ? (
          <CmdEmptyState
            icon={<Megaphone className="h-8 w-8" />}
            title="No campaigns yet"
            description="Create your first campaign to start nurturing leads automatically."
            action={
              <Link to="/campaigns/new">
                <Button size="sm" className="gap-1.5">
                  <Plus className="h-4 w-4" /> New campaign
                </Button>
              </Link>
            }
          />
        ) : (
          <div className="divide-y divide-[#E4E3E0]">
            {campaigns.map((c) => (
              <div
                key={c.id}
                className="flex items-center gap-4 bg-white px-6 py-4 transition-colors hover:bg-[#F8F8F7]"
              >
                {/* Channel icon */}
                <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-[#F0EFED] text-muted-foreground">
                  {CHANNEL_ICON[c.target_channel] ?? <Megaphone className="h-3.5 w-3.5" />}
                </div>

                {/* Name + meta */}
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-medium">{c.name}</span>
                    <Badge variant="outline" className={cn('text-[10px] capitalize', STATUS_STYLE[c.status])}>
                      {c.status}
                    </Badge>
                  </div>
                  <div className="mt-0.5 flex items-center gap-3 text-[11px] text-muted-foreground">
                    <span>{c.steps.length} step{c.steps.length !== 1 ? 's' : ''}</span>
                    <span>·</span>
                    <span className="capitalize">{c.trigger.replace(/_/g, ' ')}</span>
                    {c.tags_filter.length > 0 && (
                      <>
                        <span>·</span>
                        <span>{c.tags_filter.join(', ')}</span>
                      </>
                    )}
                  </div>
                </div>

                {/* Actions */}
                <div className="flex shrink-0 items-center gap-1">
                  {c.status !== 'archived' && (
                    <button
                      onClick={() => handleToggle(c)}
                      disabled={toggling === c.id}
                      className="flex h-8 w-8 items-center justify-center rounded-md text-muted-foreground hover:bg-[#F0EFED]"
                      title={c.status === 'active' ? 'Pause' : 'Activate'}
                    >
                      {toggling === c.id ? (
                        <Loader2 className="h-3.5 w-3.5 animate-spin" />
                      ) : c.status === 'active' ? (
                        <Pause className="h-3.5 w-3.5" />
                      ) : (
                        <Play className="h-3.5 w-3.5" />
                      )}
                    </button>
                  )}
                  <button
                    onClick={() => handleDelete(c.id)}
                    className="flex h-8 w-8 items-center justify-center rounded-md text-muted-foreground hover:bg-red-50 hover:text-red-600"
                    title="Delete"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                  <Link
                    to={`/campaigns/${c.id}`}
                    className="flex h-8 w-8 items-center justify-center rounded-md text-muted-foreground hover:bg-[#F0EFED]"
                  >
                    <ChevronRight className="h-4 w-4" />
                  </Link>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </CrmShell>
  )
}
