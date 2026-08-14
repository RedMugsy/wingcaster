import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import {
  AlertCircle, Bot, Calendar as CalendarIcon, ChevronRight, Clock, Facebook,
  Instagram, Linkedin, Loader2, Mail, MessageCircle, MessageSquare,
  Phone, RefreshCcw, Sparkles, Star, TrendingUp, Twitter, Users, Video,
} from 'lucide-react'
import { api } from '@/api/client'
import { useToast } from '@/components/ui/toast'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'

interface Props {
  contactId: string
}

const CHANNEL_META: Record<string, { label: string; icon: any; color: string }> = {
  whatsapp:            { label: 'WhatsApp',           icon: MessageCircle, color: 'text-emerald-600' },
  sms:                 { label: 'SMS',                icon: MessageSquare, color: 'text-slate-600' },
  email:               { label: 'Email',              icon: Mail,          color: 'text-blue-600' },
  instagram_dm:        { label: 'Instagram DM',       icon: Instagram,     color: 'text-pink-600' },
  instagram_comment:   { label: 'Instagram comment',  icon: Instagram,     color: 'text-pink-600' },
  facebook_messenger:  { label: 'FB Messenger',       icon: Facebook,      color: 'text-blue-600' },
  facebook_comment:    { label: 'Facebook comment',   icon: Facebook,      color: 'text-blue-600' },
  tiktok_dm:           { label: 'TikTok DM',          icon: Video,         color: 'text-slate-800' },
  tiktok_comment:      { label: 'TikTok comment',     icon: Video,         color: 'text-slate-800' },
  x_dm:                { label: 'X DM',               icon: Twitter,       color: 'text-slate-800' },
  x_mention:           { label: 'X mention',          icon: Twitter,       color: 'text-slate-800' },
  linkedin:            { label: 'LinkedIn',           icon: Linkedin,      color: 'text-blue-700' },
  linkedin_comment:    { label: 'LinkedIn comment',   icon: Linkedin,      color: 'text-blue-700' },
}

const CATEGORY_COLORS: Record<string, string> = {
  hot_lead:    'bg-rose-50 text-rose-800 border-rose-200',
  interest:    'bg-blue-50 text-blue-800 border-blue-200',
  investor:    'bg-violet-50 text-violet-800 border-violet-200',
  question:    'bg-amber-50 text-amber-800 border-amber-200',
  reaction:    'bg-slate-50 text-slate-600 border-slate-200',
  referral:    'bg-emerald-50 text-emerald-800 border-emerald-200',
  general:     'bg-slate-50 text-slate-500 border-slate-200',
  objection:   'bg-orange-50 text-orange-800 border-orange-200',
  complaint:   'bg-rose-100 text-rose-900 border-rose-300',
  testimonial: 'bg-emerald-100 text-emerald-900 border-emerald-300',
  spam:        'bg-zinc-100 text-zinc-500 border-zinc-200',
}

const ACTION_META: Record<string, { label: string; icon: any }> = {
  send_template_reply:        { label: 'Send template reply',   icon: MessageCircle },
  schedule_viewing:           { label: 'Schedule viewing',      icon: CalendarIcon },
  send_property_match:        { label: 'Send property match',   icon: Star },
  follow_up_pending_question: { label: 'Follow-up question',    icon: AlertCircle },
  escalate_to_manager:        { label: 'Escalate to manager',   icon: TrendingUp },
  add_to_campaign:            { label: 'Add to campaign',       icon: Users },
  nurture_wait:               { label: 'Nurture — no action',   icon: Clock },
}

