import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { ArrowLeft, Loader2, Plus, Save, Trash2, RefreshCw, MessageSquare, MessageSquareText, Mail, Smartphone, Eye, X } from 'lucide-react'
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
import { CmdEmptyState } from '@/components/layout/CmdEmptyState'

interface MessageTemplate {
  id: string
  name: string
  channel: 'whatsapp' | 'sms' | 'email'
  category: 'greeting' | 'follow_up' | 'viewing' | 'offer' | 'general'
  subject: string | null
  body: string
  variables: string[]
  language: string
  approval_status: string
  owner_type: 'agent' | 'agency' | 'platform'
  owner_id: string | null
  is_default: boolean
  usage_count: number
  created_at: string
  updated_at: string
}

const CHANNELS: { value: MessageTemplate['channel']; label: string; icon: React.ComponentType<{ className?: string }> }[] = [
  { value: 'whatsapp', label: 'WhatsApp', icon: MessageSquare },
  { value: 'sms', label: 'SMS', icon: Smartphone },
  { value: 'email', label: 'Email', icon: Mail },
]

const CATEGORIES: { value: MessageTemplate['category']; label: string }[] = [
  { value: 'greeting', label: 'Greeting' },
  { value: 'follow_up', label: 'Follow-up' },
  { value: 'viewing', label: 'Viewing' },
  { value: 'offer', label: 'Offer' },
  { value: 'general', label: 'General' },
]

const VARIABLE_SUGGESTIONS = [
  'client_name',
  'agent_name',
  'property_title',
  'property_address',
  'viewing_date',
  'price',
  'inquiry_message',
]

function channelLabel(channel: string) {
  return CHANNELS.find((c) => c.value === channel)?.label || channel
}

function categoryLabel(category: string) {
  return CATEGORIES.find((c) => c.value === category)?.label || category
}

