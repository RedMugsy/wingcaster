import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { CheckCircle2, Filter, Loader2, MessageSquare, Plus, Search, X } from 'lucide-react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Input } from '@/components/ui/input'
import { useAuth } from '@/context/AuthContext'
import { api } from '@/api/client'
import type {
  PlatformMessageTemplate,
  PlatformTemplateCategory,
  PlatformTemplateChannel,
} from '@/types/platformTemplates'
import {
  categoryLabel,
  channelLabel,
  sortTemplatesForList,
} from '@/components/platform-templates/helpers'

const CHANNELS: PlatformTemplateChannel[] = ['email', 'whatsapp', 'sms']
const CATEGORIES: PlatformTemplateCategory[] = ['auth', 'onboarding', 'billing', 'notification', 'marketing']

/**
 * MessageTemplatesPage — admin list of every platform message template.
 *
 * Loads the full list on mount (there are dozens, not thousands — no
 * pagination needed today), then filters CLIENT-SIDE for search + chip
 * toggles. Only includeInactive triggers a fresh backend call because
 * that flag genuinely changes the response set; every other filter
 * narrows what's already on hand.
 *
 * Layout: filter rail on top, results below in a card table. Empty
 * states differ:
 *   * genuinely empty (no templates at all) → seed suggestion
 *   * filtered-empty → "no matches" with a Clear filters button
 *
 * The Create button routes to the edit page in create-mode with the
 * active filter chips passed as query params so the new template
 * inherits the admin's mental context.
 */