export function Contact360Panel({ contactId }: Props) {
  const { addToast } = useToast()
  const [feed, setFeed] = useState<Awaited<ReturnType<typeof api.getContactConversations360>> | null>(null)
  const [summary, setSummary] = useState<Awaited<ReturnType<typeof api.getContactLeadSummary>> | null>(null)
  const [loading, setLoading] = useState(true)
  const [regenerating, setRegenerating] = useState(false)
  const [channelFilter, setChannelFilter] = useState<string | null>(null)
  const [categoryFilter, setCategoryFilter] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const [feedRes, summaryRes] = await Promise.all([
        api.getContactConversations360(contactId),
        api.getContactLeadSummary(contactId).catch(() => null),
      ])
      setFeed(feedRes)
      setSummary(summaryRes)
    } catch (err: any) {
      addToast({ title: 'Could not load Contact 360', description: err?.message, variant: 'error' })
    } finally {
      setLoading(false)
    }
  }, [contactId, addToast])

  useEffect(() => { load() }, [load])

  const messages = useMemo(() => {
    if (!feed) return []
    return feed.messages.filter((m) => {
      if (channelFilter && m.channel !== channelFilter) return false
      if (categoryFilter && (m.category || 'general') !== categoryFilter) return false
      return true
    })
  }, [feed, channelFilter, categoryFilter])

  const categoryCounts = useMemo(() => {
    if (!feed) return {}
    const c: Record<string, number> = {}
    for (const m of feed.messages) {
      if (m.direction !== 'inbound') continue
      const cat = m.category || 'general'
      c[cat] = (c[cat] || 0) + 1
    }
    return c
  }, [feed])

  async function regenerate() {
    if (regenerating) return
    setRegenerating(true)
    try {
      const r = await api.regenerateContactLeadSummary(contactId) as Awaited<ReturnType<typeof api.getContactLeadSummary>>
      setSummary(r)
      addToast({ title: 'Lead summary refreshed', variant: 'success' })
    } catch (err: any) {
      addToast({ title: 'Regeneration failed', description: err?.message, variant: 'error' })
    } finally {
      setRegenerating(false)
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    )
  }
  if (!feed) return <p className="text-sm text-muted-foreground">No data available.</p>

  const score = summary?.score?.score ?? 0
  const scoreTone = score >= 70 ? 'text-rose-600 bg-rose-50 border-rose-200'
    : score >= 40 ? 'text-amber-600 bg-amber-50 border-amber-200'
    : 'text-slate-600 bg-slate-50 border-slate-200'
  const scoreLabel = score >= 70 ? 'HOT' : score >= 40 ? 'WARM' : score >= 15 ? 'COOL' : 'COLD'

  return (
    <div className="space-y-4">
      {/* Lead brief — score + AI summary + next steps */}
      <Card>
        <CardHeader className="flex flex-row items-start justify-between space-y-0 pb-3">
          <div className="flex items-start gap-3">
            <div className={`flex flex-col items-center justify-center rounded-lg border px-4 py-3 ${scoreTone}`}>
              <div className="text-3xl font-bold leading-none">{score}</div>
              <div className="mt-1 text-[10px] font-semibold uppercase tracking-wider">{scoreLabel}</div>
            </div>
            <div>
              <CardTitle className="text-lg">Lead brief</CardTitle>
              <p className="mt-0.5 text-xs text-muted-foreground">
                {summary?.score?.reasoning || 'Score calculated from message categories.'}
              </p>
            </div>
          </div>
          <div className="flex flex-col items-end gap-1">
            <Button
              size="sm"
              variant="outline"
              className="gap-1.5"
              onClick={regenerate}
              disabled={regenerating}
            >
              {regenerating ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCcw className="h-4 w-4" />}
              {summary?.has_cached ? 'Refresh' : 'Generate'}
            </Button>
            {summary?.is_stale && (
              <Badge variant="outline" className="border-amber-200 bg-amber-50 text-[10px] text-amber-800">
                Stale — refresh recommended
              </Badge>
            )}
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          {summary?.summary?.text ? (
            <div className="rounded-md border border-slate-200 bg-slate-50 p-3 text-sm leading-relaxed text-slate-800">
              <div className="mb-1 flex items-center gap-1 text-[10px] font-semibold uppercase text-slate-500">
                <Bot className="h-3 w-3" /> AI-generated profile
              </div>
              {summary.summary.text}
              <div className="mt-1 text-[10px] text-muted-foreground">
                via {summary.summary.provider} · generated {new Date(summary.summary.generated_at).toLocaleString()} · from {summary.summary.message_count_at_generation} messages
              </div>
            </div>
          ) : (
            <div className="rounded-md border border-dashed bg-slate-50 p-3 text-sm text-muted-foreground">
              No AI summary yet. Hit "Generate" to synthesise this lead's profile + next steps from
              their message history.
            </div>
          )}

          {summary?.summary?.next_steps && summary.summary.next_steps.length > 0 && (
            <div>
              <h3 className="mb-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                Recommended next steps
              </h3>
              <ul className="space-y-1.5">
                {summary.summary.next_steps.map((s, i) => {
                  const meta = ACTION_META[s.action] || { label: s.action, icon: Sparkles }
                  const linkedListing = s.params.listing_id
                    ? feed.listings.find((l) => l.id === s.params.listing_id) || null
                    : null
                  return (
                    <li key={i} className="flex items-start gap-2 rounded-md border bg-white p-2.5 text-sm">
                      <meta.icon className="mt-0.5 h-4 w-4 flex-shrink-0 text-slate-600" />
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2">
                          <span className="font-medium">{meta.label}</span>
                          <Badge
                            variant="outline"
                            className={`text-[10px] ${
                              s.params.priority === 'urgent' ? 'border-rose-200 bg-rose-50 text-rose-800'
                                : s.params.priority === 'high' ? 'border-orange-200 bg-orange-50 text-orange-800'
                                : 'border-slate-200 bg-slate-50 text-slate-600'
                            }`}
                          >
                            {s.params.priority}
                          </Badge>
                          {linkedListing && (
                            <Link to={`/listings/${linkedListing.id}`} className="text-[10px] text-primary hover:underline">
                              → {linkedListing.title}
                            </Link>
                          )}
                        </div>
                        <p className="mt-0.5 text-xs text-muted-foreground">{s.reason}</p>
                        {s.params.template_hint && (
                          <p className="mt-1 rounded border border-dashed border-amber-200 bg-amber-50 px-2 py-1 text-[10px] text-amber-900">
                            <Sparkles className="mr-1 inline h-3 w-3" /> {s.params.template_hint}
                          </p>
                        )}
                      </div>
                    </li>
                  )
                })}
              </ul>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Channel + category filters */}
      <Card>
        <CardHeader className="pb-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <CardTitle className="text-lg">All conversations</CardTitle>
            <div className="text-xs text-muted-foreground">
              {feed.message_count} messages · {feed.channels.length} channel{feed.channels.length === 1 ? '' : 's'} · {feed.listings.length} listing{feed.listings.length === 1 ? '' : 's'}
            </div>
          </div>
        </CardHeader>
        <CardContent className="space-y-3">
          {/* Channel pills */}
          <div className="flex flex-wrap gap-1.5">
            <button
              type="button"
              onClick={() => setChannelFilter(null)}
              className={`inline-flex items-center gap-1 rounded-full border px-2.5 py-1 text-xs transition-colors ${
                channelFilter === null ? 'border-slate-900 bg-slate-900 text-white' : 'border-slate-200 bg-white text-slate-700 hover:bg-slate-50'
              }`}
            >
              All channels
              <span className="text-[10px] opacity-70">({feed.message_count})</span>
            </button>
            {feed.channels.map((ch) => {
              const meta = CHANNEL_META[ch] || { label: ch, icon: MessageSquare, color: 'text-slate-600' }
              const count = feed.messages.filter((m) => m.channel === ch).length
              return (
                <button
                  key={ch}
                  type="button"
                  onClick={() => setChannelFilter(ch)}
                  className={`inline-flex items-center gap-1 rounded-full border px-2.5 py-1 text-xs transition-colors ${
                    channelFilter === ch ? 'border-slate-900 bg-slate-900 text-white' : 'border-slate-200 bg-white text-slate-700 hover:bg-slate-50'
                  }`}
                >
                  <meta.icon className={`h-3.5 w-3.5 ${channelFilter === ch ? '' : meta.color}`} />
                  {meta.label}
                  <span className="text-[10px] opacity-70">({count})</span>
                </button>
              )
            })}
          </div>

          {/* Category filter chips */}
          {Object.keys(categoryCounts).length > 0 && (
            <div className="flex flex-wrap gap-1">
              <button
                type="button"
                onClick={() => setCategoryFilter(null)}
                className={`rounded-full border px-2 py-0.5 text-[10px] ${
                  categoryFilter === null ? 'border-slate-900 bg-slate-900 text-white' : 'border-slate-200 bg-white text-slate-600 hover:bg-slate-50'
                }`}
              >
                All categories
              </button>
              {Object.entries(categoryCounts).sort(([, a], [, b]) => b - a).map(([cat, n]) => (
                <button
                  key={cat}
                  type="button"
                  onClick={() => setCategoryFilter(cat)}
                  className={`rounded-full border px-2 py-0.5 text-[10px] transition-colors ${
                    categoryFilter === cat
                      ? 'border-slate-900 bg-slate-900 text-white'
                      : (CATEGORY_COLORS[cat] || CATEGORY_COLORS.general)
                  }`}
                >
                  {cat} <span className="opacity-70">({n})</span>
                </button>
              ))}
            </div>
          )}

          {/* Unified message thread */}
          {messages.length === 0 ? (
            <p className="rounded-md border border-dashed bg-slate-50 p-3 text-sm text-muted-foreground">
              No messages match the current filter.
            </p>
          ) : (
            <ul className="space-y-2">
              {messages.map((m) => {
                const chanMeta = CHANNEL_META[m.channel] || { label: m.channel, icon: MessageSquare, color: 'text-slate-600' }
                const catClass = m.category ? CATEGORY_COLORS[m.category] || CATEGORY_COLORS.general : ''
                const linkedListing = m.listing_id ? feed.listings.find((l) => l.id === m.listing_id) : null
                return (
                  <li
                    key={m.id}
                    className={
                      m.direction === 'inbound'
                        ? 'rounded-md bg-slate-50 px-3 py-2 text-sm'
                        : 'ml-8 rounded-md bg-slate-900 px-3 py-2 text-sm text-white'
                    }
                  >
                    <div className="mb-1 flex flex-wrap items-center gap-1.5 text-[10px]">
                      <chanMeta.icon className={`h-3 w-3 ${m.direction === 'inbound' ? chanMeta.color : 'text-white/70'}`} />
                      <span className={m.direction === 'inbound' ? 'text-muted-foreground' : 'text-white/70'}>
                        {chanMeta.label}
                      </span>
                      {m.category && m.direction === 'inbound' && (
                        <span className={`rounded-full border px-1.5 py-0 ${catClass}`}>{m.category}</span>
                      )}
                      {m.needs_agent_attention && (
                        <span className="rounded-full border border-rose-300 bg-rose-100 px-1.5 py-0 text-rose-800">⚑ attn</span>
                      )}
                      {linkedListing && (
                        <Link
                          to={`/listings/${linkedListing.id}`}
                          className={m.direction === 'inbound' ? 'text-primary hover:underline' : 'text-white/80 hover:underline'}
                        >
                          → {linkedListing.title}
                        </Link>
                      )}
                    </div>
                    <div className="whitespace-pre-wrap">{m.content}</div>
                    <div className={`mt-1 flex items-center justify-between gap-2 text-[10px] ${m.direction === 'inbound' ? 'text-muted-foreground' : 'text-white/70'}`}>
                      <span>{new Date(m.created_at).toLocaleString()}</span>
                      {m.direction === 'outbound' && <span>{m.status}</span>}
                    </div>
                  </li>
                )
              })}
            </ul>
          )}
        </CardContent>
      </Card>

      {/* Listings this contact engaged with */}
      {feed.listings.length > 0 && (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-lg">Listings engaged with</CardTitle>
          </CardHeader>
          <CardContent>
            <ul className="grid grid-cols-1 gap-2 sm:grid-cols-2">
              {feed.listings.map((l) => (
                <li key={l.id}>
                  <Link
                    to={`/listings/${l.id}`}
                    className="flex items-center justify-between rounded border bg-white px-3 py-2 text-sm hover:bg-slate-50"
                  >
                    <div className="min-w-0">
                      <div className="line-clamp-1 font-medium">{l.title}</div>
                      <div className="text-xs text-muted-foreground">{l.city || ''}</div>
                    </div>
                    <ChevronRight className="h-4 w-4 text-muted-foreground" />
                  </Link>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      )}

      {/* Silence unused-import warnings for icons kept for the ACTION_META lookup */}
      <div className="hidden">
        <Phone />
      </div>
    </div>
  )
}
