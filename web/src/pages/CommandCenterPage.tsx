import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import {
  AlertTriangle, ArrowLeft, ArrowRight, Award, Building2, ChevronRight, Eye,
  Flame, Heart, Inbox, Loader2, MessageCircle, Settings2, Share2,
  Sparkles, TrendingUp, Users, ExternalLink,
} from 'lucide-react'
import { api, type CommandItem, type CommandOpportunity } from '@/api/client'
import { useAuth } from '@/context/AuthContext'
import { useToast } from '@/components/ui/toast'
import { usePageTitle } from '@/lib/usePageTitle'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'

const PLATFORM_LABEL: Record<string, string> = {
  instagram: 'Instagram', facebook: 'Facebook', tiktok: 'TikTok',
  x: 'X', linkedin: 'LinkedIn', whatsapp: 'WhatsApp',
}

export function CommandCenterPage() {
  const { agent, loading: authLoading } = useAuth()
  const { addToast } = useToast()
  usePageTitle('Command Center')

  const [data, setData] = useState<Awaited<ReturnType<typeof api.getCommandCenter>> | null>(null)
  const [loading, setLoading] = useState(true)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const r = await api.getCommandCenter()
      setData(r)
    } catch (err: any) {
      addToast({ title: 'Could not load Command Center', description: err?.message, variant: 'error' })
    } finally {
      setLoading(false)
    }
  }, [addToast])

  useEffect(() => { if (agent) load() }, [agent, load])

  const summaryCards = useMemo(() => {
    if (!data) return []
    return [
      { label: 'Escalations', value: data.summary.escalations_total, icon: AlertTriangle, color: 'text-rose-600 bg-rose-50 border-rose-200' },
      { label: 'Pipeline (social)', value: data.summary.pipeline_total, icon: TrendingUp, color: 'text-blue-600 bg-blue-50 border-blue-200' },
      { label: 'Inquiries', value: data.summary.inquiries_total, icon: Inbox, color: 'text-indigo-600 bg-indigo-50 border-indigo-200' },
      { label: 'Testimonials queue', value: data.summary.testimonials_total, icon: Award, color: 'text-emerald-600 bg-emerald-50 border-emerald-200' },
      { label: 'AI watching', value: data.summary.ai_watching_total, icon: Eye, color: 'text-purple-600 bg-purple-50 border-purple-200' },
    ]
  }, [data])

  if (authLoading || (loading && !data)) {
    return (
      <div className="flex min-h-[60vh] items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    )
  }
  if (!agent) {
    return (
      <div className="mx-auto max-w-lg py-16 text-center">
        <h1 className="text-2xl font-semibold">Sign in to access the Command Center</h1>
        <Link to="/login" className="mt-3 inline-block"><Button>Sign in</Button></Link>
      </div>
    )
  }
  if (!data) return null

  return (
    <div className="mx-auto max-w-7xl px-4 py-6 sm:px-6 lg:px-8">
      <div className="mb-4 flex items-center gap-2 text-sm text-muted-foreground">
        <Link to="/dashboard" className="inline-flex items-center gap-1 hover:text-foreground">
          <ArrowLeft className="h-4 w-4" /> Dashboard
        </Link>
      </div>

      <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Command Center</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Every inbound social comment routed to its downstream process, all in one operational view.
          </p>
        </div>
        <div className="flex gap-2">
          <Link to="/settings/routing">
            <Button variant="outline" size="sm" className="gap-1.5">
              <Settings2 className="h-4 w-4" />
              Routing rules
            </Button>
          </Link>
          <Button size="sm" variant="ghost" onClick={load} disabled={loading} className="gap-1.5">
            {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
            Refresh
          </Button>
        </div>
      </div>

      {/* Summary tiles */}
      <div className="mb-6 grid grid-cols-2 gap-3 md:grid-cols-5">
        {summaryCards.map((c) => (
          <div key={c.label} className={`rounded-lg border p-3 ${c.color}`}>
            <div className="flex items-center justify-between">
              <c.icon className="h-4 w-4 opacity-70" />
              <span className="text-2xl font-semibold">{c.value}</span>
            </div>
            <div className="mt-1 text-xs font-medium opacity-80">{c.label}</div>
          </div>
        ))}
      </div>

      {/* Escalations — top row, always visible, most urgent */}
      <Card className="mb-6 border-rose-200">
        <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-3">
          <div className="flex items-center gap-2">
            <AlertTriangle className="h-5 w-5 text-rose-600" />
            <CardTitle className="text-lg">Escalations — needs agent attention</CardTitle>
          </div>
          <Badge variant="outline" className="border-rose-200 bg-rose-50 text-rose-800">
            {data.summary.escalations_total}
          </Badge>
        </CardHeader>
        <CardContent className="space-y-3">
          {data.summary.escalations_total === 0 ? (
            <p className="rounded-md border border-dashed bg-emerald-50 p-3 text-sm text-emerald-800">
              All caught up. No comments need your attention right now.
            </p>
          ) : (
            <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
              <EscalationGroup title="Complaints" tone="rose" icon="🚨" items={data.escalations.complaints} />
              <EscalationGroup title="Objections" tone="orange" icon="⚠️" items={data.escalations.objections} />
              <EscalationGroup title="Hot leads waiting" tone="rose" icon="🔥" items={data.escalations.hot_leads} />
            </div>
          )}
        </CardContent>
      </Card>

      <Tabs defaultValue="pipeline">
        <TabsList className="mb-4 flex flex-wrap">
          <TabsTrigger value="pipeline">
            CRM Pipeline
            <Badge variant="outline" className="ml-2 text-[10px]">{data.summary.pipeline_total}</Badge>
          </TabsTrigger>
          <TabsTrigger value="inquiries">
            Inquiries
            <Badge variant="outline" className="ml-2 text-[10px]">{data.summary.inquiries_total}</Badge>
          </TabsTrigger>
          <TabsTrigger value="engagement">Engagement</TabsTrigger>
          <TabsTrigger value="ai_watching">
            AI Watching
            <Badge variant="outline" className="ml-2 text-[10px]">{data.summary.ai_watching_total}</Badge>
          </TabsTrigger>
          <TabsTrigger value="marketing">
            Marketing
            <Badge variant="outline" className="ml-2 text-[10px]">{data.summary.testimonials_total}</Badge>
          </TabsTrigger>
          <TabsTrigger value="activity">Activity</TabsTrigger>
        </TabsList>

        <TabsContent value="pipeline">
          <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
            <PipelineColumn title="Standard leads" icon={Users} items={data.pipeline.standard} />
            <PipelineColumn title="Investor leads" icon={TrendingUp} items={data.pipeline.investor} />
            <PipelineColumn title="Other sub-pipelines" icon={Building2} items={data.pipeline.other} />
          </div>
        </TabsContent>

        <TabsContent value="inquiries">
          <Card>
            <CardHeader>
              <CardTitle className="text-lg">Question inbox (auto-routed from social)</CardTitle>
            </CardHeader>
            <CardContent>
              {data.inquiries.length === 0 ? (
                <p className="rounded-md border border-dashed bg-slate-50 p-3 text-sm text-muted-foreground">
                  No inquiries from social comments in the last 30 days.
                </p>
              ) : (
                <ul className="space-y-2">
                  {data.inquiries.map((i) => (
                    <li key={i.id} className="rounded border bg-white p-3">
                      <div className="flex items-center justify-between gap-2">
                        <div>
                          <div className="text-sm font-medium">{i.name || 'Anonymous'}</div>
                          {i.property_title && i.property_id && (
                            <Link to={`/listings/${i.property_id}`} className="text-xs text-primary hover:underline">
                              {i.property_title}
                            </Link>
                          )}
                        </div>
                        <Badge variant="outline">{i.channel}</Badge>
                      </div>
                      <p className="mt-1 line-clamp-2 text-xs text-slate-700">{i.message}</p>
                      <div className="mt-1 text-[10px] text-muted-foreground">
                        {new Date(i.created_at).toLocaleString()}
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="engagement">
          <Card>
            <CardHeader>
              <CardTitle className="text-lg">Social engagement</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="mb-3 grid grid-cols-3 gap-2">
                <StatTile label="Reactions" value={data.engagement.reactions} icon={Heart} tone="rose" />
                <StatTile label="Referrals" value={data.engagement.referrals} icon={Share2} tone="purple" />
                <StatTile label="Mentions" value={data.engagement.mentions} icon={MessageCircle} tone="blue" />
              </div>
              <div>
                <h4 className="mb-1 text-xs font-semibold uppercase text-muted-foreground">By platform</h4>
                <ul className="grid grid-cols-1 gap-1.5 sm:grid-cols-2">
                  {Object.entries(data.engagement.by_platform).map(([p, m]) => (
                    <li key={p} className="flex items-center justify-between rounded border bg-white px-3 py-1.5 text-sm">
                      <span className="font-medium">{PLATFORM_LABEL[p] || p}</span>
                      <span className="text-xs text-muted-foreground">
                        {m.reactions} ❤️ · {m.referrals} 🔗 · {m.mentions} 💬
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="ai_watching">
          <Card>
            <CardHeader>
              <CardTitle className="text-lg">Threads under AI thread-watch</CardTitle>
              <p className="text-xs text-muted-foreground">
                General-category comments where the AI is monitoring for buy intent surfacing later. Re-routing is automatic when intent flips.
              </p>
            </CardHeader>
            <CardContent>
              {data.ai_watching.length === 0 ? (
                <p className="rounded-md border border-dashed bg-slate-50 p-3 text-sm text-muted-foreground">
                  No threads under AI watch.
                </p>
              ) : (
                <ul className="space-y-2">
                  {data.ai_watching.map((t) => (
                    <li key={t.conversation_id} className="rounded border bg-white p-3">
                      <div className="flex items-center justify-between gap-2">
                        <div className="min-w-0">
                          <div className="text-sm font-medium">{t.contact_name || 'Unnamed contact'}</div>
                          <p className="line-clamp-1 text-xs text-muted-foreground">{t.last_message_preview}</p>
                        </div>
                        <Badge variant="outline">{t.channel}</Badge>
                      </div>
                      <div className="mt-1 text-[10px] text-muted-foreground">
                        Watching since {t.ai_watch_started_at ? new Date(t.ai_watch_started_at).toLocaleDateString() : '—'}
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="marketing">
          <Card>
            <CardHeader>
              <CardTitle className="text-lg">Testimonials queue</CardTitle>
              <p className="text-xs text-muted-foreground">
                Past-client positive feedback the router flagged for potential marketing reuse. Consent workflow lives here.
              </p>
            </CardHeader>
            <CardContent>
              {data.testimonials.length === 0 ? (
                <p className="rounded-md border border-dashed bg-slate-50 p-3 text-sm text-muted-foreground">
                  No testimonials in queue yet.
                </p>
              ) : (
                <ul className="space-y-2">
                  {data.testimonials.map((t) => (
                    <li key={t.id} className="rounded border bg-white p-3">
                      <div className="mb-1 flex items-center justify-between gap-2">
                        <div className="flex items-center gap-2">
                          <span className="text-sm font-medium">{t.author_name || 'Anonymous'}</span>
                          <Badge variant="outline">{t.source_channel}</Badge>
                        </div>
                        <ConsentBadge status={t.consent_status} />
                      </div>
                      <p className="text-sm italic text-slate-700">"{t.content}"</p>
                      {t.source_post_url && (
                        <a
                          href={t.source_post_url}
                          target="_blank"
                          rel="noreferrer"
                          className="mt-1 inline-flex items-center gap-1 text-[10px] text-muted-foreground hover:text-foreground"
                        >
                          <ExternalLink className="h-3 w-3" />
                          Source post
                        </a>
                      )}
                    </li>
                  ))}
                </ul>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="activity">
          <Card>
            <CardHeader>
              <CardTitle className="text-lg">Recent routing activity</CardTitle>
              <p className="text-xs text-muted-foreground">
                Last 100 routing decisions across all your listings.
              </p>
            </CardHeader>
            <CardContent>
              {data.routing_activity.length === 0 ? (
                <p className="rounded-md border border-dashed bg-slate-50 p-3 text-sm text-muted-foreground">
                  No routing activity yet.
                </p>
              ) : (
                <ul className="space-y-1.5">
                  {data.routing_activity.map((r) => (
                    <li key={r.id} className="rounded border bg-white px-3 py-2 text-xs">
                      <div className="flex items-center justify-between gap-2">
                        <div className="flex flex-wrap items-center gap-1">
                          <Badge variant="outline" className="text-[10px]">{r.category}</Badge>
                          {r.outcomes.map((o, i) => (
                            <span key={i} className="rounded border bg-slate-50 px-1.5 py-0 text-[10px] text-slate-700">
                              {o.type}{o.notes ? ` · ${o.notes}` : ''}
                            </span>
                          ))}
                        </div>
                        <span className="text-[10px] text-muted-foreground">
                          {new Date(r.created_at).toLocaleString()}
                        </span>
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  )
}

function EscalationGroup({
  title, tone, icon, items,
}: { title: string; tone: 'rose' | 'orange'; icon: string; items: CommandItem[] }) {
  const borderClass = tone === 'rose' ? 'border-rose-200' : 'border-orange-200'
  const bgClass = tone === 'rose' ? 'bg-rose-50' : 'bg-orange-50'
  return (
    <div className={`rounded-lg border ${borderClass} bg-white p-3`}>
      <div className={`-mx-3 -mt-3 mb-2 flex items-center justify-between rounded-t-lg ${bgClass} px-3 py-1.5 text-sm font-semibold`}>
        <span>{icon} {title}</span>
        <span>{items.length}</span>
      </div>
      {items.length === 0 ? (
        <p className="text-xs text-muted-foreground">Nothing here.</p>
      ) : (
        <ul className="space-y-2">
          {items.map((it) => (
            <li key={it.message_id} className="rounded border bg-slate-50 p-2 text-xs">
              <div className="mb-1 flex items-center justify-between gap-1">
                <span className="font-medium">{it.author_name || 'Anonymous'}</span>
                <Badge variant="outline" className="text-[10px]">{it.platform}</Badge>
              </div>
              <p className="mb-1 line-clamp-2 text-slate-700">{it.content}</p>
              {it.listing_id && it.listing_title && (
                <Link to={`/listings/${it.listing_id}`} className="mb-1 block text-[10px] text-primary hover:underline">
                  → {it.listing_title}
                </Link>
              )}
              {it.suggested_reply && (
                <div className="mt-1 rounded border border-amber-200 bg-amber-50 p-1.5 text-[10px] text-amber-900">
                  <Sparkles className="mr-1 inline h-3 w-3" />
                  {it.suggested_reply}
                </div>
              )}
              <Link
                to={`/listings/${it.listing_id}`}
                className="mt-1 inline-flex items-center gap-0.5 text-[10px] text-muted-foreground hover:text-foreground"
              >
                Open thread <ChevronRight className="h-3 w-3" />
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

function PipelineColumn({
  title, icon: Icon, items,
}: { title: string; icon: any; items: CommandOpportunity[] }) {
  return (
    <Card>
      <CardHeader className="pb-2">
        <div className="flex items-center gap-2">
          <Icon className="h-4 w-4 text-muted-foreground" />
          <CardTitle className="text-sm font-semibold">{title}</CardTitle>
          <span className="ml-auto text-xs text-muted-foreground">{items.length}</span>
        </div>
      </CardHeader>
      <CardContent>
        {items.length === 0 ? (
          <p className="text-xs text-muted-foreground">Empty.</p>
        ) : (
          <ul className="space-y-1.5">
            {items.map((o) => (
              <li key={o.id} className="rounded border bg-white p-2 text-xs">
                <div className="flex items-center justify-between gap-2">
                  <span className="font-medium capitalize">{o.stage.replace(/_/g, ' ')}</span>
                  <span className="text-[10px] text-muted-foreground">{o.probability}%</span>
                </div>
                <p className="line-clamp-2 text-[10px] text-slate-600">{o.notes}</p>
                {o.property_id && (
                  <Link to={`/listings/${o.property_id}`} className="mt-1 inline-flex items-center gap-0.5 text-[10px] text-primary hover:underline">
                    Open listing <ArrowRight className="h-3 w-3" />
                  </Link>
                )}
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  )
}

function StatTile({
  label, value, icon: Icon, tone,
}: { label: string; value: number; icon: any; tone: 'rose' | 'purple' | 'blue' }) {
  const toneClass = tone === 'rose' ? 'text-rose-600 bg-rose-50 border-rose-200'
    : tone === 'purple' ? 'text-purple-600 bg-purple-50 border-purple-200'
    : 'text-blue-600 bg-blue-50 border-blue-200'
  return (
    <div className={`rounded-lg border p-3 ${toneClass}`}>
      <div className="flex items-center justify-between">
        <Icon className="h-4 w-4 opacity-70" />
        <span className="text-2xl font-semibold">{value.toLocaleString()}</span>
      </div>
      <div className="mt-1 text-xs font-medium opacity-80">{label}</div>
    </div>
  )
}

function ConsentBadge({ status }: { status: string }) {
  const meta: Record<string, { label: string; className: string }> = {
    pending: { label: 'Consent pending', className: 'border-amber-200 bg-amber-50 text-amber-800' },
    implicit: { label: 'Implicit consent', className: 'border-slate-200 bg-slate-50 text-slate-600' },
    granted: { label: 'Consent granted', className: 'border-emerald-200 bg-emerald-50 text-emerald-800' },
    declined: { label: 'Consent declined', className: 'border-rose-200 bg-rose-50 text-rose-800' },
  }
  const m = meta[status] || { label: status, className: 'border-slate-200 bg-slate-50 text-slate-600' }
  return <Badge variant="outline" className={m.className}>{m.label}</Badge>
}

// Silence unused-imports kept for consistency with future feature additions.
void [Flame]
