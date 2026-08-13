/**
 * CampaignBuilderPage — multi-step wizard for creating / editing a campaign.
 * Step 1: Basics (name, trigger, channel)
 * Step 2: Audience (target rules / tags)
 * Step 3: Steps (message sequence editor)
 * Step 4: Review + publish
 */
import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  ArrowLeft,
  ArrowRight,
  Check,
  ChevronDown,
  ChevronUp,
  Loader2,
  Mail,
  Megaphone,
  MessageSquare,
  Phone,
  Plus,
  Trash2,
  Zap,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Badge } from '@/components/ui/badge'
import { useToast } from '@/components/ui/toast'
import { useAuth } from '@/context/AuthContext'
import { api } from '@/api/client'
import { usePageTitle } from '@/lib/usePageTitle'
import { cn } from '@/lib/utils'
import { CrmShell } from '@/components/layout/CrmShell'
import { CmdPageHeader } from '@/components/layout/CmdPageHeader'

// ─── types ────────────────────────────────────────────────────────────────────

interface Step {
  delay_hours: number
  channel: string
  template_id?: string | null
  subject: string
  body: string
}

interface Template {
  id: string
  name: string
  channel: 'email' | 'sms' | 'whatsapp'
  category: string
  subject: string | null
  body: string
  variables: string[]
  owner_type: 'agent' | 'agency' | 'platform'
  owner_id: string | null
  is_default: boolean
  approval_status: string
  language: string
  usage_count: number
  created_by: string | null
  created_at: string
  updated_at: string
}

interface AudienceRule {
  field: 'status' | 'source' | 'tags' | 'territory'
  operator: 'is' | 'is_not' | 'contains'
  value: string
}

interface FormState {
  name: string
  description: string
  trigger: string
  target_channel: string
  tags_filter: string[]
  audience_rules: AudienceRule[]
  steps: Step[]
}

// ─── constants ────────────────────────────────────────────────────────────────

const TRIGGERS = [
  { value: 'manual', label: 'Manual', description: 'Enroll contacts by hand or via API' },
  { value: 'new_lead', label: 'New lead', description: 'Fires when a new contact is created' },
  { value: 'inquiry', label: 'New inquiry', description: 'Fires when a property inquiry arrives' },
  { value: 'viewing_completed', label: 'Viewing completed', description: 'Fires after a viewing is marked complete' },
  { value: 'tag', label: 'Tag applied', description: 'Fires when a specific tag is added to a contact' },
]

const CHANNELS = [
  { value: 'email', label: 'Email', icon: Mail },
  { value: 'whatsapp', label: 'WhatsApp', icon: MessageSquare },
  { value: 'sms', label: 'SMS', icon: Phone },
]

const AUDIENCE_FIELDS: { value: AudienceRule['field']; label: string }[] = [
  { value: 'status', label: 'Contact status' },
  { value: 'source', label: 'Lead source' },
  { value: 'tags', label: 'Tags' },
  { value: 'territory', label: 'Territory' },
]

const AUDIENCE_OPERATORS: { value: AudienceRule['operator']; label: string }[] = [
  { value: 'is', label: 'is' },
  { value: 'is_not', label: 'is not' },
  { value: 'contains', label: 'contains' },
]

const WIZARD_STEPS = ['Basics', 'Audience', 'Steps', 'Review']

const EMPTY_STEP: Step = { delay_hours: 0, channel: 'email', template_id: null, subject: '', body: '' }

const EMPTY_RULE: AudienceRule = { field: 'status', operator: 'is', value: '' }

