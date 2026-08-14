import { useEffect, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { ArrowLeft, Check, Clock, Loader2, Mail, MessageSquare, Phone, Plus, Sparkles, Tag, User } from 'lucide-react'
import { Contact360Panel } from '@/components/contact-360/Contact360Panel'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Avatar, AvatarFallback } from '@/components/ui/avatar'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { useToast } from '@/components/ui/toast'
import { useAuth } from '@/context/AuthContext'
import { api } from '@/api/client'
import { usePageTitle } from '@/lib/usePageTitle'
import { cn } from '@/lib/utils'

interface Contact {
  id: string
  name: string
  email: string
  phone: string
  status: string
  source: string
  tags: string[]
  assigned_agent_id: string | null
  first_touch_channel: string
  first_touch_at: string
  last_activity_at: string | null
  created_at: string
}

interface TimelineEvent {
  id: string
  type: string
  title: string
  timestamp: string
  actor: string
  data: any
}

const TYPE_COLORS: Record<string, string> = {
  note: 'bg-purple-100 text-purple-700',
  task: 'bg-amber-100 text-amber-700',
  task_completed: 'bg-green-100 text-green-700',
  viewing: 'bg-blue-100 text-blue-700',
  opportunity: 'bg-emerald-100 text-emerald-700',
  stage_change: 'bg-indigo-100 text-indigo-700',
  message: 'bg-cyan-100 text-cyan-700',
  activity: 'bg-slate-100 text-slate-700',
}

const TYPE_ICONS: Record<string, any> = {
  message: MessageSquare,
}