export function MessageTemplatesPage() {
  const { isAdmin } = useAuth()
  const [rows, setRows] = useState<PlatformMessageTemplate[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [includeInactive, setIncludeInactive] = useState(false)

  const [search, setSearch] = useState('')
  const [channelFilter, setChannelFilter] = useState<Set<PlatformTemplateChannel>>(new Set())
  const [categoryFilter, setCategoryFilter] = useState<Set<PlatformTemplateCategory>>(new Set())

  const load = async () => {
    setLoading(true)
    setError(null)
    try {
      const res = await api.listPlatformTemplates({ includeInactive })
      setRows(res.templates)
    } catch (err: unknown) {
      setError((err as { message?: string })?.message || 'Failed to load templates')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { if (isAdmin) void load() }, [isAdmin, includeInactive])

  const filtered = useMemo(() => {
    const needle = search.trim().toLowerCase()
    const matchesSearch = (t: PlatformMessageTemplate) => {
      if (!needle) return true
      return (
        t.code.toLowerCase().includes(needle) ||
        t.display_name.toLowerCase().includes(needle) ||
        (t.description || '').toLowerCase().includes(needle)
      )
    }
    const matchesChannel = (t: PlatformMessageTemplate) => channelFilter.size === 0 || channelFilter.has(t.channel)
    const matchesCategory = (t: PlatformMessageTemplate) => categoryFilter.size === 0 || categoryFilter.has(t.category)
    const passed = rows.filter((t) => matchesSearch(t) && matchesChannel(t) && matchesCategory(t))
    return sortTemplatesForList(passed)
  }, [rows, search, channelFilter, categoryFilter])

  const toggleChannel = (c: PlatformTemplateChannel) => {
    setChannelFilter((prev) => {
      const next = new Set(prev)
      if (next.has(c)) next.delete(c); else next.add(c)
      return next
    })
  }
  const toggleCategory = (c: PlatformTemplateCategory) => {
    setCategoryFilter((prev) => {
      const next = new Set(prev)
      if (next.has(c)) next.delete(c); else next.add(c)
      return next
    })
  }
  const clearAllFilters = () => {
    setSearch('')
    setChannelFilter(new Set())
    setCategoryFilter(new Set())
    setIncludeInactive(false)
  }

  const anyFilterActive = search.trim().length > 0 || channelFilter.size > 0 || categoryFilter.size > 0 || includeInactive

  const createHref = useMemo(() => {
    const params = new URLSearchParams()
    if (channelFilter.size === 1) params.set('channel', [...channelFilter][0])
    if (categoryFilter.size === 1) params.set('category', [...categoryFilter][0])
    const qs = params.toString()
    return qs ? `/admin/message-templates/new?${qs}` : '/admin/message-templates/new'
  }, [channelFilter, categoryFilter])

  if (!isAdmin) {
    return (
      <div className="container mx-auto max-w-2xl px-4 py-8">
        <Card>
          <CardHeader><CardTitle>Platform admin required</CardTitle></CardHeader>
          <CardContent className="text-sm text-muted-foreground">
            Platform message templates are restricted to platform administrators.
          </CardContent>
        </Card>
      </div>
    )
  }

  return (
    <div className="container mx-auto max-w-6xl px-4 py-6">
      {/* Header */}
      <div className="mb-6 flex items-start justify-between gap-4">
        <div>
          <h1 className="flex items-center gap-2 font-display text-2xl font-semibold tracking-tight">
            <MessageSquare className="h-6 w-6" aria-hidden />
            Platform message templates
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Editable copy for messages the platform sends to tenants — signup OTP, welcome, WhatsApp
            onboarding guide, and any others you add. Every send goes through these; a bad edit is
            recoverable via the versions tab on the edit page.
          </p>
        </div>
        <Button asChild>
          <Link to={createHref}>
            <Plus className="mr-2 h-4 w-4" aria-hidden />
            New template
          </Link>
        </Button>
      </div>

      {/* Filter rail */}
      <Card className="mb-4">
        <CardContent className="space-y-3 p-4">
          <div className="flex items-center gap-2">
            <Search className="h-4 w-4 text-muted-foreground" aria-hidden />
            <Input
              type="search"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search by code, name, or description…"
              aria-label="Search templates"
            />
            {anyFilterActive && (
              <Button
                variant="outline"
                size="sm"
                onClick={clearAllFilters}
                // Different aria-label from the empty-state button below
                // so tests + screen readers can tell the two apart.
                aria-label="Clear search and filters"
              >
                <X className="mr-1.5 h-3.5 w-3.5" aria-hidden />
                Clear
              </Button>
            )}
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <FilterLabel icon={<Filter className="h-3.5 w-3.5" aria-hidden />}>Channel</FilterLabel>
            {CHANNELS.map((c) => (
              <FilterChip
                key={c}
                active={channelFilter.has(c)}
                onClick={() => toggleChannel(c)}
                aria-pressed={channelFilter.has(c)}
              >
                {channelLabel(c)}
              </FilterChip>
            ))}
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <FilterLabel icon={<Filter className="h-3.5 w-3.5" aria-hidden />}>Category</FilterLabel>
            {CATEGORIES.map((c) => (
              <FilterChip
                key={c}
                active={categoryFilter.has(c)}
                onClick={() => toggleCategory(c)}
                aria-pressed={categoryFilter.has(c)}
              >
                {categoryLabel(c)}
              </FilterChip>
            ))}
          </div>
          <div className="flex items-center gap-2 pt-1 text-sm">
            <input
              id="include-inactive"
              type="checkbox"
              checked={includeInactive}
              onChange={(e) => setIncludeInactive(e.target.checked)}
              className="h-4 w-4 rounded border-input"
            />
            <label htmlFor="include-inactive" className="cursor-pointer">
              Include inactive
            </label>
            <span className="text-xs text-muted-foreground">
              Deactivated templates are hidden by default. The resolver treats them as absent regardless.
            </span>
          </div>
        </CardContent>
      </Card>

      {/* Results */}
      <Card>
        <CardContent className="p-0">
          {loading ? (
            <div role="status" className="flex items-center gap-2 p-8 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
              <span>Loading templates…</span>
            </div>
          ) : error ? (
            <div role="alert" className="m-4 rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-900">
              {error}
              <div className="mt-2">
                <Button variant="outline" size="sm" onClick={() => void load()}>Retry</Button>
              </div>
            </div>
          ) : rows.length === 0 ? (
            <EmptyPage />
          ) : filtered.length === 0 ? (
            <EmptyFilter onClear={clearAllFilters} />
          ) : (
            <TemplateTable rows={filtered} />
          )}
        </CardContent>
      </Card>
    </div>
  )
}

function FilterLabel({ children, icon }: { children: React.ReactNode; icon: React.ReactNode }) {
  return (
    <span className="inline-flex items-center gap-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
      {icon}
      {children}
    </span>
  )
}

function FilterChip({
  children,
  active,
  onClick,
  ...aria
}: {
  children: React.ReactNode
  active: boolean
  onClick: () => void
} & React.AriaAttributes) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`inline-flex items-center gap-1 rounded-full border px-2.5 py-1 text-xs transition-colors ${
        active
          ? 'border-primary bg-primary text-primary-foreground'
          : 'border-border bg-white text-foreground hover:bg-muted/40'
      }`}
      {...aria}
    >
      {active && <CheckCircle2 className="h-3 w-3" aria-hidden />}
      {children}
    </button>
  )
}

