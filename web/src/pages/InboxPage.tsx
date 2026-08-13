import { useEffect, useMemo, useRef, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import {
  ArrowLeft,
  Check,
  CheckCheck,
  Clock,
  Inbox,
  Loader2,
  Mail,
  MessageSquare,
  Phone,
  Send,
  User,
  X,
  RefreshCw,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
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
import { CmdEmptyState } from '@/components/layout/CmdEmptyState'

interface Conversation {
  id: string
  contact_id: string
  contact_name: string
  contact_email: string
  contact_phone: string
  source_channel: string
  status: 'open' | 'closed'
  priority: string
  subject?: string
  last_message_at: string | null
  last_message_preview: string
  unread_count: number
  is_unread_by_agent: boolean
  assigned_agent_id: string | null
  created_at: string
  updated_at: string
}

interface ConversationMessage {
  id: string
  conversation_id: string
  direction: 'inbound' | 'outbound'
  channel: string
  provider: string | null
  content: string
  content_type: string
  status: 'received' | 'sent' | 'delivered' | 'read' | 'failed' | 'pending'
  created_at: string
  created_by_agent_id: string | null
  failed_reason: string | null
}

interface Contact {
  id: string
  name: string
  email: string
  phone: string
  status: string
  tags: string[]
  source: string
  assigned_agent_id: string | null
  created_at: string
}

const CHANNEL_LABELS: Record<string, string> = {
  whatsapp: 'WhatsApp',
  sms: 'SMS',
  email: 'Email',
  instagram_dm: 'Instagram DM',
  instagram_comment: 'Instagram Comment',
  instagram: 'Instagram',
  tiktok: 'TikTok',
  tiktok_dm: 'TikTok DM',
  tiktok_comment: 'TikTok Comment',
  x: 'X',
  x_dm: 'X DM',
  x_mention: 'X Mention',
  facebook_messenger: 'Facebook Messenger',
  facebook_comment: 'Facebook Comment',
  linkedin: 'LinkedIn',
  linkedin_comment: 'LinkedIn Comment',
}

const CHANNEL_ICONS: Record<string, React.ReactNode> = {
  email: <Mail className="h-3 w-3" />,
  instagram_comment: <MessageSquare className="h-3 w-3" />,
  facebook_comment: <MessageSquare className="h-3 w-3" />,
  tiktok_comment: <MessageSquare className="h-3 w-3" />,
  x_mention: <MessageSquare className="h-3 w-3" />,
  linkedin_comment: <MessageSquare className="h-3 w-3" />,
}

const STATUS_COLORS: Record<string, string> = {
  open: 'bg-emerald-100 text-emerald-700 border-emerald-200',
  closed: 'bg-slate-100 text-slate-700 border-slate-200',
}

function formatMessageTime(iso: string | null) {
  if (!iso) return ''
  const d = new Date(iso)
  return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
}

function formatDateLabel(iso: string | null) {
  if (!iso) return ''
  const d = new Date(iso)
  const today = new Date()
  const isToday = d.toDateString() === today.toDateString()
  const yesterday = new Date(today)
  yesterday.setDate(yesterday.getDate() - 1)
  const isYesterday = d.toDateString() === yesterday.toDateString()
  if (isToday) return 'Today'
  if (isYesterday) return 'Yesterday'
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
}

function groupMessagesByDay(messages: ConversationMessage[]) {
  const groups: Record<string, ConversationMessage[]> = {}
  messages.forEach((m) => {
    const label = formatDateLabel(m.created_at)
    if (!groups[label]) groups[label] = []
    groups[label].push(m)
  })
  return Object.entries(groups)
}

export function InboxPage() {
  const { agent } = useAuth()
  const { addToast } = useToast()
  usePageTitle('Inbox')

  const [searchParams, setSearchParams] = useSearchParams()
  const initialConversationId = searchParams.get('conversation')

  const [loading, setLoading] = useState(true)
  const [conversations, setConversations] = useState<Conversation[]>([])
  const [selectedId, setSelectedId] = useState<string | null>(initialConversationId)
  const [threadLoading, setThreadLoading] = useState(false)
  const [activeConversation, setActiveConversation] = useState<Conversation | null>(null)
  const [messages, setMessages] = useState<ConversationMessage[]>([])
  const [contact, setContact] = useState<Contact | null>(null)
  const [draft, setDraft] = useState('')
  const [sending, setSending] = useState(false)
  const [closing, setClosing] = useState(false)
  const [search, setSearch] = useState('')
  const [statusFilter, setStatusFilter] = useState<'all' | 'open' | 'closed'>('all')
  const messagesEndRef = useRef<HTMLDivElement>(null)
  const composerRef = useRef<HTMLTextAreaElement>(null)

  const loadConversations = async () => {
    try {
      const data = await api.getConversations()
      setConversations(data)
    } catch (e: any) {
      addToast({ title: 'Failed to load inbox', description: e.message || 'Could not load conversations', variant: 'error' })
    }
  }

  const loadThread = async (id: string) => {
    setThreadLoading(true)
    try {
      const data = await api.getConversation(id)
      setActiveConversation(data)
      setMessages(data.messages || [])
      setContact(data.contact || null)
      setSearchParams({ conversation: id }, { replace: true })
    } catch (e: any) {
      addToast({ title: 'Failed to load conversation', description: e.message || 'Could not open thread', variant: 'error' })
    } finally {
      setThreadLoading(false)
    }
  }

  useEffect(() => {
    let mounted = true
    setLoading(true)
    loadConversations().then(() => {
      if (!mounted) return
      setLoading(false)
      if (initialConversationId) {
        loadThread(initialConversationId)
      }
    })
    return () => { mounted = false }
  }, [])

  useEffect(() => {
    if (!selectedId) return
    loadThread(selectedId)
    const interval = setInterval(() => {
      loadThread(selectedId)
      loadConversations()
    }, 8000)
    return () => clearInterval(interval)
  }, [selectedId])

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages])

  const filteredConversations = useMemo(() => {
    const q = search.trim().toLowerCase()
    return conversations
      .filter((c) => {
        if (statusFilter === 'open') return c.status === 'open'
        if (statusFilter === 'closed') return c.status === 'closed'
        return true
      })
      .filter((c) =>
        !q ||
        (c.contact_name || '').toLowerCase().includes(q) ||
        (c.contact_email || '').toLowerCase().includes(q) ||
        (c.contact_phone || '').toLowerCase().includes(q) ||
        (c.last_message_preview || '').toLowerCase().includes(q)
      )
  }, [conversations, search, statusFilter])

  const unreadCount = useMemo(() => conversations.reduce((sum, c) => sum + (c.unread_count || 0), 0), [conversations])

  const handleSelect = (id: string) => {
    setSelectedId(id)
  }

  const handleSend = async () => {
    if (!activeConversation || !draft.trim()) return
    const content = draft.trim()
    setDraft('')
    setSending(true)
    try {
      await api.sendConversationMessage(activeConversation.id, content)
      await loadThread(activeConversation.id)
      await loadConversations()
      composerRef.current?.focus()
    } catch (e: any) {
      setDraft(content)
      addToast({ title: 'Failed to send message', description: e.message || 'Message could not be sent', variant: 'error' })
    } finally {
      setSending(false)
    }
  }

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      handleSend()
    }
  }

  const handleMarkRead = async () => {
    if (!activeConversation) return
    try {
      await api.markConversationRead(activeConversation.id)
      await loadThread(activeConversation.id)
      await loadConversations()
    } catch (e: any) {
      addToast({ title: 'Failed to mark read', description: e.message || 'Could not update read status', variant: 'error' })
    }
  }

  const handleClose = async () => {
    if (!activeConversation) return
    setClosing(true)
    try {
      await api.closeConversation(activeConversation.id, 'Closed by agent')
      await loadThread(activeConversation.id)
      await loadConversations()
      addToast({ title: 'Conversation closed', variant: 'success' })
    } catch (e: any) {
      addToast({ title: 'Failed to close', description: e.message || 'Could not close conversation', variant: 'error' })
    } finally {
      setClosing(false)
    }
  }

  const handleReopen = async () => {
    if (!activeConversation) return
    try {
      await api.updateConversation(activeConversation.id, { status: 'open' })
      await loadThread(activeConversation.id)
      await loadConversations()
    } catch (e: any) {
      addToast({ title: 'Failed to reopen', description: e.message || 'Could not reopen conversation', variant: 'error' })
    }
  }

  const handleAssignMe = async () => {
    if (!activeConversation || !agent) return
    try {
      await api.assignConversation(activeConversation.id, agent.id)
      await loadThread(activeConversation.id)
      await loadConversations()
      addToast({ title: 'Conversation assigned', variant: 'success' })
    } catch (e: any) {
      addToast({ title: 'Failed to assign', description: e.message || 'Could not assign conversation', variant: 'error' })
    }
  }

  const contactInitials = (activeConversation?.contact_name || contact?.name || 'Unknown')
    .split(' ')
    .map((n) => n[0])
    .slice(0, 2)
    .join('')
    .toUpperCase()

  return (
    <CrmShell badges={{ inbox: unreadCount }}>
      <CmdPageHeader
        title="Inbox"
        subtitle={unreadCount > 0 ? `${unreadCount} unread` : 'All conversations'}
        actions={
          <Button
            variant="outline"
            size="sm"
            className="gap-1.5"
            onClick={() => { loadConversations(); if (selectedId) loadThread(selectedId) }}
          >
            <RefreshCw className="h-3.5 w-3.5" /> Refresh
          </Button>
        }
      />

      <div className="flex flex-1 overflow-hidden">
        {/* Conversation list */}
        <div className={cn('flex w-80 shrink-0 flex-col border-r border-[#E4E3E0] bg-white', selectedId && 'hidden lg:flex')}>
          {/* Search + filter */}
          <div className="space-y-2 border-b border-[#E4E3E0] px-4 py-3">
            <Input
              placeholder="Search conversations..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="h-8 text-sm"
            />
            <div className="flex gap-1">
              {(['all', 'open', 'closed'] as const).map((s) => (
                <button
                  key={s}
                  onClick={() => setStatusFilter(s)}
                  className={cn(
                    'flex-1 rounded-md py-1 text-xs font-medium capitalize transition-colors',
                    statusFilter === s
                      ? 'bg-[#0F0F0F] text-white'
                      : 'bg-[#F0EFED] text-muted-foreground hover:bg-[#E8E7E5]',
                  )}
                >
                  {s}
                </button>
              ))}
            </div>
          </div>

          {/* List */}
          <div className="flex-1 overflow-y-auto">
            {loading ? (
              <div className="flex justify-center py-8">
                <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
              </div>
            ) : filteredConversations.length === 0 ? (
              <CmdEmptyState
                icon={<MessageSquare className="h-6 w-6" />}
                title="No conversations"
                description="Messages from all channels will appear here."
                className="py-10"
              />
            ) : (
              <div className="divide-y divide-[#F0EFED]">
                {filteredConversations.map((c) => {
                  const selected = c.id === selectedId
                  return (
                    <button
                      key={c.id}
                      onClick={() => handleSelect(c.id)}
                      className={cn(
                        'flex w-full items-start gap-3 px-4 py-3 text-left transition-colors',
                        selected ? 'bg-[#F0EFED]' : 'hover:bg-[#F8F8F7]',
                      )}
                    >
                      <Avatar className="h-8 w-8 shrink-0">
                        <AvatarFallback className="bg-[#E8E7E5] text-[11px] font-semibold text-[#0F0F0F]">
                          {(c.contact_name || 'U').split(' ').map((n) => n[0]).slice(0, 2).join('').toUpperCase()}
                        </AvatarFallback>
                      </Avatar>
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center justify-between gap-1">
                          <span className={cn('truncate text-sm font-medium', c.unread_count > 0 && !selected && 'text-[#0F0F0F]')}>
                            {c.contact_name || 'Unknown'}
                          </span>
                          <span className="shrink-0 text-[10px] text-muted-foreground">
                            {formatMessageTime(c.last_message_at)}
                          </span>
                        </div>
                        <div className="mt-0.5 flex items-center gap-1.5">
                          <Badge variant="outline" className="h-4 gap-0.5 px-1 text-[10px]">
                            {CHANNEL_ICONS[c.source_channel] ?? null}
                            {CHANNEL_LABELS[c.source_channel] || c.source_channel}
                          </Badge>
                          <span className="truncate text-[11px] text-muted-foreground">
                            {c.last_message_preview || 'No messages'}
                          </span>
                        </div>
                        {c.unread_count > 0 && (
                          <Badge className="mt-1 h-4 min-w-[1rem] bg-[#0F0F0F] px-1.5 text-[10px] text-white">
                            {c.unread_count}
                          </Badge>
                        )}
                      </div>
                    </button>
                  )
                })}
              </div>
            )}
          </div>
        </div>

        {/* Thread view */}
        <div className={cn('flex flex-1 flex-col bg-[#F8F8F7]', !selectedId && 'hidden lg:flex')}>
          {!activeConversation ? (
            <CmdEmptyState
              icon={<Inbox className="h-8 w-8" />}
              title="Select a conversation"
              description="Pick a thread from the list to view messages."
            />
          ) : (
            <>
              {/* Thread header */}
              <div className="flex shrink-0 items-center gap-3 border-b border-[#E4E3E0] bg-white px-5 py-3">
                <Button variant="ghost" size="icon" className="lg:hidden" onClick={() => setSelectedId(null)}>
                  <ArrowLeft className="h-5 w-5" />
                </Button>
                <Avatar className="h-8 w-8 shrink-0">
                  <AvatarFallback className="bg-[#E8E7E5] text-[11px] font-semibold">{contactInitials || 'U'}</AvatarFallback>
                </Avatar>
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-semibold leading-none">{activeConversation.contact_name || 'Unknown'}</p>
                  <div className="mt-0.5 flex items-center gap-2 text-[11px] text-muted-foreground">
                    <Badge variant="outline" className={cn('h-4 px-1 text-[10px]', STATUS_COLORS[activeConversation.status])}>
                      {activeConversation.status}
                    </Badge>
                    <span>{CHANNEL_LABELS[activeConversation.source_channel] || activeConversation.source_channel}</span>
                    {activeConversation.contact_phone && (
                      <span className="flex items-center gap-0.5">
                        <Phone className="h-3 w-3" />{activeConversation.contact_phone}
                      </span>
                    )}
                  </div>
                </div>

                {/* Quick actions */}
                <div className="flex items-center gap-1">
                  {activeConversation.unread_count > 0 && (
                    <Button variant="ghost" size="sm" onClick={handleMarkRead} className="h-8 gap-1 text-xs">
                      <CheckCheck className="h-3.5 w-3.5" /> Read
                    </Button>
                  )}
                  <Button variant="ghost" size="sm" onClick={handleAssignMe} className="h-8 gap-1 text-xs">
                    <User className="h-3.5 w-3.5" /> Assign me
                  </Button>
                  {activeConversation.status === 'closed' ? (
                    <Button variant="outline" size="sm" onClick={handleReopen} className="h-8 text-xs">Reopen</Button>
                  ) : (
                    <Button variant="outline" size="sm" onClick={handleClose} disabled={closing} className="h-8 gap-1 text-xs">
                      {closing ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <X className="h-3.5 w-3.5" />}
                      Close
                    </Button>
                  )}
                </div>
              </div>

              {/* Messages */}
              <div className="flex-1 overflow-y-auto p-5">
                {threadLoading ? (
                  <div className="flex justify-center py-8">
                    <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
                  </div>
                ) : messages.length === 0 ? (
                  <CmdEmptyState
                    icon={<MessageSquare className="h-6 w-6" />}
                    title="No messages yet"
                    className="py-10"
                  />
                ) : (
                  <div className="space-y-6">
                    {groupMessagesByDay(messages).map(([label, dayMessages]) => (
                      <div key={label} className="space-y-3">
                        <div className="flex justify-center">
                          <span className="rounded-full bg-[#E8E7E5] px-3 py-1 text-[10px] text-muted-foreground">{label}</span>
                        </div>
                        {dayMessages.map((m) => {
                          const isInbound = m.direction === 'inbound'
                          return (
                            <div key={m.id} className={cn('flex', isInbound ? 'justify-start' : 'justify-end')}>
                              <div
                                className={cn(
                                  'max-w-[75%] rounded-2xl px-4 py-2 text-sm shadow-sm',
                                  isInbound
                                    ? 'rounded-tl-none bg-white'
                                    : 'rounded-tr-none bg-[#0F0F0F] text-white',
                                )}
                              >
                                <p className="whitespace-pre-wrap">{m.content}</p>
                                <div className={cn('mt-1 flex items-center justify-end gap-1 text-[10px]', isInbound ? 'text-muted-foreground' : 'text-white/60')}>
                                  <span>{formatMessageTime(m.created_at)}</span>
                                  {!isInbound && (
                                    <span>
                                      {m.status === 'read' ? <CheckCheck className="h-3 w-3" /> :
                                        m.status === 'delivered' || m.status === 'sent' ? <Check className="h-3 w-3" /> :
                                          m.status === 'failed' ? <X className="h-3 w-3 text-red-400" /> :
                                            <Clock className="h-3 w-3" />}
                                    </span>
                                  )}
                                </div>
                                {m.failed_reason && (
                                  <p className="mt-1 text-[10px] text-red-400">{m.failed_reason}</p>
                                )}
                              </div>
                            </div>
                          )
                        })}
                      </div>
                    ))}
                    <div ref={messagesEndRef} />
                  </div>
                )}
              </div>

              {/* Composer */}
              <div className="shrink-0 border-t border-[#E4E3E0] bg-white px-5 py-3">
                <div className="flex items-end gap-2">
                  <textarea
                    ref={composerRef}
                    value={draft}
                    onChange={(e) => setDraft(e.target.value)}
                    onKeyDown={handleKeyDown}
                    placeholder="Type a message…"
                    rows={1}
                    disabled={activeConversation.status === 'closed'}
                    className="max-h-32 min-h-[40px] flex-1 resize-y rounded-xl border border-[#E4E3E0] bg-background px-3 py-2 text-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0F0F0F] disabled:cursor-not-allowed disabled:opacity-50"
                  />
                  <Button
                    size="icon"
                    className="h-10 w-10 shrink-0 rounded-xl bg-[#0F0F0F] hover:bg-[#2F2F2F]"
                    onClick={handleSend}
                    disabled={sending || !draft.trim() || activeConversation.status === 'closed'}
                  >
                    {sending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
                  </Button>
                </div>
                {activeConversation.status === 'closed' && (
                  <p className="mt-1.5 text-[11px] text-muted-foreground">
                    Conversation closed — <button onClick={handleReopen} className="underline hover:text-foreground">reopen</button> to reply.
                  </p>
                )}
              </div>
            </>
          )}
        </div>
      </div>
    </CrmShell>
  )
}