export function ContactDetailPage() {
  const { id } = useParams<{ id: string }>()
  const { agent } = useAuth()
  const { addToast } = useToast()
  usePageTitle('Contact')
  const [contact, setContact] = useState<Contact | null>(null)
  const [timeline, setTimeline] = useState<TimelineEvent[]>([])
  const [notes, setNotes] = useState<any[]>([])
  const [tasks, setTasks] = useState<any[]>([])
  const [opportunities, setOpportunities] = useState<any[]>([])
  const [loading, setLoading] = useState(true)
  const [noteContent, setNoteContent] = useState('')
  const [savingNote, setSavingNote] = useState(false)
  const [tagInput, setTagInput] = useState('')

  const loadAll = async () => {
    if (!id) return
    try {
      const [c, tl, nt, ts, opps] = await Promise.all([
        api.getContact(id),
        api.getContactTimeline(id).catch(() => ({ events: [] })),
        api.getContactNotes(id).catch(() => []),
        api.getTasks({ contact_id: id, limit: '50' }).catch(() => ({ items: [] })),
        api.getOpportunities().catch(() => []),
      ])
      setContact(c)
      setTimeline(tl.events || [])
      setNotes(nt || [])
      setTasks((ts.items || []).filter((t: any) => t.contact_id === id))
      setOpportunities((opps || []).filter((o: any) => o.contact_id === id))
    } catch (e: any) {
      addToast({ title: 'Failed to load contact', description: e.message, variant: 'error' })
    }
  }

  useEffect(() => {
    if (!agent || !id) return
    setLoading(true)
    loadAll().then(() => setLoading(false))
  }, [agent, id])

  const handleAddNote = async () => {
    if (!id || !noteContent.trim()) return
    setSavingNote(true)
    try {
      await api.createContactNote(id, noteContent.trim())
      setNoteContent('')
      await loadAll()
      addToast({ title: 'Note added', variant: 'success' })
    } catch (e: any) {
      addToast({ title: 'Failed to add note', description: e.message, variant: 'error' })
    } finally {
      setSavingNote(false)
    }
  }

  const handleAddTag = async () => {
    if (!contact || !tagInput.trim()) return
    const nextTags = Array.from(new Set([...contact.tags, tagInput.trim()]))
    try {
      await api.updateContact(contact.id, { tags: nextTags })
      setContact((prev) => (prev ? { ...prev, tags: nextTags } : prev))
      setTagInput('')
    } catch (e: any) {
      addToast({ title: 'Failed to add tag', description: e.message, variant: 'error' })
    }
  }

  const handleCompleteTask = async (taskId: string) => {
    try {
      await api.completeTask(taskId)
      await loadAll()
      addToast({ title: 'Task completed', variant: 'success' })
    } catch (e: any) {
      addToast({ title: 'Failed to complete task', description: e.message, variant: 'error' })
    }
  }

  const initials = (name: string) =>
    (name || 'U')
      .split(' ')
      .map((n) => n[0])
      .slice(0, 2)
      .join('')
      .toUpperCase()

  const statusColor = (status: string) => {
    const map: Record<string, string> = {
      lead: 'bg-blue-100 text-blue-700',
      prospect: 'bg-amber-100 text-amber-700',
      client: 'bg-green-100 text-green-700',
      archived: 'bg-slate-100 text-slate-700',
    }
    return map[status] || 'bg-slate-100'
  }

  if (loading || !contact) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-muted/20">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-muted/20">
      <div className="mx-auto max-w-5xl px-4 py-6 sm:px-6 lg:px-8">
        <div className="mb-6 flex items-center gap-3">
          <Link to="/contacts"><Button variant="outline" size="icon"><ArrowLeft className="h-4 w-4" /></Button></Link>
          <div className="flex-1">
            <h1 className="text-2xl font-bold">{contact.name || 'Unknown'}</h1>
            <p className="text-sm text-muted-foreground">Source: {contact.source || contact.first_touch_channel}</p>
          </div>
          <Link to="/dashboard/inbox"><Button variant="outline">Open inbox</Button></Link>
        </div>

        <div className="grid gap-6 lg:grid-cols-[320px_1fr]">
          <Card>
            <CardContent className="p-6">
              <div className="flex flex-col items-center text-center">
                <Avatar className="h-20 w-20">
                  <AvatarFallback className="bg-primary/10 text-primary text-2xl">{initials(contact.name)}</AvatarFallback>
                </Avatar>
                <h2 className="mt-3 text-lg font-semibold">{contact.name || 'Unknown'}</h2>
                <Badge variant="outline" className={cn('mt-1', statusColor(contact.status))}>{contact.status}</Badge>
              </div>
              <div className="mt-6 space-y-3 text-sm">
                {contact.email && (
                  <div className="flex items-center gap-2 text-muted-foreground">
                    <Mail className="h-4 w-4" />
                    <a href={`mailto:${contact.email}`} className="text-foreground hover:underline">{contact.email}</a>
                  </div>
                )}
                {contact.phone && (
                  <div className="flex items-center gap-2 text-muted-foreground">
                    <Phone className="h-4 w-4" />
                    <a href={`tel:${contact.phone}`} className="text-foreground hover:underline">{contact.phone}</a>
                  </div>
                )}
                <div className="flex items-center gap-2 text-muted-foreground">
                  <User className="h-4 w-4" />
                  <span>First touch: {new Date(contact.first_touch_at).toLocaleDateString()}</span>
                </div>
                {contact.last_activity_at && (
                  <div className="flex items-center gap-2 text-muted-foreground">
                    <Clock className="h-4 w-4" />
                    <span>Last activity: {new Date(contact.last_activity_at).toLocaleString()}</span>
                  </div>
                )}
              </div>

              <div className="mt-6">
                <h3 className="mb-2 text-sm font-semibold">Tags</h3>
                <div className="flex flex-wrap gap-1">
                  {contact.tags.map((tag) => (
                    <Badge key={tag} variant="secondary" className="text-[10px]">{tag}</Badge>
                  ))}
                </div>
                <div className="mt-2 flex gap-2">
                  <Input
                    placeholder="Add tag"
                    value={tagInput}
                    onChange={(e) => setTagInput(e.target.value)}
                    className="h-8 text-xs"
                  />
                  <Button size="sm" onClick={handleAddTag} disabled={!tagInput.trim()}><Plus className="h-3 w-3" /></Button>
                </div>
              </div>
            </CardContent>
          </Card>

          <Tabs defaultValue="contact360">
            <TabsList className="mb-4">
              <TabsTrigger value="contact360" className="gap-1">
                <Sparkles className="h-3.5 w-3.5 text-amber-500" />
                Contact 360
              </TabsTrigger>
              <TabsTrigger value="timeline">Timeline</TabsTrigger>
              <TabsTrigger value="tasks">Tasks ({tasks.length})</TabsTrigger>
              <TabsTrigger value="opportunities">Deals ({opportunities.length})</TabsTrigger>
              <TabsTrigger value="notes">Notes ({notes.length})</TabsTrigger>
            </TabsList>

            <TabsContent value="contact360">
              <Contact360Panel contactId={contact.id} />
            </TabsContent>

            <TabsContent value="timeline">
              <Card>
                <CardHeader><CardTitle className="text-base">Activity timeline</CardTitle></CardHeader>
                <CardContent className="p-0">
                  {timeline.length === 0 ? (
                    <p className="py-8 text-center text-muted-foreground">No timeline events yet.</p>
                  ) : (
                    <div className="divide-y">
                      {timeline.map((event) => (
                        <div key={event.id} className="flex gap-3 p-4">
                          <Badge variant="outline" className={cn('h-fit text-[10px]', TYPE_COLORS[event.type] || 'bg-slate-100')}>
                            {event.type.replace(/_/g, ' ')}
                          </Badge>
                          <div className="flex-1">
                            <p className="text-sm font-medium">{event.title}</p>
                            <p className="text-xs text-muted-foreground">
                              {event.actor} &bull; {new Date(event.timestamp).toLocaleString()}
                            </p>
                            {event.data?.content && <p className="mt-1 text-sm text-muted-foreground">{event.data.content}</p>}
                            {event.data?.notes && <p className="mt-1 text-sm text-muted-foreground">{event.data.notes}</p>}
                            {event.data?.message && <p className="mt-1 text-sm text-muted-foreground">{event.data.message}</p>}
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </CardContent>
              </Card>
            </TabsContent>

            <TabsContent value="tasks">
              <Card>
                <CardHeader><CardTitle className="text-base">Tasks</CardTitle></CardHeader>
                <CardContent className="p-0">
                  {tasks.length === 0 ? (
                    <p className="py-8 text-center text-muted-foreground">No tasks for this contact.</p>
                  ) : (
                    <div className="divide-y">
                      {tasks.map((t) => (
                        <div key={t.id} className="flex items-center justify-between p-4">
                          <div>
                            <p className={cn('text-sm font-medium', t.status === 'completed' && 'line-through text-muted-foreground')}>
                              {t.title}
                            </p>
                            <p className="text-xs text-muted-foreground">Due {new Date(t.due_at).toLocaleString()} &bull; {t.type.replace('_', ' ')}</p>
                          </div>
                          {t.status !== 'completed' && (
                            <Button size="sm" variant="outline" onClick={() => handleCompleteTask(t.id)}>
                              <Check className="mr-1 h-3 w-3" /> Complete
                            </Button>
                          )}
                        </div>
                      ))}
                    </div>
                  )}
                </CardContent>
              </Card>
            </TabsContent>

            <TabsContent value="opportunities">
              <Card>
                <CardHeader><CardTitle className="text-base">Opportunities</CardTitle></CardHeader>
                <CardContent className="p-0">
                  {opportunities.length === 0 ? (
                    <p className="py-8 text-center text-muted-foreground">No deals for this contact.</p>
                  ) : (
                    <div className="divide-y">
                      {opportunities.map((o) => (
                        <div key={o.id} className="p-4">
                          <div className="flex items-center justify-between">
                            <p className="text-sm font-medium capitalize">{o.stage.replace(/_/g, ' ')}</p>
                            <Badge variant="outline">{o.probability}%</Badge>
                          </div>
                          <p className="text-xs text-muted-foreground mt-1">
                            Value: ${o.deal_value != null ? Number(o.deal_value).toLocaleString() : '—'} &bull; Expected close: {o.expected_close_date ? new Date(o.expected_close_date).toLocaleDateString() : '—'}
                          </p>
                          {o.notes && <p className="mt-1 text-sm text-muted-foreground">{o.notes}</p>}
                        </div>
                      ))}
                    </div>
                  )}
                </CardContent>
              </Card>
            </TabsContent>

            <TabsContent value="notes">
              <Card>
                <CardHeader><CardTitle className="text-base">Notes</CardTitle></CardHeader>
                <CardContent>
                  <div className="space-y-3">
                    <textarea
                      rows={3}
                      className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                      placeholder="Add a note..."
                      value={noteContent}
                      onChange={(e) => setNoteContent(e.target.value)}
                    />
                    <div className="flex justify-end">
                      <Button onClick={handleAddNote} disabled={savingNote || !noteContent.trim()}>
                        {savingNote && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                        Add note
                      </Button>
                    </div>
                  </div>
                  <div className="mt-4 space-y-3">
                    {notes.map((n) => (
                      <div key={n.id} className="rounded-md border bg-muted/20 p-3">
                        <p className="text-sm">{n.content}</p>
                        <p className="mt-1 text-xs text-muted-foreground">{n.author_name} &bull; {new Date(n.created_at).toLocaleString()}</p>
                      </div>
                    ))}
                    {notes.length === 0 && <p className="text-sm text-muted-foreground">No notes yet.</p>}
                  </div>
                </CardContent>
              </Card>
            </TabsContent>
          </Tabs>
        </div>
      </div>
    </div>
  )
}