const PRESET_TEMPLATES: { label: string; steps: Step[] }[] = [
  {
    label: 'New lead 3-touch',
    steps: [
      { delay_hours: 0, channel: 'email', subject: 'We received your inquiry', body: 'Hi {{client_name}}, thanks for reaching out about {{property_title}}. We\'ll be in touch shortly.' },
      { delay_hours: 48, channel: 'whatsapp', subject: '', body: 'Hi {{client_name}}, following up on your inquiry about {{property_title}}. Are you available for a call?' },
      { delay_hours: 120, channel: 'email', subject: 'Similar properties you may like', body: 'Hi {{client_name}}, here are a few more listings that match your search criteria.' },
    ],
  },
  {
    label: 'Post-viewing nurture',
    steps: [
      { delay_hours: 2, channel: 'whatsapp', subject: '', body: 'Hi {{client_name}}, hope you enjoyed the viewing at {{property_title}}. Any questions?' },
      { delay_hours: 48, channel: 'email', subject: 'Your viewing feedback', body: 'Hi {{client_name}}, we\'d love your thoughts on {{property_title}}. Are you ready to move forward?' },
    ],
  },
  {
    label: 'Re-engagement',
    steps: [
      { delay_hours: 0, channel: 'email', subject: 'We miss you', body: 'Hi {{client_name}}, it\'s been a while! We have new listings that match your previous searches.' },
      { delay_hours: 72, channel: 'whatsapp', subject: '', body: 'Hi {{client_name}}, just checking in. Can we schedule a call to discuss what you\'re looking for?' },
    ],
  },
]

// ─── sub-components ────────────────────────────────────────────────────────────

function WizardProgressBar({ current }: { current: number }) {
  return (
    <div className="flex shrink-0 items-center gap-0 border-b border-[#E4E3E0] bg-white px-6 py-3">
      {WIZARD_STEPS.map((label, i) => (
        <div key={label} className="flex items-center">
          <div className="flex flex-col items-center gap-1">
            <div
              className={cn(
                'flex h-6 w-6 items-center justify-center rounded-full text-xs font-bold',
                i < current
                  ? 'bg-[#0F0F0F] text-white'
                  : i === current
                  ? 'border-2 border-[#0F0F0F] bg-white text-[#0F0F0F]'
                  : 'border border-[#D0CFCD] bg-white text-muted-foreground',
              )}
            >
              {i < current ? <Check className="h-3 w-3" /> : i + 1}
            </div>
            <span className={cn('text-[10px] font-medium', i === current ? 'text-foreground' : 'text-muted-foreground')}>
              {label}
            </span>
          </div>
          {i < WIZARD_STEPS.length - 1 && (
            <div className={cn('mx-2 mb-4 h-px w-12 sm:w-20', i < current ? 'bg-[#0F0F0F]' : 'bg-[#E4E3E0]')} />
          )}
        </div>
      ))}
    </div>
  )
}

