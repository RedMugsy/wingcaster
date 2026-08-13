import { useCallback, useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { ArrowLeft, Loader2, Save, Sparkles, RotateCcw } from 'lucide-react'
import { api } from '@/api/client'
import { useAuth } from '@/context/AuthContext'
import { useToast } from '@/components/ui/toast'
import { usePageTitle } from '@/lib/usePageTitle'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'

const CATEGORY_META: Record<string, { label: string; emoji: string; description: string }> = {
  hot_lead:    { label: 'Hot lead',    emoji: '🔥', description: 'Explicit buy or rent intent.' },
  interest:    { label: 'Interest',    emoji: '💬', description: 'Asks about price, availability, or viewing.' },
  investor:    { label: 'Investor',    emoji: '📈', description: 'Investment-focused: yield, ROI, rental income, cap rate.' },
  question:    { label: 'Question',    emoji: '❓', description: 'Neutral question, not obviously commercial.' },
  objection:   { label: 'Objection',   emoji: '⚠️', description: 'Property-specific negative — recoverable with agent handling.' },
  complaint:   { label: 'Complaint',   emoji: '🚨', description: 'Negative about service or seller. Priority escalation.' },
  testimonial: { label: 'Testimonial', emoji: '🏆', description: 'Past client positive feedback.' },
  reaction:    { label: 'Reaction',    emoji: '👍', description: 'Emoji-only or brief positive reaction.' },
  referral:    { label: 'Referral',    emoji: '🔗', description: 'Tags or mentions another person.' },
  spam:        { label: 'Spam',        emoji: '🚫', description: 'Promotional junk or bot. Filtered from all views.' },
  general:     { label: 'General',     emoji: '💭', description: 'Small talk or unclear intent. AI watches the thread.' },
}

const CATEGORY_ORDER = ['hot_lead', 'interest', 'investor', 'question', 'objection', 'complaint', 'testimonial', 'reaction', 'referral', 'general', 'spam']

const TEMPLATE_HELP = 'Placeholders: {contact_name} {listing_title} {listing_price} {listing_url} {agent_name} {response_time} {price_justification}'

export function RoutingSettingsPage() {
  const { agent, loading: authLoading } = useAuth()
  const { addToast } = useToast()
  usePageTitle('Routing Rules')

  const [config, setConfig] = useState<Record<string, Record<string, unknown>>>({})
  const [defaults, setDefaults] = useState<Record<string, Record<string, unknown>>>({})
  const [scope, setScope] = useState<'agent' | 'agency'>('agent')
  const [agencyId, setAgencyId] = useState<string | null>(null)
  const [dirty, setDirty] = useState(false)
  const [saving, setSaving] = useState(false)
  const [loading, setLoading] = useState(true)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const [effective, def] = await Promise.all([
        api.getRoutingConfig(),
        api.getRoutingConfigDefaults(),
      ])
      setConfig(effective.config)
      setDefaults(def.defaults)
      setAgencyId(effective.agency_id)
      setDirty(false)
    } catch (err: any) {
      addToast({ title: 'Could not load routing rules', description: err?.message, variant: 'error' })
    } finally {
      setLoading(false)
    }
  }, [addToast])

  useEffect(() => { if (agent) load() }, [agent, load])

  function updateField(category: string, key: string, value: unknown) {
    setConfig((prev) => ({
      ...prev,
      [category]: { ...(prev[category] || {}), [key]: value },
    }))
    setDirty(true)
  }

  function resetCategory(category: string) {
    setConfig((prev) => ({ ...prev, [category]: { ...(defaults[category] || {}) } }))
    setDirty(true)
  }

  async function save() {
    if (saving) return
    setSaving(true)
    try {
      // Send the whole config for the chosen scope. Backend stores partial
      // overrides — server-side upsertRoutingConfig only persists the fields
      // that differ from parent scope.
      await api.updateRoutingConfig({ owner_type: scope, routes: config })
      addToast({ title: 'Routing rules saved', variant: 'success' })
      setDirty(false)
      load()
    } catch (err: any) {
      addToast({ title: 'Save failed', description: err?.message, variant: 'error' })
    } finally {
      setSaving(false)
    }
  }

  if (authLoading || (loading && !Object.keys(config).length)) {
    return (
      <div className="flex min-h-[60vh] items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    )
  }
  if (!agent) {
    return (
      <div className="mx-auto max-w-lg py-16 text-center">
        <h1 className="text-2xl font-semibold">Sign in</h1>
        <Link to="/login" className="mt-3 inline-block"><Button>Sign in</Button></Link>
      </div>
    )
  }

  return (
    <div className="mx-auto max-w-4xl px-4 py-6 sm:px-6 lg:px-8">
      <div className="mb-4 flex items-center gap-2 text-sm text-muted-foreground">
        <Link to="/command-center" className="inline-flex items-center gap-1 hover:text-foreground">
          <ArrowLeft className="h-4 w-4" /> Command Center
        </Link>
        <span>·</span>
        <span>Settings</span>
      </div>

      <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Routing rules</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Configure how each comment category is handled downstream. Agent overrides take precedence
            over agency defaults; anything you leave unset falls back to the shipped defaults.
          </p>
        </div>
        <div className="flex gap-2">
          {agencyId && (
            <div className="flex items-center gap-1 rounded-md border p-0.5">
              {(['agent', 'agency'] as const).map((s) => (
                <button
                  key={s}
                  type="button"
                  onClick={() => setScope(s)}
                  className={`rounded px-2.5 py-1 text-xs font-medium capitalize transition-colors ${
                    scope === s ? 'bg-slate-900 text-white' : 'text-muted-foreground hover:bg-muted'
                  }`}
                >
                  {s === 'agent' ? 'My overrides' : 'Agency defaults'}
                </button>
              ))}
            </div>
          )}
          <Button onClick={save} disabled={!dirty || saving} className="gap-1.5">
            {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
            Save
          </Button>
        </div>
      </div>

      <div className="space-y-3">
        {CATEGORY_ORDER.map((cat) => {
          const meta = CATEGORY_META[cat]
          const values = config[cat] || {}
          const catDefaults = defaults[cat] || {}
          if (!meta) return null
          return (
            <Card key={cat}>
              <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-3">
                <div>
                  <div className="flex items-center gap-2">
                    <CardTitle className="text-base">{meta.emoji} {meta.label}</CardTitle>
                    {values.enabled === false && <Badge variant="outline">Disabled</Badge>}
                    {values.auto_reply === true && <Badge className="border-emerald-200 bg-emerald-50 text-emerald-800" variant="outline">Auto-reply on</Badge>}
                  </div>
                  <p className="mt-1 text-xs text-muted-foreground">{meta.description}</p>
                </div>
                <Button variant="ghost" size="sm" onClick={() => resetCategory(cat)} className="gap-1.5 text-xs">
                  <RotateCcw className="h-3.5 w-3.5" />
                  Reset
                </Button>
              </CardHeader>
              <CardContent className="grid grid-cols-1 gap-3 md:grid-cols-2">
                <ToggleField
                  label="Route enabled"
                  value={values.enabled !== false}
                  onChange={(v) => updateField(cat, 'enabled', v)}
                  hint="Turn off to skip the router entirely for this category."
                />
                {'auto_reply' in catDefaults && (
                  <ToggleField
                    label="Auto-send reply"
                    value={values.auto_reply === true}
                    onChange={(v) => updateField(cat, 'auto_reply', v)}
                    hint={cat === 'complaint' || cat === 'objection'
                      ? 'DEFAULT OFF. Auto-replying to complaints or objections usually makes things worse.'
                      : 'When ON the router sends the composed reply immediately. When OFF the reply is drafted for agent review.'}
                    warn={cat === 'complaint' || cat === 'objection'}
                  />
                )}
                {'auto_reply_template' in catDefaults && (
                  <div className="md:col-span-2">
                    <Label className="text-xs">Auto-reply template</Label>
                    <textarea
                      rows={3}
                      value={String(values.auto_reply_template || '')}
                      onChange={(e) => updateField(cat, 'auto_reply_template', e.target.value)}
                      className="mt-1 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                    />
                    <p className="mt-1 text-[10px] text-muted-foreground">
                      <Sparkles className="mr-1 inline h-3 w-3" />
                      {TEMPLATE_HELP}
                    </p>
                  </div>
                )}
                {'notify_agent' in catDefaults && (
                  <ToggleField
                    label="Notify assigned agent"
                    value={values.notify_agent === true}
                    onChange={(v) => updateField(cat, 'notify_agent', v)}
                  />
                )}
                {'notify_agency_owner' in catDefaults && (
                  <ToggleField
                    label="Notify agency owner"
                    value={values.notify_agency_owner === true}
                    onChange={(v) => updateField(cat, 'notify_agency_owner', v)}
                  />
                )}
                {'open_opportunity' in catDefaults && (
                  <ToggleField
                    label="Open CRM opportunity"
                    value={values.open_opportunity === true}
                    onChange={(v) => updateField(cat, 'open_opportunity', v)}
                  />
                )}
                {'opportunity_stage' in catDefaults && (
                  <SelectField
                    label="Opportunity opening stage"
                    value={String(values.opportunity_stage || '')}
                    options={['new', 'qualification', 'viewing', 'offer', 'negotiation']}
                    onChange={(v) => updateField(cat, 'opportunity_stage', v)}
                  />
                )}
                {'sub_pipeline' in catDefaults && (
                  <SelectField
                    label="Sub-pipeline"
                    value={String(values.sub_pipeline || '')}
                    options={['standard', 'investor', 'rental']}
                    onChange={(v) => updateField(cat, 'sub_pipeline', v)}
                  />
                )}
                {'create_inquiry' in catDefaults && (
                  <ToggleField
                    label="Create inquiry"
                    value={values.create_inquiry === true}
                    onChange={(v) => updateField(cat, 'create_inquiry', v)}
                  />
                )}
                {'add_to_marketing_queue' in catDefaults && (
                  <ToggleField
                    label="Add to marketing queue"
                    value={values.add_to_marketing_queue === true}
                    onChange={(v) => updateField(cat, 'add_to_marketing_queue', v)}
                  />
                )}
                {'consent_required' in catDefaults && (
                  <ToggleField
                    label="Require consent before reuse"
                    value={values.consent_required === true}
                    onChange={(v) => updateField(cat, 'consent_required', v)}
                  />
                )}
                {'increment_engagement' in catDefaults && (
                  <ToggleField
                    label="Count towards engagement metrics"
                    value={values.increment_engagement === true}
                    onChange={(v) => updateField(cat, 'increment_engagement', v)}
                  />
                )}
                {'ai_watch_thread' in catDefaults && (
                  <ToggleField
                    label="AI thread watcher"
                    value={values.ai_watch_thread === true}
                    onChange={(v) => updateField(cat, 'ai_watch_thread', v)}
                    hint="Subscribes an AI watcher that re-routes if intent surfaces in later messages."
                  />
                )}
                {'hide_from_views' in catDefaults && (
                  <ToggleField
                    label="Hide from all views"
                    value={values.hide_from_views === true}
                    onChange={(v) => updateField(cat, 'hide_from_views', v)}
                  />
                )}
                {'flag_needs_attention' in catDefaults && (
                  <ToggleField
                    label="Flag as needs agent attention"
                    value={values.flag_needs_attention === true}
                    onChange={(v) => updateField(cat, 'flag_needs_attention', v)}
                  />
                )}
                {'prompt_agent_dm' in catDefaults && (
                  <ToggleField
                    label="Prompt agent to DM tagged handles"
                    value={values.prompt_agent_dm === true}
                    onChange={(v) => updateField(cat, 'prompt_agent_dm', v)}
                  />
                )}
                {'priority' in catDefaults && (
                  <SelectField
                    label="Priority"
                    value={String(values.priority || '')}
                    options={['low', 'normal', 'high', 'urgent']}
                    onChange={(v) => updateField(cat, 'priority', v)}
                  />
                )}
                {'min_confidence' in catDefaults && (
                  <NumberField
                    label="Min classifier confidence"
                    value={Number(values.min_confidence ?? 0)}
                    onChange={(v) => updateField(cat, 'min_confidence', v)}
                    min={0} max={1} step={0.05}
                    hint="Rows below this confidence are skipped for routing (the classifier still stores them)."
                  />
                )}
                {'escalation_timeout_minutes' in catDefaults && (
                  <NumberField
                    label="Escalation timeout (minutes)"
                    value={Number(values.escalation_timeout_minutes ?? 60)}
                    onChange={(v) => updateField(cat, 'escalation_timeout_minutes', v)}
                    min={5} max={10080} step={5}
                    hint="After this many minutes with no agent response, an escalation notification fires."
                  />
                )}
                {'response_time_minutes' in catDefaults && (
                  <NumberField
                    label="Promised response time (minutes)"
                    value={Number(values.response_time_minutes ?? 15)}
                    onChange={(v) => updateField(cat, 'response_time_minutes', v)}
                    min={1} max={1440} step={1}
                    hint="Filled into the {response_time} template placeholder."
                  />
                )}
              </CardContent>
            </Card>
          )
        })}
      </div>
    </div>
  )
}

function ToggleField({
  label, value, onChange, hint, warn,
}: { label: string; value: boolean; onChange: (v: boolean) => void; hint?: string; warn?: boolean }) {
  return (
    <div>
      <label className="flex items-start gap-2 text-sm">
        <input
          type="checkbox"
          checked={value}
          onChange={(e) => onChange(e.target.checked)}
          className="mt-0.5 h-4 w-4"
        />
        <span>
          <span className="font-medium">{label}</span>
          {hint && (
            <span className={`mt-0.5 block text-[11px] ${warn ? 'text-rose-700' : 'text-muted-foreground'}`}>
              {hint}
            </span>
          )}
        </span>
      </label>
    </div>
  )
}

function SelectField({
  label, value, options, onChange,
}: { label: string; value: string; options: string[]; onChange: (v: string) => void }) {
  return (
    <div>
      <Label className="text-xs">{label}</Label>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="mt-1 block w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
      >
        {options.map((o) => (
          <option key={o} value={o}>{o}</option>
        ))}
      </select>
    </div>
  )
}

function NumberField({
  label, value, onChange, min, max, step, hint,
}: { label: string; value: number; onChange: (v: number) => void; min?: number; max?: number; step?: number; hint?: string }) {
  return (
    <div>
      <Label className="text-xs">{label}</Label>
      <Input
        type="number"
        value={value}
        min={min}
        max={max}
        step={step}
        onChange={(e) => onChange(Number(e.target.value))}
        className="mt-1"
      />
      {hint && <p className="mt-0.5 text-[10px] text-muted-foreground">{hint}</p>}
    </div>
  )
}
