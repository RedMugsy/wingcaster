import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { ArrowLeft, BarChart3, Loader2, TrendingUp, Users, MessageSquare, CheckCircle2, Clock, DollarSign, Target } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { useToast } from '@/components/ui/toast'
import { useAuth } from '@/context/AuthContext'
import { api } from '@/api/client'
import { usePageTitle } from '@/lib/usePageTitle'
import { HorizontalBarChart } from '@/components/dashboard/HorizontalBarChart'

interface CrmAnalytics {
  generated_at: string
  scope: { agent_id: string | null; agency_id: string | null; start_date: string | null; end_date: string | null }
  summary: {
    contacts_created: number
    opportunities_created: number
    open_opportunities: number
    closed_won: number
    closed_lost: number
    win_rate: number | null
    conversion_rate: number | null
    total_pipeline_value: number
    weighted_pipeline_value: number
    total_tasks: number
    completed_tasks: number
    pending_tasks: number
    overdue_tasks: number
    task_completion_rate: number | null
    task_overdue_rate: number | null
    viewings_total: number
  }
  pipeline: { total_opportunities: number; total_value: number; weighted_value: number; by_stage: Record<string, number> }
  lead_sources: { label: string; value: number }[]
  contact_funnel: { label: string; value: number }[]
  tasks_by_priority: { label: string; value: number }[]
  viewings_by_outcome: { label: string; value: number }[]
  revenue_forecast: { label: string; value: number }[]
  won_revenue_by_month: { label: string; value: number }[]
  opportunities_by_agent: { label: string; value: number }[]
}

interface CommunicationsAnalytics {
  generated_at: string
  scope: { agent_id: string | null; agency_id: string | null; start_date: string | null; end_date: string | null }
  summary: {
    conversations_total: number
    messages_total: number
    inbound_messages: number
    outbound_messages: number
    unread_conversations: number
    assigned_conversations: number
    unassigned_conversations: number
  }
  channel_volume: { label: string; inbound: number; outbound: number; total: number }[]
  outbound_statuses: { label: string; value: number }[]
  conversation_status: { label: string; value: number }[]
  first_response_time: { average: { minutes: number } | null; median: { minutes: number } | null; sample_count: number }
  response_time: { average: { minutes: number } | null; median: { minutes: number } | null; sample_count: number }
  conversations_by_agent: { label: string; value: number }[]
}

const STAGE_COLORS: Record<string, string> = {
  new: 'bg-slate-100 text-slate-700',
  qualification: 'bg-blue-100 text-blue-700',
  viewing: 'bg-purple-100 text-purple-700',
  offer: 'bg-orange-100 text-orange-700',
  negotiation: 'bg-amber-100 text-amber-700',
  closed_won: 'bg-green-100 text-green-700',
  closed_lost: 'bg-red-100 text-red-700',
}

function formatCurrency(value: number) {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(value || 0)
}

function formatPercent(value: number | null | undefined) {
  return value == null ? '—' : `${value}%`
}

function StatCard({ title, value, subtext, icon: Icon }: { title: string; value: string; subtext?: string; icon: any }) {
  return (
    <Card>
      <CardContent className="p-6">
        <div className="flex items-start justify-between">
          <div>
            <p className="text-sm font-medium text-muted-foreground">{title}</p>
            <p className="mt-2 text-3xl font-bold">{value}</p>
            {subtext && <p className="mt-1 text-xs text-muted-foreground">{subtext}</p>}
          </div>
          <div className="rounded-lg bg-muted p-2">
            <Icon className="h-5 w-5 text-muted-foreground" />
          </div>
        </div>
      </CardContent>
    </Card>
  )
}