export function MessageTemplatesPage() {
  const { agent } = useAuth()
  const { addToast } = useToast()
  usePageTitle('Message Templates')

  const [templates, setTemplates] = useState<MessageTemplate[]>([])
  const [loading, setLoading] = useState(true)
  const [channelFilter, setChannelFilter] = useState<string>('all')
  const [categoryFilter, setCategoryFilter] = useState<string>('all')
  const [editing, setEditing] = useState<MessageTemplate | null>(null)
  const [saving, setSaving] = useState(false)
  const [previewVariables, setPreviewVariables] = useState<Record<string, string>>({
    client_name: 'John Doe',
    agent_name: agent?.name || 'Agent',
    property_title: 'Luxury Apartment in Beirut',
    property_address: 'Achrafieh, Beirut',
    viewing_date: new Date().toLocaleString(),
    price: '$850,000',
    inquiry_message: 'I am interested in this property.',
  })
  const [renderedPreview, setRenderedPreview] = useState<{ body: string; subject: string | null; missing_variables: string[] } | null>(null)
  const [rendering, setRendering] = useState(false)

  const emptyForm = useMemo(
    () => ({
      name: '',
      channel: 'whatsapp' as MessageTemplate['channel'],
      category: 'general' as MessageTemplate['category'],
      subject: '',
      body: '',
      language: 'en',
      owner_type: 'agent' as 'agent' | 'agency',
    }),
    [],
  )

  const [form, setForm] = useState(emptyForm)

  const loadTemplates = async () => {
    try {
      const params: Record<string, string> = {}
      if (channelFilter !== 'all') params.channel = channelFilter
      if (categoryFilter !== 'all') params.category = categoryFilter
      const rows = await api.getMessageTemplates(params)
      setTemplates(rows || [])
    } catch (e: any) {
      addToast({ title: 'Failed to load templates', description: e.message, variant: 'error' })
    }
  }

  useEffect(() => {
    if (!agent) return
    setLoading(true)
    loadTemplates().finally(() => setLoading(false))
  }, [agent, channelFilter, categoryFilter])

  const startNew = () => {
    setEditing(null)
    setForm(emptyForm)
    setRenderedPreview(null)
  }

  const startEdit = (tpl: MessageTemplate) => {
    setEditing(tpl)
    setForm({
      name: tpl.name,
      channel: tpl.channel,
      category: tpl.category,
      subject: tpl.subject || '',
      body: tpl.body,
      language: tpl.language,
      owner_type: tpl.owner_type === 'agency' ? 'agency' : 'agent',
    })
    setRenderedPreview(null)
  }

  const handleSave = async () => {
    if (!form.name.trim() || !form.body.trim()) {
      addToast({ title: 'Validation error', description: 'Name and body are required', variant: 'error' })
      return
    }
    if (form.channel === 'email' && !form.subject.trim()) {
      addToast({ title: 'Validation error', description: 'Email templates require a subject', variant: 'error' })
      return
    }

    setSaving(true)
    try {
      const payload = {
        ...form,
        subject: form.channel === 'email' ? form.subject : null,
        owner_type: editing ? undefined : form.owner_type,
      }

      if (editing) {
        await api.updateMessageTemplate(editing.id, payload)
        addToast({ title: 'Template updated', variant: 'success' })
      } else {
        await api.createMessageTemplate(payload)
        addToast({ title: 'Template created', variant: 'success' })
      }
      setEditing(null)
      setForm(emptyForm)
      setRenderedPreview(null)
      await loadTemplates()
    } catch (e: any) {
      addToast({ title: 'Failed to save template', description: e.message, variant: 'error' })
    } finally {
      setSaving(false)
    }
  }

  const handleDelete = async (tpl: MessageTemplate) => {
    if (!confirm(`Delete template "${tpl.name}"?`)) return
    try {
      await api.deleteMessageTemplate(tpl.id)
      addToast({ title: 'Template deleted', variant: 'success' })
      if (editing?.id === tpl.id) {
        setEditing(null)
        setForm(emptyForm)
      }
      await loadTemplates()
    } catch (e: any) {
      addToast({ title: 'Failed to delete template', description: e.message, variant: 'error' })
    }
  }

  const runPreview = async (tplOrForm: { body: string; subject: string | null; channel: string }) => {
    if (!tplOrForm.body.trim()) return
    setRendering(true)
    try {
      const payload = {
        subject: tplOrForm.channel === 'email' ? tplOrForm.subject : null,
        body: tplOrForm.body,
        variables: Object.keys(previewVariables),
      }
      // If editing an existing template, use the render endpoint; otherwise render client-side.
      if (editing) {
        const result = await api.renderMessageTemplate(editing.id, previewVariables)
        setRenderedPreview(result)
      } else {
        const missing: string[] = []
        const replace = (text: string) =>
          text.replace(/\{\{\s*([a-zA-Z_][a-zA-Z0-9_]*)\s*\}\}/g, (match, key) => {
            if (previewVariables[key] === undefined || previewVariables[key] === null) {
              missing.push(key)
              return match
            }
            return String(previewVariables[key])
          })
        setRenderedPreview({
          body: replace(tplOrForm.body),
          subject: tplOrForm.channel === 'email' ? replace(tplOrForm.subject || '') : null,
          missing_variables: Array.from(new Set(missing)),
        })
      }
    } catch (e: any) {
      addToast({ title: 'Preview failed', description: e.message, variant: 'error' })
    } finally {
      setRendering(false)
    }
  }

  const derivedVariables = useMemo(() => {
    const text = [form.body, form.channel === 'email' ? form.subject : ''].join('\n')
    const matches = text.match(/\{\{\s*([a-zA-Z_][a-zA-Z0-9_]*)\s*\}\}/g) || []
    return Array.from(new Set(matches.map((m) => m.replace(/\{\{\s*|\s*\}\}/g, ''))))
  }, [form.body, form.subject, form.channel])

  return (
    <CrmShell>
      <div className="p-6">
        <CmdPageHeader
          title="Message Templates"
          subtitle={'Reusable messages for WhatsApp, SMS, and email. Use {{variable}} placeholders.'}
          actions={
            <Button onClick={startNew} className="gap-2">
              <Plus className="h-4 w-4" />
              New template
            </Button>
          }
        />

        <div className="mt-6 flex flex-col gap-6 lg:flex-row">
          {/* Left: filters + list */}
          <div className="flex-1 space-y-4">
            <div className="flex flex-wrap gap-3">
              <select
                value={channelFilter}
                onChange={(e) => setChannelFilter(e.target.value)}
                className="h-9 rounded-md border border-input bg-background px-3 text-sm"
              >
                <option value="all">All channels</option>
                {CHANNELS.map((c) => (
                  <option key={c.value} value={c.value}>
                    {c.label}
                  </option>
                ))}
              </select>
              <select
                value={categoryFilter}
                onChange={(e) => setCategoryFilter(e.target.value)}
                className="h-9 rounded-md border border-input bg-background px-3 text-sm"
              >
                <option value="all">All categories</option>
                {CATEGORIES.map((c) => (
                  <option key={c.value} value={c.value}>
                    {c.label}
                  </option>
                ))}
              </select>
            </div>

            {loading ? (
              <div className="flex items-center gap-2 py-12 text-muted-foreground">
                <Loader2 className="h-5 w-5 animate-spin" />
                Loading templates…
              </div>
            ) : templates.length === 0 ? (
              <CmdEmptyState
                icon={<MessageSquareText className="h-8 w-8" />}
                title="No templates yet"
                description="Create your first reusable message template for WhatsApp, SMS, or email."
                action={
                  <Button onClick={startNew}>
                    <Plus className="mr-2 h-4 w-4" />
                    Create template
                  </Button>
                }
              />
            ) : (
              <div className="grid gap-4 md:grid-cols-2">
                {templates.map((tpl) => {
                  const Icon = CHANNELS.find((c) => c.value === tpl.channel)?.icon || MessageSquare
                  return (
                    <div
                      key={tpl.id}
                      onClick={() => startEdit(tpl)}
                      className={cn(
                        'cursor-pointer rounded-lg border bg-white p-4 shadow-sm transition-shadow hover:shadow-md',
                        editing?.id === tpl.id ? 'border-primary ring-1 ring-primary' : 'border-border',
                      )}
                    >
                      <div className="flex items-start justify-between">
                        <div className="flex items-center gap-2">
                          <Icon className="h-4 w-4 text-muted-foreground" />
                          <h3 className="font-medium">{tpl.name}</h3>
                        </div>
                        <div className="flex items-center gap-1">
                          {tpl.is_default && <Badge variant="secondary">Default</Badge>}
                          <Badge variant="outline">{channelLabel(tpl.channel)}</Badge>
                        </div>
                      </div>
                      <p className="mt-2 line-clamp-2 text-sm text-muted-foreground">{tpl.body}</p>
                      <div className="mt-3 flex flex-wrap gap-1">
                        <Badge variant="outline" className="text-xs">
                          {categoryLabel(tpl.category)}
                        </Badge>
                        {tpl.variables.map((v) => (
                          <span key={v} className="rounded bg-slate-100 px-1.5 py-0.5 text-xs text-slate-600">
                            {v}
                          </span>
                        ))}
                      </div>
                    </div>
                  )
                })}
              </div>
            )}
          </div>

          {/* Right: editor + preview */}
          <div className="w-full shrink-0 lg:w-[420px]">
            <div className="sticky top-4 rounded-lg border bg-white p-5 shadow-sm">
              <div className="flex items-center justify-between">
                <h2 className="font-semibold">{editing ? 'Edit template' : 'New template'}</h2>
                {editing && (
                  <div className="flex items-center gap-2">
                    <Button variant="ghost" size="sm" onClick={startNew}>
                      <X className="h-4 w-4" />
                    </Button>
                  </div>
                )}
              </div>

              <div className="mt-4 space-y-4">
                <div>
                  <label className="mb-1 block text-sm font-medium">Name</label>
                  <Input
                    value={form.name}
                    onChange={(e) => setForm({ ...form, name: e.target.value })}
                    placeholder="e.g. New lead welcome"
                  />
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="mb-1 block text-sm font-medium">Channel</label>
                    <select
                      value={form.channel}
                      onChange={(e) => setForm({ ...form, channel: e.target.value as MessageTemplate['channel'] })}
                      className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
                    >
                      {CHANNELS.map((c) => (
                        <option key={c.value} value={c.value}>
                          {c.label}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label className="mb-1 block text-sm font-medium">Category</label>
                    <select
                      value={form.category}
                      onChange={(e) => setForm({ ...form, category: e.target.value as MessageTemplate['category'] })}
                      className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
                    >
                      {CATEGORIES.map((c) => (
                        <option key={c.value} value={c.value}>
                          {c.label}
                        </option>
                      ))}
                    </select>
                  </div>
                </div>

                {!editing && (
                  <div>
                    <label className="mb-1 block text-sm font-medium">Owner</label>
                    <select
                      value={form.owner_type}
                      onChange={(e) => setForm({ ...form, owner_type: e.target.value as 'agent' | 'agency' })}
                      className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
                    >
                      <option value="agent">Just me</option>
                      <option value="agency">My agency</option>
                    </select>
                  </div>
                )}

                {form.channel === 'email' && (
                  <div>
                    <label className="mb-1 block text-sm font-medium">Subject</label>
                    <Input
                      value={form.subject}
                      onChange={(e) => setForm({ ...form, subject: e.target.value })}
                      placeholder="e.g. Viewing confirmed for {{property_title}}"
                    />
                  </div>
                )}

                <div>
                  <label className="mb-1 block text-sm font-medium">Body</label>
                  <textarea
                    value={form.body}
                    onChange={(e) => setForm({ ...form, body: e.target.value })}
                    rows={6}
                    className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-ring"
                    placeholder="Hi {{client_name}}, thank you for your interest in {{property_title}}."
                  />
                </div>

                <div>
                  <label className="mb-1 block text-sm font-medium">Variables used</label>
                  <div className="flex flex-wrap gap-1">
                    {derivedVariables.length === 0 ? (
                      <span className="text-sm text-muted-foreground">None yet. Type {'{{variable_name}}'} in the body.</span>
                    ) : (
                      derivedVariables.map((v) => (
                        <button
                          key={v}
                          type="button"
                          onClick={() => {
                            setPreviewVariables((prev) => ({ ...prev, [v]: prev[v] || '' }))
                          }}
                          className="rounded bg-slate-100 px-2 py-1 text-xs text-slate-700 hover:bg-slate-200"
                        >
                          {v}
                        </button>
                      ))
                    )}
                  </div>
                </div>

                <div className="flex gap-2">
                  <Button onClick={handleSave} disabled={saving} className="flex-1 gap-2">
                    {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
                    {editing ? 'Update template' : 'Create template'}
                  </Button>
                  <Button variant="outline" onClick={() => runPreview(form)} disabled={rendering}>
                    <Eye className="mr-2 h-4 w-4" />
                    Preview
                  </Button>
                </div>

                {editing && (
                  <Button
                    variant="ghost"
                    className="w-full text-destructive hover:bg-destructive/10 hover:text-destructive"
                    onClick={() => handleDelete(editing)}
                  >
                    <Trash2 className="mr-2 h-4 w-4" />
                    Delete template
                  </Button>
                )}
              </div>

              {/* Preview */}
              {renderedPreview && (
                <div className="mt-6 rounded-md border bg-slate-50 p-4">
                  <h3 className="mb-2 text-sm font-medium">Preview</h3>
                  {renderedPreview.subject !== null && (
                    <div className="mb-2 text-sm font-medium">{renderedPreview.subject}</div>
                  )}
                  <div className="whitespace-pre-wrap text-sm text-muted-foreground">{renderedPreview.body}</div>
                  {renderedPreview.missing_variables?.length > 0 && (
                    <div className="mt-2 text-xs text-amber-600">
                      Missing variables: {renderedPreview.missing_variables.join(', ')}
                    </div>
                  )}
                </div>
              )}

              {/* Variable values for preview */}
              <div className="mt-6">
                <h3 className="mb-2 text-sm font-medium">Preview variable values</h3>
                <div className="max-h-40 space-y-2 overflow-y-auto pr-1">
                  {derivedVariables.map((v) => (
                    <div key={v} className="flex items-center gap-2">
                      <span className="w-24 shrink-0 text-xs text-muted-foreground">{v}</span>
                      <Input
                        value={previewVariables[v] || ''}
                        onChange={(e) => setPreviewVariables({ ...previewVariables, [v]: e.target.value })}
                        placeholder="value"
                        className="h-8 text-sm"
                      />
                    </div>
                  ))}
                  {derivedVariables.length === 0 && (
                    <p className="text-xs text-muted-foreground">Add variables to the body to preview them here.</p>
                  )}
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </CrmShell>
  )
}
