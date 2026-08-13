import { useEffect, useMemo, useState } from 'react'
import {
  CheckCircle2,
  CheckSquare,
  Clock,
  Loader2,
  Plus,
  Trash2,
  AlertCircle,
  ListTodo,
} from 'lucide-react'
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

interface Task {
  id: string
  contact_id: string | null
  inquiry_id: string | null
  title: string
  notes: string
  due_at: string
  status: 'pending' | 'completed' | 'cancelled' | 'snoozed'
  priority: 'low' | 'normal' | 'high' | 'urgent'
  type: 'call' | 'email' | 'follow_up' | 'viewing' | 'meeting'
}

const PRIORITY_DOT: Record<string, string> = {
  low: 'bg-slate-300',
  normal: 'bg-blue-400',
  high: 'bg-orange-400',
  urgent: 'bg-red-500',
}

const TYPE_LABEL: Record<string, string> = {
  call: 'Call',
  email: 'Email',
  follow_up: 'Follow-up',
  viewing: 'Viewing',
  meeting: 'Meeting',
}

export function TasksPage() {
  const { agent } = useAuth()
  const { addToast } = useToast()
  usePageTitle('Tasks')

  const [tasks, setTasks] = useState<Task[]>([])
  const [loading, setLoading] = useState(true)
  const [showForm, setShowForm] = useState(false)
  const [creating, setCreating] = useState(false)
  const [form, setForm] = useState({ title: '', due_at: '', priority: 'normal', type: 'follow_up', notes: '' })
  const [statusFilter, setStatusFilter] = useState<'all' | 'pending' | 'completed'>('pending')
  const [priorityFilter, setPriorityFilter] = useState('')

  const loadTasks = async () => {
    try {
      const data = await api.getTasks({ status: statusFilter === 'all' ? '' : statusFilter, limit: '200' })
      setTasks(data.items || [])
    } catch (e: any) {
      addToast({ title: 'Failed to load tasks', description: e.message, variant: 'error' })
    }
  }

  useEffect(() => {
    if (!agent) return
    setLoading(true)
    loadTasks().finally(() => setLoading(false))
  }, [agent, statusFilter])

  const handleCreate = async () => {
    if (!form.title || !form.due_at) return
    setCreating(true)
    try {
      await api.createTask({
        title: form.title,
        due_at: new Date(form.due_at).toISOString(),
        priority: form.priority,
        type: form.type,
        notes: form.notes,
        assigned_to: agent?.id,
      })
      setForm({ title: '', due_at: '', priority: 'normal', type: 'follow_up', notes: '' })
      setShowForm(false)
      await loadTasks()
      addToast({ title: 'Task created', variant: 'success' })
    } catch (e: any) {
      addToast({ title: 'Failed to create task', description: e.message, variant: 'error' })
    } finally {
      setCreating(false)
    }
  }

  const handleComplete = async (id: string) => {
    try {
      await api.completeTask(id)
      setTasks((prev) => prev.map((t) => (t.id === id ? { ...t, status: 'completed' } : t)))
      addToast({ title: 'Task completed', variant: 'success' })
    } catch (e: any) {
      addToast({ title: 'Failed to complete task', description: e.message, variant: 'error' })
    }
  }

  const handleDelete = async (id: string) => {
    if (!confirm('Delete this task?')) return
    try {
      await api.deleteTask(id)
      setTasks((prev) => prev.filter((t) => t.id !== id))
      addToast({ title: 'Task deleted', variant: 'success' })
    } catch (e: any) {
      addToast({ title: 'Failed to delete task', description: e.message, variant: 'error' })
    }
  }

  const now = new Date()
  const overdueCount = useMemo(
    () => tasks.filter((t) => t.status === 'pending' && new Date(t.due_at) < now).length,
    [tasks],
  )
  const todayCount = useMemo(
    () =>
      tasks.filter((t) => {
        if (t.status !== 'pending') return false
        const d = new Date(t.due_at)
        return d.toDateString() === now.toDateString()
      }).length,
    [tasks],
  )
  const urgentCount = useMemo(
    () => tasks.filter((t) => t.status === 'pending' && t.priority === 'urgent').length,
    [tasks],
  )

  const filtered = useMemo(() => {
    let list = tasks
    if (priorityFilter) list = list.filter((t) => t.priority === priorityFilter)
    return list
  }, [tasks, priorityFilter])

  return (
    <CrmShell badges={{ tasks: overdueCount }}>
      <CmdPageHeader
        title="Tasks"
        subtitle={`${tasks.filter((t) => t.status === 'pending').length} pending`}
        actions={
          <Button size="sm" onClick={() => setShowForm((v) => !v)} className="gap-1.5">
            <Plus className="h-4 w-4" /> New task
          </Button>
        }
      />

      <CmdKpiStrip
        items={[
          {
            label: 'Overdue',
            value: overdueCount,
            valueClass: overdueCount > 0 ? 'text-red-600' : undefined,
            icon: <AlertCircle className={cn('h-4 w-4', overdueCount > 0 ? 'text-red-500' : 'text-muted-foreground')} />,
          },
          {
            label: 'Due today',
            value: todayCount,
            valueClass: todayCount > 0 ? 'text-amber-600' : undefined,
            icon: <Clock className="h-4 w-4 text-muted-foreground" />,
          },
          {
            label: 'Urgent',
            value: urgentCount,
            valueClass: urgentCount > 0 ? 'text-orange-600' : undefined,
            icon: <CheckSquare className="h-4 w-4 text-muted-foreground" />,
          },
          {
            label: 'Total pending',
            value: tasks.filter((t) => t.status === 'pending').length,
            icon: <ListTodo className="h-4 w-4 text-muted-foreground" />,
          },
        ]}
      />

      {/* Inline quick-create form */}
      {showForm && (
        <div className="shrink-0 border-b border-[#E4E3E0] bg-white px-6 py-4">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-start">
            <Input
              placeholder="Task title"
              className="flex-1"
              value={form.title}
              autoFocus
              onChange={(e) => setForm((f) => ({ ...f, title: e.target.value }))}
              onKeyDown={(e) => e.key === 'Enter' && handleCreate()}
            />
            <Input
              type="datetime-local"
              className="w-48 shrink-0"
              value={form.due_at}
              onChange={(e) => setForm((f) => ({ ...f, due_at: e.target.value }))}
            />
            <select
              className="h-10 w-32 shrink-0 rounded-md border bg-background px-2 text-sm"
              value={form.priority}
              onChange={(e) => setForm((f) => ({ ...f, priority: e.target.value }))}
            >
              <option value="low">Low</option>
              <option value="normal">Normal</option>
              <option value="high">High</option>
              <option value="urgent">Urgent</option>
            </select>
            <select
              className="h-10 w-36 shrink-0 rounded-md border bg-background px-2 text-sm"
              value={form.type}
              onChange={(e) => setForm((f) => ({ ...f, type: e.target.value }))}
            >
              <option value="follow_up">Follow-up</option>
              <option value="call">Call</option>
              <option value="email">Email</option>
              <option value="viewing">Viewing</option>
              <option value="meeting">Meeting</option>
            </select>
            <div className="flex gap-2">
              <Button size="sm" onClick={handleCreate} disabled={creating || !form.title || !form.due_at}>
                {creating ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Save'}
              </Button>
              <Button size="sm" variant="ghost" onClick={() => setShowForm(false)}>Cancel</Button>
            </div>
          </div>
          {/* optional notes row */}
          <Input
            placeholder="Notes (optional)"
            className="mt-2"
            value={form.notes}
            onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))}
          />
        </div>
      )}

      {/* Filter toolbar */}
      <div className="flex shrink-0 items-center gap-2 border-b border-[#E4E3E0] bg-white px-6 py-2">
        {(['pending', 'completed', 'all'] as const).map((s) => (
          <button
            key={s}
            onClick={() => setStatusFilter(s)}
            className={cn(
              'rounded-md px-3 py-1 text-xs font-medium capitalize transition-colors',
              statusFilter === s
                ? 'bg-[#0F0F0F] text-white'
                : 'text-muted-foreground hover:bg-[#F0EFED] hover:text-foreground',
            )}
          >
            {s}
          </button>
        ))}
        <div className="ml-auto flex items-center gap-2">
          <select
            className="h-8 rounded-md border border-[#E4E3E0] bg-background px-2 text-xs text-muted-foreground"
            value={priorityFilter}
            onChange={(e) => setPriorityFilter(e.target.value)}
          >
            <option value="">All priorities</option>
            <option value="urgent">Urgent</option>
            <option value="high">High</option>
            <option value="normal">Normal</option>
            <option value="low">Low</option>
          </select>
        </div>
      </div>

      {/* Task list */}
      <div className="flex-1 overflow-y-auto">
        {loading ? (
          <div className="flex justify-center py-16">
            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
          </div>
        ) : filtered.length === 0 ? (
          <CmdEmptyState
            icon={<CheckSquare className="h-8 w-8" />}
            title="No tasks"
            description="Create a task above to start tracking your follow-ups."
          />
        ) : (
          <div className="divide-y divide-[#E4E3E0]">
            {filtered.map((t) => {
              const isOverdue = t.status === 'pending' && new Date(t.due_at) < now
              const isToday = t.status === 'pending' && new Date(t.due_at).toDateString() === now.toDateString()
              return (
                <div
                  key={t.id}
                  className={cn(
                    'group flex items-start gap-4 bg-white px-6 py-3.5 transition-colors hover:bg-[#F8F8F7]',
                    t.status === 'completed' && 'opacity-60',
                  )}
                >
                  {/* Complete button */}
                  {t.status !== 'completed' ? (
                    <button
                      onClick={() => handleComplete(t.id)}
                      className="mt-0.5 shrink-0 text-muted-foreground hover:text-green-600"
                      title="Mark complete"
                    >
                      <CheckCircle2 className="h-5 w-5" />
                    </button>
                  ) : (
                    <CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0 text-green-500" />
                  )}

                  {/* Priority dot */}
                  <span className={cn('mt-2 h-2 w-2 shrink-0 rounded-full', PRIORITY_DOT[t.priority])} />

                  {/* Content */}
                  <div className="min-w-0 flex-1">
                    <p className={cn('text-sm font-medium', t.status === 'completed' && 'line-through text-muted-foreground')}>
                      {t.title}
                    </p>
                    <div className="mt-0.5 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                      <span>{TYPE_LABEL[t.type] || t.type}</span>
                      <span className="opacity-40">·</span>
                      {isOverdue ? (
                        <span className="font-medium text-red-600">
                          Overdue · {new Date(t.due_at).toLocaleDateString()}
                        </span>
                      ) : isToday ? (
                        <span className="font-medium text-amber-600">
                          Today · {new Date(t.due_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                        </span>
                      ) : (
                        <span>{new Date(t.due_at).toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}</span>
                      )}
                    </div>
                    {t.notes && <p className="mt-1 text-xs text-muted-foreground">{t.notes}</p>}
                  </div>

                  {/* Actions — visible on hover */}
                  <div className="flex shrink-0 items-center gap-1 opacity-0 transition-opacity group-hover:opacity-100">
                    <Badge
                      variant="outline"
                      className={cn('text-[10px]', isOverdue ? 'border-red-200 bg-red-50 text-red-700' : 'border-[#E4E3E0]')}
                    >
                      {t.priority}
                    </Badge>
                    <button
                      onClick={() => handleDelete(t.id)}
                      className="ml-1 rounded p-1 text-muted-foreground hover:bg-red-50 hover:text-red-600"
                      title="Delete"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
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