function TemplateTable({ rows }: { rows: PlatformMessageTemplate[] }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead className="border-b border-border bg-muted/40 text-left text-xs uppercase tracking-wide text-muted-foreground">
          <tr>
            <th scope="col" className="px-4 py-2 font-semibold">Template</th>
            <th scope="col" className="px-4 py-2 font-semibold">Channel</th>
            <th scope="col" className="px-4 py-2 font-semibold">Category</th>
            <th scope="col" className="px-4 py-2 font-semibold">Scope</th>
            <th scope="col" className="px-4 py-2 font-semibold">Status</th>
            <th scope="col" className="px-4 py-2 font-semibold text-right">Version</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((t) => (
            <tr key={t.id} className="border-b border-border last:border-b-0 hover:bg-muted/30">
              <td className="px-4 py-3">
                <Link
                  to={`/admin/message-templates/${t.id}`}
                  className="block rounded focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                >
                  <div className="font-medium text-foreground">{t.display_name}</div>
                  <div className="mt-0.5 font-mono text-xs text-muted-foreground">{t.code}</div>
                  {t.description && (
                    <div className="mt-0.5 line-clamp-1 text-xs text-muted-foreground">{t.description}</div>
                  )}
                </Link>
              </td>
              <td className="px-4 py-3 text-muted-foreground">{channelLabel(t.channel)}</td>
              <td className="px-4 py-3 text-muted-foreground">{categoryLabel(t.category)}</td>
              <td className="px-4 py-3 text-xs text-muted-foreground">
                <div>
                  {t.language}
                  {t.territory_id ? (
                    <Badge variant="outline" className="ml-2 border-primary text-xs">Territorial</Badge>
                  ) : (
                    <Badge variant="outline" className="ml-2 text-xs">Global</Badge>
                  )}
                </div>
              </td>
              <td className="px-4 py-3">
                <StatusBadges template={t} />
              </td>
              <td className="px-4 py-3 text-right font-mono text-xs text-muted-foreground">v{t.version}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

function StatusBadges({ template }: { template: PlatformMessageTemplate }) {
  const chips: React.ReactNode[] = []
  if (template.is_active) {
    chips.push(
      <Badge key="active" variant="outline" className="border-emerald-300 bg-emerald-50 text-emerald-800">
        Active
      </Badge>,
    )
  } else {
    chips.push(
      <Badge key="inactive" variant="outline" className="border-amber-300 bg-amber-50 text-amber-800">
        Inactive
      </Badge>,
    )
  }
  if (template.is_seed) {
    chips.push(
      <Badge key="seed" variant="outline" className="ml-1.5">Seed</Badge>,
    )
  }
  return <div className="flex flex-wrap items-center">{chips}</div>
}

function EmptyPage() {
  return (
    <div className="p-8 text-center">
      <MessageSquare className="mx-auto mb-3 h-10 w-10 text-muted-foreground" aria-hidden />
      <p className="text-sm font-medium">No platform templates yet.</p>
      <p className="mt-1 text-sm text-muted-foreground">
        The seed migration ships <code>signup_otp</code>, <code>welcome</code>, and{' '}
        <code>whatsapp_welcome</code>. If none appear here, migration 044 hasn't run against this
        database — check the deploy logs.
      </p>
    </div>
  )
}

function EmptyFilter({ onClear }: { onClear: () => void }) {
  return (
    <div className="p-8 text-center">
      <p className="text-sm font-medium">No templates match those filters.</p>
      <p className="mt-1 text-sm text-muted-foreground">Try loosening the search or clearing chips.</p>
      <Button variant="outline" size="sm" className="mt-3" onClick={onClear}>
        Clear all filters
      </Button>
    </div>
  )
}
