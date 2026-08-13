import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { Loader2, Mail, Phone, Search, Users, UserCheck, UserPlus, Activity } from 'lucide-react'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import { Avatar, AvatarFallback } from '@/components/ui/avatar'
import { useToast } from '@/components/ui/toast'
import { useAuth } from '@/context/AuthContext'
import { api } from '@/api/client'
import { usePageTitle } from '@/lib/usePageTitle'
import { cn } from '@/lib/utils'
import { CrmShell } from '@/components/layout/CrmShell'
import { CmdPageHeader } from '@/components/layout/CmdPageHeader'
import { CmdKpiStrip } from '@/components/layout/CmdKpiStrip'
import { CmdEmptyState } from '@/components/layout/CmdEmptyState'

interface Contact {
  id: string
  name: string
  email: string
  phone: string
  status: string
  source: string
  tags: string[]
  assigned_agent_id: string | null
  last_activity_at: string | null
  created_at: string
}

const STATUS_COLORS: Record<string, string> = {
  lead: 'border-blue-200 bg-blue-50 text-blue-700',
  prospect: 'border-amber-200 bg-amber-50 text-amber-700',
  client: 'border-green-200 bg-green-50 text-green-700',
  archived: 'border-slate-200 bg-slate-50 text-slate-500',
}

const STATUS_FILTERS = [
  { label: 'All', value: '' },
  { label: 'Lead', value: 'lead' },
  { label: 'Prospect', value: 'prospect' },
  { label: 'Client', value: 'client' },
  { label: 'Archived', value: 'archived' },
]

function initials(name: string) {
  return (name || 'U').split(' ').map((n) => n[0]).slice(0, 2).join('').toUpperCase()
}

function relativeTime(iso: string | null) {
  if (!iso) return ''
  const diff = Date.now() - new Date(iso).getTime()
  const days = Math.floor(diff / 86400000)
  if (days === 0) return 'Today'
  if (days === 1) return 'Yesterday'
  if (days < 30) return `${days}d ago`
  return new Date(iso).toLocaleDateString()
}

export function ContactsPage() {
  const { agent } = useAuth()
  const { addToast } = useToast()
  usePageTitle('Contacts')
  const [contacts, setContacts] = useState<Contact[]>([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [statusFilter, setStatusFilter] = useState('')

  useEffect(() => {
    if (!agent) return
    setLoading(true)
    api.getContacts()
      .then(setContacts)
      .catch((e: any) => addToast({ title: 'Failed to load contacts', description: e.message, variant: 'error' }))
      .finally(() => setLoading(false))
  }, [agent])

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    return contacts
      .filter((c) => !statusFilter || c.status === statusFilter)
      .filter(
        (c) =>
          !q ||
          (c.name || '').toLowerCase().includes(q) ||
          (c.email || '').toLowerCase().includes(q) ||
          (c.phone || '').toLowerCase().includes(q) ||
          (c.tags || []).some((t) => t.toLowerCase().includes(q)),
      )
  }, [contacts, search, statusFilter])

  const counts = useMemo(() => ({
    total: contacts.length,
    leads: contacts.filter((c) => c.status === 'lead').length,
    clients: contacts.filter((c) => c.status === 'client').length,
    active: contacts.filter((c) => {
      if (!c.last_activity_at) return false
      return Date.now() - new Date(c.last_activity_at).getTime() < 7 * 86400000
    }).length,
  }), [contacts])

  return (
    <CrmShell>
      <CmdPageHeader
        title="Contacts"
        subtitle={`${counts.total} total`}
      />

      <CmdKpiStrip
        items={[
          { label: 'Total contacts', value: counts.total, icon: <Users className="h-4 w-4 text-muted-foreground" /> },
          { label: 'Leads', value: counts.leads, icon: <UserPlus className="h-4 w-4 text-muted-foreground" /> },
          { label: 'Clients', value: counts.clients, icon: <UserCheck className="h-4 w-4 text-muted-foreground" /> },
          { label: 'Active (7d)', value: counts.active, icon: <Activity className="h-4 w-4 text-muted-foreground" /> },
        ]}
      />

      {/* Search + filter toolbar */}
      <div className="flex shrink-0 items-center gap-3 border-b border-[#E4E3E0] bg-white px-6 py-2">
        <div className="relative flex-1 max-w-xs">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            placeholder="Search contacts..."
            className="h-8 pl-9 text-sm"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
        <div className="flex items-center gap-1">
          {STATUS_FILTERS.map((f) => (
            <button
              key={f.value}
              onClick={() => setStatusFilter(f.value)}
              className={cn(
                'rounded-md px-3 py-1 text-xs font-medium transition-colors',
                statusFilter === f.value
                  ? 'bg-[#0F0F0F] text-white'
                  : 'text-muted-foreground hover:bg-[#F0EFED] hover:text-foreground',
              )}
            >
              {f.label}
            </button>
          ))}
        </div>
        <span className="ml-auto text-xs text-muted-foreground">{filtered.length} contacts</span>
      </div>

      {/* Contact list */}
      <div className="flex-1 overflow-y-auto">
        {loading ? (
          <div className="flex justify-center py-16">
            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
          </div>
        ) : filtered.length === 0 ? (
          <CmdEmptyState
            icon={<Users className="h-8 w-8" />}
            title="No contacts found"
            description={search ? 'Try a different search term.' : 'Contacts are created from inquiries, messages, and form submissions.'}
          />
        ) : (
          <div className="divide-y divide-[#E4E3E0]">
            {filtered.map((c) => (
              <Link
                key={c.id}
                to={`/contacts/${c.id}`}
                className="flex items-center gap-4 bg-white px-6 py-3.5 transition-colors hover:bg-[#F8F8F7]"
              >
                <Avatar className="h-9 w-9 shrink-0">
                  <AvatarFallback className="bg-[#F0EFED] text-[#0F0F0F] text-xs font-semibold">
                    {initials(c.name)}
                  </AvatarFallback>
                </Avatar>

                {/* Name + meta */}
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-medium">{c.name || 'Unknown'}</span>
                    <Badge
                      variant="outline"
                      className={cn('text-[10px] capitalize', STATUS_COLORS[c.status] || 'border-slate-200 bg-slate-50')}
                    >
                      {c.status}
                    </Badge>
                  </div>
                  <div className="mt-0.5 flex flex-wrap items-center gap-3 text-xs text-muted-foreground">
                    {c.email && (
                      <span className="flex items-center gap-1 truncate">
                        <Mail className="h-3 w-3 shrink-0" /> {c.email}
                      </span>
                    )}
                    {c.phone && (
                      <span className="flex items-center gap-1">
                        <Phone className="h-3 w-3 shrink-0" /> {c.phone}
                      </span>
                    )}
                  </div>
                </div>

                {/* Tags */}
                {c.tags.length > 0 && (
                  <div className="hidden flex-wrap gap-1 lg:flex">
                    {c.tags.slice(0, 3).map((tag) => (
                      <Badge key={tag} variant="secondary" className="text-[10px]">{tag}</Badge>
                    ))}
                    {c.tags.length > 3 && (
                      <Badge variant="secondary" className="text-[10px]">+{c.tags.length - 3}</Badge>
                    )}
                  </div>
                )}

                {/* Last activity */}
                <span className="hidden shrink-0 text-xs text-muted-foreground sm:block">
                  {relativeTime(c.last_activity_at || c.created_at)}
                </span>
              </Link>
            ))}
          </div>
        )}
      </div>
    </CrmShell>
  )
}
