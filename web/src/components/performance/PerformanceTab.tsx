import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  BarChart3, Building2, Eye, Facebook, Heart, Instagram, Linkedin, Loader2,
  MessageCircle, MessageSquare, MousePointerClick, Sparkles, TrendingUp, Twitter,
  Users, Video,
} from 'lucide-react'
import { api, type PerformanceMetricBlock } from '@/api/client'
import { useToast } from '@/components/ui/toast'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'

const PLATFORM_META: Record<string, { label: string; icon: any; color: string; band: string }> = {
  instagram: { label: 'Instagram', icon: Instagram, color: 'text-pink-600', band: 'bg-pink-500' },
  facebook:  { label: 'Facebook',  icon: Facebook,  color: 'text-blue-600', band: 'bg-blue-500' },
  tiktok:    { label: 'TikTok',    icon: Video,     color: 'text-black',   band: 'bg-slate-900' },
  x:         { label: 'X',         icon: Twitter,   color: 'text-slate-800', band: 'bg-slate-700' },
  linkedin:  { label: 'LinkedIn',  icon: Linkedin,  color: 'text-blue-700', band: 'bg-blue-700' },
  whatsapp:  { label: 'WhatsApp',  icon: MessageCircle, color: 'text-green-600', band: 'bg-green-500' },
  facebook_feed: { label: 'FB Feed', icon: Facebook, color: 'text-blue-600', band: 'bg-blue-500' },
}
const PLATFORM_ORDER = ['instagram', 'facebook', 'tiktok', 'x', 'linkedin', 'whatsapp']

const RANGES = [7, 30, 90] as const
type DaysRange = typeof RANGES[number]