function StepEditor({
  step,
  index,
  onUpdate,
  onRemove,
  canRemove,
  templates,
  templatesLoading,
}: {
  step: Step
  index: number
  onUpdate: (s: Step) => void
  onRemove: () => void
  canRemove: boolean
  templates: Template[]
  templatesLoading: boolean
}) {
  const [open, setOpen] = useState(true)
  const ChannelIcon = CHANNELS.find((c) => c.value === step.channel)?.icon ?? Mail
  const selectedTemplate = templates.find((t) => t.id === step.template_id)
  const channelTemplates = templates.filter((t) => t.channel === step.channel)
  const isUsingTemplate = Boolean(selectedTemplate)

  return (
    <div className="rounded-lg border border-[#E4E3E0] bg-white">
      {/* Step header */}
      <div
        className="flex cursor-pointer items-center gap-3 px-4 py-3"
        onClick={() => setOpen((v) => !v)}
      >
        <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-[#F0EFED] text-xs font-semibold">
          {index + 1}
        </div>
        <ChannelIcon className="h-4 w-4 text-muted-foreground" />
        <span className="flex-1 text-sm font-medium truncate">
          {selectedTemplate ? selectedTemplate.name : (step.subject || step.body.slice(0, 60) || 'Untitled step')}
        </span>
        {selectedTemplate && (
          <Badge variant="secondary" className="text-[10px]">Template</Badge>
        )}
        {step.delay_hours > 0 && (
          <Badge variant="outline" className="text-[10px]">+{step.delay_hours}h</Badge>
        )}
        <button
          type="button"
          className="text-muted-foreground hover:text-red-500"
          onClick={(e) => { e.stopPropagation(); if (canRemove) onRemove() }}
          disabled={!canRemove}
        >
          <Trash2 className="h-3.5 w-3.5" />
        </button>
        {open ? <ChevronUp className="h-4 w-4 text-muted-foreground" /> : <ChevronDown className="h-4 w-4 text-muted-foreground" />}
      </div>

      {/* Step body */}
      {open && (
        <div className="space-y-3 border-t border-[#E4E3E0] p-4">
          <div className="space-y-1.5">
            <Label className="text-xs">Template</Label>
            <select
              className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm disabled:opacity-60"
              value={step.template_id || ''}
              disabled={templatesLoading}
              onChange={(e) => {
                const id = e.target.value
                if (!id) {
                  onUpdate({ ...step, template_id: null })
                  return
                }
                const template = templates.find((t) => t.id === id)
                if (!template) return
                onUpdate({
                  ...step,
                  template_id: template.id,
                  channel: template.channel,
                  subject: template.subject || step.subject,
                  body: template.body,
                })
              }}
            >
              <option value="">— Manual message —</option>
              {channelTemplates.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name}{t.is_default ? ' (default)' : ''}
                </option>
              ))}
            </select>
            {templatesLoading && <p className="text-[10px] text-muted-foreground">Loading templates…</p>}
            {isUsingTemplate && (
              <p className="text-[10px] text-muted-foreground">
                Subject and body are previewed from the template. Select “Manual message” to edit.
              </p>
            )}
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label className="text-xs">Delay (hours after previous step)</Label>
              <Input
                type="number"
                min="0"
                value={step.delay_hours}
                onChange={(e) => onUpdate({ ...step, delay_hours: Number(e.target.value) })}
                className="h-9"
              />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">Channel</Label>
              <select
                className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm disabled:opacity-60"
                value={step.channel}
                disabled={isUsingTemplate}
                onChange={(e) => {
                  const channel = e.target.value
                  const next = { ...step, channel }
                  if (selectedTemplate && selectedTemplate.channel !== channel) {
                    next.template_id = null
                    next.subject = ''
                    next.body = ''
                  }
                  onUpdate(next)
                }}
              >
                {CHANNELS.map((c) => <option key={c.value} value={c.value}>{c.label}</option>)}
              </select>
            </div>
          </div>
          {step.channel === 'email' && (
            <div className="space-y-1.5">
              <Label className="text-xs">Subject line</Label>
              <Input
                value={step.subject}
                placeholder="e.g. We received your inquiry"
                disabled={isUsingTemplate}
                onChange={(e) => onUpdate({ ...step, subject: e.target.value })}
                className="h-9 disabled:opacity-60"
              />
            </div>
          )}
          <div className="space-y-1.5">
            <Label className="text-xs">
              Message body
              <span className="ml-2 text-muted-foreground">
                {'  '}Available tokens:{' '}
                {['{{client_name}}', '{{property_title}}', '{{agent_name}}', '{{viewing_date}}'].map((t) => (
                  <code key={t} className="ml-1 rounded bg-muted px-1 text-[10px]">{t}</code>
                ))}
              </span>
            </Label>
            <textarea
              rows={4}
              value={step.body}
              placeholder="Write your message…"
              disabled={isUsingTemplate}
              onChange={(e) => onUpdate({ ...step, body: e.target.value })}
              className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-60"
            />
          </div>
        </div>
      )}
    </div>
  )
}

// ─── main component ────────────────────────────────────────────────────────────