export function CrmAnalyticsPage() {
  const { agent } = useAuth()
  const { addToast } = useToast()
  usePageTitle('CRM Analytics')
  const [loading, setLoading] = useState(true)
  const [crm, setCrm] = useState<CrmAnalytics | null>(null)
  const [comm, setComm] = useState<CommunicationsAnalytics | null>(null)

  useEffect(() => {
    if (!agent) return
    setLoading(true)
    Promise.all([
      api.getCrmAnalytics().catch((err: any) => {
        addToast({ title: 'CRM analytics failed', description: err.message, variant: 'error' })
        return null
      }),
      api.getCommunicationsAnalytics().catch((err: any) => {
        addToast({ title: 'Communications analytics failed', description: err.message, variant: 'error' })
        return null
      }),
    ]).then(([crmData, commData]) => {
      setCrm(crmData)
      setComm(commData)
      setLoading(false)
    })
  }, [agent, addToast])

  const pipelineStageItems = crm
    ? Object.entries(crm.pipeline.by_stage).map(([label, value]) => ({ label, value })).sort((a, b) => b.value - a.value)
    : []

  return (
    <div className="min-h-screen bg-muted/20">
      <div className="mx-auto max-w-6xl px-4 py-6 sm:px-6 lg:px-8">
        <div className="mb-6 flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <div className="mb-2 flex items-center gap-2">
              <Link to="/dashboard">
                <Button variant="ghost" size="sm" className="gap-1">
                  <ArrowLeft className="h-4 w-4" /> Dashboard
                </Button>
              </Link>
            </div>
            <h1 className="text-2xl font-bold">CRM Analytics</h1>
            <p className="text-sm text-muted-foreground">Pipeline, conversation, and task performance</p>
          </div>
          <Link to="/opportunities">
            <Button variant="outline" className="gap-2">
              <TrendingUp className="h-4 w-4" /> Pipeline
            </Button>
          </Link>
        </div>

        {loading ? (
          <div className="flex min-h-[40vh] items-center justify-center">
            <Loader2 className="h-8 w-8 animate-spin text-primary" />
          </div>
        ) : (
          <>
            <div className="mb-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
              <StatCard title="Pipeline Value" value={formatCurrency(crm?.summary.total_pipeline_value || 0)} subtext={`Weighted: ${formatCurrency(crm?.summary.weighted_pipeline_value || 0)}`} icon={DollarSign} />
              <StatCard title="Win Rate" value={formatPercent(crm?.summary.win_rate)} subtext={`${crm?.summary.closed_won || 0} won / ${(crm?.summary.closed_won || 0) + (crm?.summary.closed_lost || 0)} closed`} icon={Target} />
              <StatCard title="Avg Response" value={comm?.first_response_time?.average?.minutes != null ? `${comm.first_response_time.average.minutes}m` : '—'} subtext={`Median: ${comm?.first_response_time?.median?.minutes != null ? `${comm.first_response_time.median.minutes}m` : '—'}`} icon={Clock} />
              <StatCard title="Open Conversations" value={String(comm?.summary.conversations_total || 0)} subtext={`${comm?.summary.unread_conversations || 0} unread`} icon={MessageSquare} />
            </div>

            <div className="mb-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
              <StatCard title="Contacts Created" value={String(crm?.summary.contacts_created || 0)} subtext={`Conversion: ${formatPercent(crm?.summary.conversion_rate)}`} icon={Users} />
              <StatCard title="Open Deals" value={String(crm?.summary.open_opportunities || 0)} subtext={`${crm?.summary.opportunities_created || 0} total created`} icon={BarChart3} />
              <StatCard title="Task Completion" value={formatPercent(crm?.summary.task_completion_rate)} subtext={`${crm?.summary.overdue_tasks || 0} overdue`} icon={CheckCircle2} />
              <StatCard title="Viewings" value={String(crm?.summary.viewings_total || 0)} icon={TrendingUp} />
            </div>

            <div className="grid gap-6 lg:grid-cols-2">
              <Card>
                <CardHeader>
                  <CardTitle className="text-base">Pipeline by Stage</CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="mb-4 flex flex-wrap gap-2">
                    {pipelineStageItems.map((item) => (
                      <Badge key={item.label} className={STAGE_COLORS[item.label] || 'bg-slate-100 text-slate-700'}>
                        {item.label}: {item.value}
                      </Badge>
                    ))}
                    {!pipelineStageItems.length && <p className="text-sm text-muted-foreground">No open opportunities</p>}
                  </div>
                  <HorizontalBarChart items={pipelineStageItems} />
                </CardContent>
              </Card>

              <Card>
                <CardHeader>
                  <CardTitle className="text-base">Lead Sources</CardTitle>
                </CardHeader>
                <CardContent>
                  <HorizontalBarChart items={crm?.lead_sources || []} emptyLabel="No contacts yet" />
                </CardContent>
              </Card>

              <Card>
                <CardHeader>
                  <CardTitle className="text-base">Contact Funnel</CardTitle>
                </CardHeader>
                <CardContent>
                  <HorizontalBarChart items={crm?.contact_funnel || []} emptyLabel="No contacts yet" />
                </CardContent>
              </Card>

              <Card>
                <CardHeader>
                  <CardTitle className="text-base">Tasks by Priority</CardTitle>
                </CardHeader>
                <CardContent>
                  <HorizontalBarChart items={crm?.tasks_by_priority || []} emptyLabel="No tasks yet" />
                </CardContent>
              </Card>

              <Card>
                <CardHeader>
                  <CardTitle className="text-base">Message Volume by Channel</CardTitle>
                </CardHeader>
                <CardContent>
                  <HorizontalBarChart items={(comm?.channel_volume || []).map((c) => ({ label: c.label, value: c.total }))} emptyLabel="No messages yet" />
                </CardContent>
              </Card>

              <Card>
                <CardHeader>
                  <CardTitle className="text-base">Conversation Status</CardTitle>
                </CardHeader>
                <CardContent>
                  <HorizontalBarChart items={comm?.conversation_status || []} emptyLabel="No conversations yet" />
                </CardContent>
              </Card>

              <Card>
                <CardHeader>
                  <CardTitle className="text-base">Revenue Forecast</CardTitle>
                </CardHeader>
                <CardContent>
                  {(crm?.revenue_forecast || []).length ? (
                    <div className="space-y-3">
                      {crm?.revenue_forecast.map((item) => (
                        <div key={item.label} className="flex items-center justify-between text-sm">
                          <span className="font-medium">{item.label}</span>
                          <span className="tabular-nums">{formatCurrency(item.value)}</span>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <p className="py-6 text-center text-sm text-muted-foreground">No forecast data</p>
                  )}
                </CardContent>
              </Card>

              <Card>
                <CardHeader>
                  <CardTitle className="text-base">Won Revenue by Month</CardTitle>
                </CardHeader>
                <CardContent>
                  {(crm?.won_revenue_by_month || []).length ? (
                    <div className="space-y-3">
                      {crm?.won_revenue_by_month.map((item) => (
                        <div key={item.label} className="flex items-center justify-between text-sm">
                          <span className="font-medium">{item.label}</span>
                          <span className="tabular-nums">{formatCurrency(item.value)}</span>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <p className="py-6 text-center text-sm text-muted-foreground">No closed won revenue</p>
                  )}
                </CardContent>
              </Card>
            </div>

            <p className="mt-6 text-xs text-muted-foreground">
              Generated at {crm ? new Date(crm.generated_at).toLocaleString() : '—'}
            </p>
          </>
        )}
      </div>
    </div>
  )
}