export function PerformanceTab({ listingId }: { listingId: string }) {
  const { addToast } = useToast()
  const [data, setData] = useState<Awaited<ReturnType<typeof api.getListingPerformance>> | null>(null)
  const [loading, setLoading] = useState(true)
  const [days, setDays] = useState<DaysRange>(30)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const r = await api.getListingPerformance(listingId, days)
      setData(r)
    } catch (err: any) {
      addToast({ title: 'Could not load performance', description: err?.message, variant: 'error' })
    } finally {
      setLoading(false)
    }
  }, [listingId, days, addToast])

  useEffect(() => { load() }, [load])

  if (loading && !data) {
    return (
      <div className="flex min-h-[40vh] items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    )
  }
  if (!data) return null

  return (
    <div className="space-y-6">
      {/* Header + range selector */}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <p className="text-sm text-muted-foreground">
            {data.counts.published_posts} published post{data.counts.published_posts === 1 ? '' : 's'}
            {' · '}{data.counts.channels} channel{data.counts.channels === 1 ? '' : 's'}
            {' · '}{data.counts.contacts_reached} contact{data.counts.contacts_reached === 1 ? '' : 's'} reached
          </p>
        </div>
        <div className="flex items-center gap-2">
          <div className="flex items-center gap-1 rounded-md border p-0.5">
            {RANGES.map((d) => (
              <button
                key={d}
                type="button"
                onClick={() => setDays(d)}
                className={`rounded px-2 py-1 text-xs font-medium transition-colors ${
                  days === d ? 'bg-slate-900 text-white' : 'text-muted-foreground hover:bg-muted'
                }`}
              >
                {d}d
              </button>
            ))}
          </div>
          <Button size="sm" variant="ghost" onClick={load} disabled={loading} className="gap-1.5">
            {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
            Refresh
          </Button>
        </div>
      </div>

      {/* ===== All-channel aggregate ===== */}
      <Card>
        <CardHeader className="pb-3">
          <div className="flex items-center gap-2">
            <BarChart3 className="h-5 w-5 text-muted-foreground" />
            <CardTitle className="text-lg">All channels — aggregate</CardTitle>
          </div>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
            <StatTile label="Impressions" value={data.all_channels.impressions} icon={Eye} tone="blue" />
            <StatTile label="Views" value={data.all_channels.impressions} icon={Eye} tone="blue"
              sublabel={`Avg ${data.all_channels.avg_views_per_post.toLocaleString()} per post`} />
            <StatTile label="Clicks" value={data.all_channels.clicks} icon={MousePointerClick} tone="amber" />
            <StatTile label="Engagements" value={data.all_channels.engagements} icon={Heart} tone="rose"
              sublabel={`${data.all_channels.likes.toLocaleString()} likes · ${data.all_channels.comments.toLocaleString()} comments · ${data.all_channels.shares.toLocaleString()} shares`} />
            <StatTile label="Contacts reached" value={data.all_channels.contacts} icon={Users} tone="purple" />
            <StatTile label="Messages" value={data.all_channels.messages} icon={MessageSquare} tone="green"
              sublabel={`${data.all_channels.inquiries} inquiries · ${data.all_channels.viewings_scheduled} viewings`} />
          </div>
        </CardContent>
      </Card>

      {/* ===== Per channel breakdown ===== */}
      {data.per_channel.length > 0 && (
        <Card>
          <CardHeader className="pb-3">
            <div className="flex items-center gap-2">
              <TrendingUp className="h-5 w-5 text-muted-foreground" />
              <CardTitle className="text-lg">Per channel</CardTitle>
            </div>
          </CardHeader>
          <CardContent>
            <div className="overflow-hidden rounded-md border">
              <table className="w-full text-sm">
                <thead className="bg-slate-50 text-xs uppercase text-muted-foreground">
                  <tr>
                    <th className="px-3 py-2 text-left">Channel</th>
                    <th className="px-3 py-2 text-right">Impressions</th>
                    <th className="px-3 py-2 text-right">Engagements</th>
                    <th className="px-3 py-2 text-right">Clicks</th>
                    <th className="px-3 py-2 text-right">Inquiries</th>
                    <th className="px-3 py-2 text-right">Messages</th>
                    <th className="px-3 py-2 text-right">Avg views/post</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {orderedChannels(data.per_channel).map((c) => {
                    const meta = PLATFORM_META[c.platform] || { label: c.platform, icon: Building2, color: 'text-slate-700', band: 'bg-slate-500' }
                    const Icon = meta.icon
                    return (
                      <tr key={c.platform}>
                        <td className="px-3 py-2">
                          <div className="flex items-center gap-2">
                            <Icon className={`h-4 w-4 ${meta.color}`} />
                            <span className="font-medium">{meta.label}</span>
                            <Badge variant="outline" className="text-[10px]">{c.published_posts} posts</Badge>
                          </div>
                        </td>
                        <td className="px-3 py-2 text-right font-medium">{c.impressions.toLocaleString()}</td>
                        <td className="px-3 py-2 text-right">{c.engagements.toLocaleString()}</td>
                        <td className="px-3 py-2 text-right">{c.clicks.toLocaleString()}</td>
                        <td className="px-3 py-2 text-right">{c.inquiries.toLocaleString()}</td>
                        <td className="px-3 py-2 text-right">{c.messages.toLocaleString()}</td>
                        <td className="px-3 py-2 text-right text-muted-foreground">{c.avg_views_per_post.toLocaleString()}</td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>
      )}

      {/* ===== Channel comparison bars ===== */}
      {data.per_channel.length > 1 && (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-lg">Channel comparison</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <ComparisonBar
              label="Impressions"
              channels={orderedChannels(data.per_channel)}
              valueKey="impressions"
            />
            <ComparisonBar
              label="Engagements"
              channels={orderedChannels(data.per_channel)}
              valueKey="engagements"
            />
            <ComparisonBar
              label="Clicks"
              channels={orderedChannels(data.per_channel)}
              valueKey="clicks"
            />
          </CardContent>
        </Card>
      )}

      {/* ===== Funnel per channel ===== */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-lg">Funnel per channel</CardTitle>
          <p className="text-xs text-muted-foreground">
            Views → Engagements → Clicks → Inquiries → Viewings → Closes
          </p>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
            {data.funnel.map((f) => {
              const meta = PLATFORM_META[f.platform] || { label: f.platform, icon: Building2, color: 'text-slate-700', band: 'bg-slate-500' }
              const stages = [
                { label: 'Views',       value: f.views },
                { label: 'Engagements', value: f.engagements },
                { label: 'Clicks',      value: f.clicks },
                { label: 'Inquiries',   value: f.inquiries },
                { label: 'Viewings',    value: f.viewings_scheduled },
                { label: 'Closes',      value: f.closes },
              ]
              const max = Math.max(1, ...stages.map((s) => s.value))
              return (
                <div key={f.platform} className="rounded-lg border bg-white p-3">
                  <div className="mb-2 flex items-center gap-2 border-b pb-2">
                    <meta.icon className={`h-4 w-4 ${meta.color}`} />
                    <span className="font-medium">{meta.label}</span>
                  </div>
                  <ul className="space-y-1.5">
                    {stages.map((s) => {
                      const pct = Math.max(1, (s.value / max) * 100)
                      return (
                        <li key={s.label}>
                          <div className="mb-0.5 flex items-center justify-between text-xs">
                            <span className="text-muted-foreground">{s.label}</span>
                            <span className="font-semibold">{s.value.toLocaleString()}</span>
                          </div>
                          <div className="h-2 overflow-hidden rounded-full bg-slate-100">
                            <div className={`h-full ${meta.band}`} style={{ width: `${pct}%` }} />
                          </div>
                        </li>
                      )
                    })}
                  </ul>
                </div>
              )
            })}
          </div>
        </CardContent>
      </Card>

      {/* ===== Time-series line chart ===== */}
      {Object.keys(data.time_series.channels).length > 0 && (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-lg">Trend over last {data.time_series.days} days</CardTitle>
            <p className="text-xs text-muted-foreground">
              Impressions per day, per channel. Auto-filled from insight snapshots.
            </p>
          </CardHeader>
          <CardContent>
            <TimeSeriesChart timeSeries={data.time_series} />
          </CardContent>
        </Card>
      )}

      {data.counts.published_posts === 0 && (
        <div className="rounded-md border border-dashed bg-slate-50 p-4 text-sm text-muted-foreground">
          Publish this listing to a channel to see performance data here. Metrics populate after the
          first insight refresh from each platform.
        </div>
      )}
    </div>
  )
}

/* -------------------------------- pieces ------------------------------- */

function StatTile({
  label, value, icon: Icon, tone, sublabel,
}: {
  label: string; value: number; icon: any
  tone: 'blue' | 'rose' | 'amber' | 'green' | 'purple'
  sublabel?: string
}) {
  const toneMap = {
    blue: 'text-blue-700 bg-blue-50 border-blue-200',
    rose: 'text-rose-700 bg-rose-50 border-rose-200',
    amber: 'text-amber-800 bg-amber-50 border-amber-200',
    green: 'text-emerald-700 bg-emerald-50 border-emerald-200',
    purple: 'text-purple-700 bg-purple-50 border-purple-200',
  }
  return (
    <div className={`rounded-lg border p-3 ${toneMap[tone]}`}>
      <div className="flex items-center justify-between">
        <Icon className="h-4 w-4 opacity-70" />
        <span className="text-2xl font-semibold">{value.toLocaleString()}</span>
      </div>
      <div className="mt-1 text-xs font-medium opacity-80">{label}</div>
      {sublabel && <div className="mt-0.5 text-[10px] opacity-70">{sublabel}</div>}
    </div>
  )
}

function orderedChannels<T extends { platform: string }>(channels: T[]): T[] {
  const rank = new Map(PLATFORM_ORDER.map((k, i) => [k, i]))
  return [...channels].sort((a, b) => (rank.get(a.platform) ?? 99) - (rank.get(b.platform) ?? 99))
}

function ComparisonBar({
  label, channels, valueKey,
}: {
  label: string
  channels: Array<PerformanceMetricBlock & { platform: string }>
  valueKey: keyof PerformanceMetricBlock
}) {
  const values = channels.map((c) => Number(c[valueKey]) || 0)
  const max = Math.max(1, ...values)
  return (
    <div>
      <div className="mb-1.5 text-xs font-medium text-muted-foreground">{label}</div>
      <ul className="space-y-1.5">
        {channels.map((c, i) => {
          const meta = PLATFORM_META[c.platform] || { label: c.platform, icon: Building2, color: 'text-slate-700', band: 'bg-slate-500' }
          const val = values[i]
          const pct = (val / max) * 100
          return (
            <li key={c.platform} className="flex items-center gap-3">
              <div className="flex w-24 flex-shrink-0 items-center gap-1.5 text-xs">
                <meta.icon className={`h-3.5 w-3.5 ${meta.color}`} />
                {meta.label}
              </div>
              <div className="flex-1">
                <div className="h-4 overflow-hidden rounded-full bg-slate-100">
                  <div className={`h-full ${meta.band}`} style={{ width: `${Math.max(2, pct)}%` }} />
                </div>
              </div>
              <div className="w-24 flex-shrink-0 text-right text-xs font-semibold">{val.toLocaleString()}</div>
            </li>
          )
        })}
      </ul>
    </div>
  )
}

function TimeSeriesChart({ timeSeries }: { timeSeries: { days: number; channels: Record<string, Array<{ date: string; impressions: number; engagements: number; clicks: number }>> } }) {
  const channels = Object.keys(timeSeries.channels)
  const anyChannel = channels[0]
  const dayCount = timeSeries.channels[anyChannel]?.length || 0
  if (!dayCount) return <p className="text-xs text-muted-foreground">No snapshot data yet.</p>

  const W = 720
  const H = 220
  const padding = { top: 12, right: 12, bottom: 24, left: 40 }
  const innerW = W - padding.left - padding.right
  const innerH = H - padding.top - padding.bottom

  const allValues = channels.flatMap((k) => timeSeries.channels[k].map((p) => p.impressions))
  const maxY = Math.max(1, ...allValues)
  const xStep = innerW / Math.max(1, dayCount - 1)

  const yTicks = [0, 0.25, 0.5, 0.75, 1].map((t) => Math.round(maxY * t))

  return (
    <div className="overflow-x-auto">
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full" style={{ minWidth: 480 }}>
        {/* y grid */}
        {yTicks.map((tick, i) => {
          const y = padding.top + innerH - (tick / maxY) * innerH
          return (
            <g key={i}>
              <line x1={padding.left} x2={padding.left + innerW} y1={y} y2={y} stroke="#f1f5f9" strokeWidth="1" />
              <text x={padding.left - 4} y={y + 3} textAnchor="end" fontSize="9" fill="#94a3b8">
                {tick >= 1000 ? `${(tick / 1000).toFixed(1)}k` : tick}
              </text>
            </g>
          )
        })}

        {/* lines per channel */}
        {channels.map((k) => {
          const meta = PLATFORM_META[k]
          const stroke = ({
            instagram: '#EC4899',
            facebook: '#3B82F6',
            tiktok: '#0F172A',
            x: '#334155',
            linkedin: '#1D4ED8',
            whatsapp: '#22C55E',
          } as Record<string, string>)[k] || '#64748B'
          const points = timeSeries.channels[k].map((p, i) => {
            const x = padding.left + i * xStep
            const y = padding.top + innerH - (p.impressions / maxY) * innerH
            return `${x},${y}`
          }).join(' ')
          return (
            <g key={k}>
              <polyline points={points} fill="none" stroke={stroke} strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" />
              {timeSeries.channels[k].map((p, i) => {
                const x = padding.left + i * xStep
                const y = padding.top + innerH - (p.impressions / maxY) * innerH
                return <circle key={i} cx={x} cy={y} r="2" fill={stroke} />
              })}
              <text x={padding.left + innerW} y={padding.top + innerH - (timeSeries.channels[k][dayCount - 1].impressions / maxY) * innerH - 4}
                fontSize="10" fill={stroke} textAnchor="end">
                {meta?.label || k}
              </text>
            </g>
          )
        })}

        {/* x labels — first, mid, last */}
        {[0, Math.floor(dayCount / 2), dayCount - 1].map((i) => {
          const x = padding.left + i * xStep
          const date = timeSeries.channels[anyChannel][i]?.date || ''
          return (
            <text key={i} x={x} y={H - 6} fontSize="9" fill="#94a3b8" textAnchor={i === 0 ? 'start' : i === dayCount - 1 ? 'end' : 'middle'}>
              {date.slice(5)}
            </text>
          )
        })}
      </svg>
    </div>
  )
}