export function CampaignBuilderPage() {
  const navigate = useNavigate()
  const { agent } = useAuth()
  const { addToast } = useToast()
  usePageTitle('New Campaign')

  const [wizardStep, setWizardStep] = useState(0)
  const [saving, setSaving] = useState(false)
  const [tagInput, setTagInput] = useState('')

  const [form, setForm] = useState<FormState>({
    name: '',
    description: '',
    trigger: 'manual',
    target_channel: 'email',
    tags_filter: [],
    audience_rules: [],
    steps: [{ ...EMPTY_STEP }],
  })

  const [templates, setTemplates] = useState<Template[]>([])
  const [templatesLoading, setTemplatesLoading] = useState(false)

  useEffect(() => {
    let cancelled = false
    setTemplatesLoading(true)
    api
      .getMessageTemplates()
      .then((rows) => {
        if (!cancelled) setTemplates(Array.isArray(rows) ? rows : [])
      })
      .catch(() => {
        if (!cancelled) setTemplates([])
      })
      .finally(() => {
        if (!cancelled) setTemplatesLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [])

  // ─ helpers ─
  const setField = <K extends keyof FormState>(k: K, v: FormState[K]) =>
    setForm((f) => ({ ...f, [k]: v }))

  const addTag = () => {
    const t = tagInput.trim()
    if (t && !form.tags_filter.includes(t)) setField('tags_filter', [...form.tags_filter, t])
    setTagInput('')
  }

  const removeTag = (t: string) => setField('tags_filter', form.tags_filter.filter((x) => x !== t))

  const addRule = () => setField('audience_rules', [...form.audience_rules, { ...EMPTY_RULE }])

  const updateRule = (i: number, r: AudienceRule) =>
    setField('audience_rules', form.audience_rules.map((x, idx) => (idx === i ? r : x)))

  const removeRule = (i: number) =>
    setField('audience_rules', form.audience_rules.filter((_, idx) => idx !== i))

  const addStep = () => setField('steps', [...form.steps, { ...EMPTY_STEP }])

  const updateStep = (i: number, s: Step) =>
    setField('steps', form.steps.map((x, idx) => (idx === i ? s : x)))

  const removeStep = (i: number) =>
    setField('steps', form.steps.filter((_, idx) => idx !== i))

  const applyTemplate = (t: typeof PRESET_TEMPLATES[number]) => {
    setField('steps', t.steps)
    setField('target_channel', t.steps[0]?.channel || 'email')
  }

  // ─ validation ─
  const canAdvance = (): boolean => {
    if (wizardStep === 0) return form.name.trim().length >= 2
    if (wizardStep === 2) return form.steps.every((s) => Boolean(s.template_id) || s.body.trim().length > 0)
    return true
  }

  // ─ submit ─
  const handleSave = async (status: 'draft' | 'active') => {
    setSaving(true)
    try {
      await api.createCampaign({
        name: form.name.trim(),
        description: form.description.trim(),
        status,
        trigger: form.trigger,
        target_channel: form.target_channel,
        tags_filter: form.tags_filter,
        steps: form.steps,
      })
      addToast({ title: `Campaign ${status === 'active' ? 'launched' : 'saved as draft'}`, variant: 'success' })
      navigate('/campaigns')
    } catch (e: any) {
      addToast({ title: 'Could not save campaign', description: e.message, variant: 'error' })
    } finally {
      setSaving(false)
    }
  }

  // ─ render ─
  return (
    <CrmShell>
      <CmdPageHeader
        title="New campaign"
        actions={
          <Button variant="ghost" size="sm" onClick={() => navigate('/campaigns')}>
            <ArrowLeft className="mr-1.5 h-4 w-4" /> Back
          </Button>
        }
      />
      <WizardProgressBar current={wizardStep} />

      <div className="flex-1 overflow-y-auto">
        <div className="mx-auto max-w-2xl px-4 py-8">

          {/* ── Step 0: Basics ── */}
          {wizardStep === 0 && (
            <div className="space-y-6">
              <div>
                <h2 className="text-lg font-semibold">Campaign basics</h2>
                <p className="text-sm text-muted-foreground">Give your campaign a name and choose how it gets triggered.</p>
              </div>

              <div className="space-y-4">
                <div className="space-y-1.5">
                  <Label>Campaign name <span className="text-red-500">*</span></Label>
                  <Input
                    autoFocus
                    placeholder="e.g. New lead nurture — Beirut buyers"
                    value={form.name}
                    onChange={(e) => setField('name', e.target.value)}
                    className="h-10"
                  />
                </div>

                <div className="space-y-1.5">
                  <Label>Description <span className="text-muted-foreground text-xs">(optional)</span></Label>
                  <textarea
                    rows={2}
                    placeholder="What is this campaign for?"
                    value={form.description}
                    onChange={(e) => setField('description', e.target.value)}
                    className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  />
                </div>

                <div className="space-y-2">
                  <Label>Trigger</Label>
                  <div className="grid gap-2 sm:grid-cols-2">
                    {TRIGGERS.map((t) => (
                      <button
                        key={t.value}
                        type="button"
                        onClick={() => setField('trigger', t.value)}
                        className={cn(
                          'flex items-start gap-3 rounded-lg border p-3 text-left transition-colors',
                          form.trigger === t.value
                            ? 'border-[#0F0F0F] bg-[#0F0F0F] text-white'
                            : 'border-[#E4E3E0] bg-white hover:border-foreground',
                        )}
                      >
                        <Zap className="mt-0.5 h-4 w-4 shrink-0" />
                        <div>
                          <p className="text-sm font-medium">{t.label}</p>
                          <p className={cn('text-xs', form.trigger === t.value ? 'text-white/70' : 'text-muted-foreground')}>
                            {t.description}
                          </p>
                        </div>
                      </button>
                    ))}
                  </div>
                </div>

                <div className="space-y-2">
                  <Label>Default send channel</Label>
                  <div className="flex gap-2">
                    {CHANNELS.map(({ value, label, icon: Icon }) => (
                      <button
                        key={value}
                        type="button"
                        onClick={() => setField('target_channel', value)}
                        className={cn(
                          'flex flex-1 items-center justify-center gap-2 rounded-lg border py-2.5 text-sm font-medium transition-colors',
                          form.target_channel === value
                            ? 'border-[#0F0F0F] bg-[#0F0F0F] text-white'
                            : 'border-[#E4E3E0] bg-white hover:border-foreground',
                        )}
                      >
                        <Icon className="h-4 w-4" />
                        {label}
                      </button>
                    ))}
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* ── Step 1: Audience ── */}
          {wizardStep === 1 && (
            <div className="space-y-6">
              <div>
                <h2 className="text-lg font-semibold">Audience targeting</h2>
                <p className="text-sm text-muted-foreground">Define who gets enrolled. Leave empty to enroll manually.</p>
              </div>

              {/* Tag filters */}
              <div className="space-y-3">
                <Label>Contact tags</Label>
                <p className="text-xs text-muted-foreground">Contacts must have ALL of the specified tags to be auto-enrolled.</p>
                <div className="flex gap-2">
                  <Input
                    placeholder="Add a tag…"
                    value={tagInput}
                    onChange={(e) => setTagInput(e.target.value)}
                    onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); addTag() } }}
                    className="h-9"
                  />
                  <Button type="button" variant="outline" size="sm" onClick={addTag}>Add</Button>
                </div>
                {form.tags_filter.length > 0 && (
                  <div className="flex flex-wrap gap-1.5">
                    {form.tags_filter.map((t) => (
                      <Badge key={t} variant="secondary" className="gap-1.5">
                        {t}
                        <button type="button" onClick={() => removeTag(t)} className="text-muted-foreground hover:text-foreground">×</button>
                      </Badge>
                    ))}
                  </div>
                )}
              </div>

              {/* Audience rules */}
              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <div>
                    <Label>Targeting rules</Label>
                    <p className="text-xs text-muted-foreground">All rules must match (AND logic).</p>
                  </div>
                  <Button type="button" variant="outline" size="sm" onClick={addRule} className="gap-1.5">
                    <Plus className="h-3.5 w-3.5" /> Add rule
                  </Button>
                </div>

                {form.audience_rules.length === 0 ? (
                  <div className="rounded-lg border border-dashed border-[#D0CFCD] py-8 text-center text-sm text-muted-foreground">
                    No rules yet — campaign will run on manual enrollment
                  </div>
                ) : (
                  <div className="space-y-2">
                    {form.audience_rules.map((rule, i) => (
                      <div key={i} className="flex items-center gap-2 rounded-lg border border-[#E4E3E0] bg-white p-3">
                        <select
                          className="h-8 rounded-md border border-input bg-background px-2 text-sm"
                          value={rule.field}
                          onChange={(e) => updateRule(i, { ...rule, field: e.target.value as AudienceRule['field'] })}
                        >
                          {AUDIENCE_FIELDS.map((f) => <option key={f.value} value={f.value}>{f.label}</option>)}
                        </select>
                        <select
                          className="h-8 rounded-md border border-input bg-background px-2 text-sm"
                          value={rule.operator}
                          onChange={(e) => updateRule(i, { ...rule, operator: e.target.value as AudienceRule['operator'] })}
                        >
                          {AUDIENCE_OPERATORS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                        </select>
                        <Input
                          className="h-8 flex-1"
                          placeholder="value…"
                          value={rule.value}
                          onChange={(e) => updateRule(i, { ...rule, value: e.target.value })}
                        />
                        <button type="button" onClick={() => removeRule(i)} className="text-muted-foreground hover:text-red-500">
                          <Trash2 className="h-3.5 w-3.5" />
                        </button>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          )}

          {/* ── Step 2: Steps ── */}
          {wizardStep === 2 && (
            <div className="space-y-6">
              <div className="flex items-start justify-between">
                <div>
                  <h2 className="text-lg font-semibold">Message steps</h2>
                  <p className="text-sm text-muted-foreground">Define the sequence. Each step fires after the previous one's delay.</p>
                </div>
              </div>

              {/* Preset templates */}
              <div className="rounded-lg border border-[#E4E3E0] bg-[#FAFAF9] p-4">
                <p className="mb-3 text-xs font-semibold uppercase tracking-wider text-muted-foreground">Start from a template</p>
                <div className="flex flex-wrap gap-2">
                  {PRESET_TEMPLATES.map((t) => (
                    <button
                      key={t.label}
                      type="button"
                      onClick={() => applyTemplate(t)}
                      className="rounded-full border border-[#E4E3E0] bg-white px-3 py-1 text-xs font-medium hover:border-[#0F0F0F] hover:bg-[#0F0F0F] hover:text-white transition-colors"
                    >
                      {t.label}
                    </button>
                  ))}
                </div>
              </div>

              {/* Step list */}
              <div className="space-y-3">
                {form.steps.map((step, i) => (
                  <StepEditor
                    key={i}
                    step={step}
                    index={i}
                    onUpdate={(s) => updateStep(i, s)}
                    onRemove={() => removeStep(i)}
                    canRemove={form.steps.length > 1}
                    templates={templates}
                    templatesLoading={templatesLoading}
                  />
                ))}

                <Button type="button" variant="outline" className="w-full gap-2" onClick={addStep}>
                  <Plus className="h-4 w-4" /> Add step
                </Button>
              </div>
            </div>
          )}

          {/* ── Step 3: Review ── */}
          {wizardStep === 3 && (
            <div className="space-y-6">
              <div>
                <h2 className="text-lg font-semibold">Review and launch</h2>
                <p className="text-sm text-muted-foreground">Check your campaign settings before publishing.</p>
              </div>

              <div className="divide-y divide-[#E4E3E0] rounded-xl border border-[#E4E3E0] bg-white">
                <div className="px-5 py-4">
                  <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Campaign</p>
                  <p className="mt-1 font-semibold">{form.name}</p>
                  {form.description && <p className="text-sm text-muted-foreground">{form.description}</p>}
                </div>
                <div className="grid grid-cols-3 divide-x divide-[#E4E3E0] px-0">
                  {[
                    { label: 'Trigger', value: TRIGGERS.find((t) => t.value === form.trigger)?.label },
                    { label: 'Channel', value: CHANNELS.find((c) => c.value === form.target_channel)?.label },
                    { label: 'Steps', value: form.steps.length },
                  ].map((item) => (
                    <div key={item.label} className="px-5 py-4">
                      <p className="text-xs text-muted-foreground">{item.label}</p>
                      <p className="font-semibold">{item.value}</p>
                    </div>
                  ))}
                </div>
                {(form.tags_filter.length > 0 || form.audience_rules.length > 0) && (
                  <div className="px-5 py-4">
                    <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Audience</p>
                    {form.tags_filter.length > 0 && (
                      <div className="mt-2 flex flex-wrap gap-1.5">
                        {form.tags_filter.map((t) => (
                          <Badge key={t} variant="secondary">{t}</Badge>
                        ))}
                      </div>
                    )}
                    {form.audience_rules.length > 0 && (
                      <div className="mt-2 space-y-1">
                        {form.audience_rules.map((r, i) => (
                          <p key={i} className="text-sm text-muted-foreground">
                            {AUDIENCE_FIELDS.find((f) => f.value === r.field)?.label}{' '}
                            {r.operator} <strong>{r.value}</strong>
                          </p>
                        ))}
                      </div>
                    )}
                  </div>
                )}
                <div className="px-5 py-4">
                  <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-3">Steps</p>
                  <div className="space-y-2">
                    {form.steps.map((s, i) => {
                      const template = templates.find((t) => t.id === s.template_id)
                      return (
                        <div key={i} className="flex items-start gap-3 text-sm">
                          <div className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-[#F0EFED] text-[10px] font-bold">
                            {i + 1}
                          </div>
                          <div className="min-w-0">
                            <p className="font-medium truncate">
                              {template ? template.name : (s.subject || s.body.slice(0, 60))}
                            </p>
                            <p className="text-xs text-muted-foreground capitalize">
                              {s.channel}{s.delay_hours > 0 ? ` · +${s.delay_hours}h` : ' · immediately'}
                              {template && ' · uses template'}
                            </p>
                          </div>
                        </div>
                      )
                    })}
                  </div>
                </div>
              </div>

              {/* Save actions */}
              <div className="flex gap-3">
                <Button
                  variant="outline"
                  className="flex-1"
                  disabled={saving}
                  onClick={() => handleSave('draft')}
                >
                  {saving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
                  Save as draft
                </Button>
                <Button
                  className="flex-1 bg-[#0F0F0F] text-white hover:bg-[#2F2F2F]"
                  disabled={saving}
                  onClick={() => handleSave('active')}
                >
                  {saving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Megaphone className="mr-2 h-4 w-4" />}
                  Launch campaign
                </Button>
              </div>
            </div>
          )}

          {/* ── Wizard nav ── */}
          {wizardStep < 3 && (
            <div className="mt-8 flex items-center justify-between">
              <Button
                variant="ghost"
                size="sm"
                disabled={wizardStep === 0}
                onClick={() => setWizardStep((s) => s - 1)}
              >
                <ArrowLeft className="mr-1.5 h-4 w-4" /> Back
              </Button>
              <Button
                size="sm"
                disabled={!canAdvance()}
                onClick={() => setWizardStep((s) => s + 1)}
                className="bg-[#0F0F0F] text-white hover:bg-[#2F2F2F]"
              >
                Continue <ArrowRight className="ml-1.5 h-4 w-4" />
              </Button>
            </div>
          )}
        </div>
      </div>
    </CrmShell>
  )
}
