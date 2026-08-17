import { useState } from 'react'
import { AlertTriangle, Info, Plus, X } from 'lucide-react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { channelLabel, categoryLabel } from './helpers'
import type {
  PlatformMessageTemplate,
  PlatformTemplateCategory,
  PlatformTemplateChannel,
} from '@/types/platformTemplates'
import type { Territory } from '@/types/commercialPricing'

const CHANNELS: PlatformTemplateChannel[] = ['email', 'whatsapp', 'sms']
const CATEGORIES: PlatformTemplateCategory[] = ['auth', 'onboarding', 'billing', 'notification', 'marketing']

/**
 * Common ISO 639-1 primary tags. `<Other>` unlocks a free-text input for
 * anything else — the backend accepts any string; the picker just biases
 * toward what most tenants will need.
 */
const LANGUAGES: Array<{ value: string; label: string }> = [
  { value: 'en', label: 'English' },
  { value: 'ar', label: 'Arabic' },
  { value: 'fr', label: 'French' },
  { value: 'es', label: 'Spanish' },
  { value: 'de', label: 'German' },
  { value: 'pt', label: 'Portuguese' },
  { value: 'ru', label: 'Russian' },
  { value: 'zh', label: 'Chinese' },
]

const CODE_RE = /^[a-z][a-z0-9_]*$/

/**
 * Draft shape the form emits. Distinct from CreatePlatformTemplateInput /
 * UpdatePlatformTemplateInput because those API shapes vary by mode and
 * the parent (TemplateEditPage) is responsible for mapping the draft to
 * whichever call.
 */
export interface TemplateSettingsDraft {
  /** Only meaningful in create mode; ignored on update by the backend. */
  code: string
  display_name: string
  description: string
  channel: PlatformTemplateChannel
  category: PlatformTemplateCategory
  language: string
  territory_id: string | null
  required_variables: string[]
  optional_variables: string[]
  is_active: boolean
}

/** Build a fresh draft, either empty or seeded from an existing template. */
export function draftFromTemplate(t: PlatformMessageTemplate | null): TemplateSettingsDraft {
  return {
    code: t?.code ?? '',
    display_name: t?.display_name ?? '',
    description: t?.description ?? '',
    channel: t?.channel ?? 'email',
    category: t?.category ?? 'notification',
    language: t?.language ?? 'en',
    territory_id: t?.territory_id ?? null,
    required_variables: [...(t?.required_variables ?? [])],
    optional_variables: [...(t?.optional_variables ?? [])],
    is_active: t?.is_active ?? true,
  }
}

/**
 * Field-level validation. Returns undefined for a healthy field, or an
 * error string. Used inline for aria-invalid + hint text, and by the
 * parent's save gate.
 */
export function validateSettings(draft: TemplateSettingsDraft, mode: 'create' | 'edit'): Record<string, string> {
  const errors: Record<string, string> = {}
  if (mode === 'create') {
    if (!draft.code.trim()) errors.code = 'Code is required'
    else if (!CODE_RE.test(draft.code)) errors.code = 'Lowercase letters, digits, and underscores only; must start with a letter'
    else if (draft.code.length > 80) errors.code = 'Code must be 80 characters or fewer'
  }
  if (!draft.display_name.trim()) errors.display_name = 'Display name is required'
  else if (draft.display_name.length > 200) errors.display_name = 'Display name must be 200 characters or fewer'
  if (draft.description.length > 1000) errors.description = 'Description must be 1000 characters or fewer'
  if (!draft.language.trim()) errors.language = 'Language is required'
  const varDupes = [...findDuplicates(draft.required_variables), ...findDuplicates(draft.optional_variables)]
  if (varDupes.length) errors.variables = `Duplicate variable(s): ${varDupes.join(', ')}`
  const overlap = draft.required_variables.filter((v) => draft.optional_variables.includes(v))
  if (overlap.length) errors.variables = `Variable(s) cannot be both required and optional: ${overlap.join(', ')}`
  return errors
}

function findDuplicates(list: string[]): string[] {
  const seen = new Set<string>()
  const dupes = new Set<string>()
  for (const v of list) {
    if (seen.has(v)) dupes.add(v)
    seen.add(v)
  }
  return [...dupes]
}

interface Props {
  mode: 'create' | 'edit'
  value: TemplateSettingsDraft
  onChange: (patch: Partial<TemplateSettingsDraft>) => void
  /** Available territory options for the scoping dropdown. */
  territories: Territory[]
  /**
   * True when the underlying template is a seed. Locks fields the admin
   * shouldn't be able to change (code, channel, category, language,
   * territory) — the resolver's fallback contract depends on them.
   */
  isSeed?: boolean
  /**
   * Loading state for the territory list. When true, the territory
   * dropdown shows a placeholder instead of an empty list — the admin
   * shouldn't be misled into thinking there are no territories.
   */
  territoriesLoading?: boolean
}

/**
 * Controlled settings form for a platform message template.
 *
 * The parent (TemplateEditPage in 5b/6) owns:
 *   * Save / dirty tracking
 *   * Mode routing (create vs edit vs revert)
 *   * Elevation-aware submit (StepUpContext.runElevated)
 *
 * This form does exactly one job: gather the classification + variable
 * declarations for the template and emit changes. All fields are
 * controlled so the parent's dirty check is trivially `deepEqual(value,
 * savedDraft)`.
 *
 * Seed guard: when isSeed is true, the fields that participate in the
 * resolver's (code, language, territory) fallback are locked. The
 * backend would reject changes to code anyway (see service.js — code is
 * documented as immutable); locking them here surfaces the constraint
 * up-front so an admin doesn't type into a field that will silently be
 * ignored on save.
 */
export function TemplateSettingsForm({
  mode,
  value,
  onChange,
  territories,
  isSeed = false,
  territoriesLoading = false,
}: Props) {
  const allErrors = validateSettings(value, mode)
  /**
   * A field's error only surfaces AFTER the admin has interacted with
   * it. Yelling on first paint (empty draft → "Code is required") is
   * bad UX; the parent's save gate still uses `validateSettings` in
   * full so nothing bad gets saved. The `variables` error is a
   * cross-field validation (duplicates / overlap) and always shows
   * once triggered — it can't fire on an untouched form anyway.
   */
  const [touched, setTouched] = useState<Record<string, boolean>>({})
  const touch = (key: string) => setTouched((prev) => (prev[key] ? prev : { ...prev, [key]: true }))
  const errors: Record<string, string> = {}
  for (const [key, msg] of Object.entries(allErrors)) {
    if (key === 'variables' || touched[key]) errors[key] = msg
  }

  const languageSelectValue = LANGUAGES.some((l) => l.value === value.language) ? value.language : '__other__'
  const [customLanguage, setCustomLanguage] = useState(languageSelectValue === '__other__' ? value.language : '')

  const setLanguageFromSelect = (next: string) => {
    if (next === '__other__') {
      onChange({ language: customLanguage || '' })
    } else {
      setCustomLanguage('')
      onChange({ language: next })
    }
  }

  const setCustomLanguageValue = (next: string) => {
    setCustomLanguage(next)
    onChange({ language: next })
  }

  const codeReadOnly = mode === 'edit'
  const classificationLocked = mode === 'edit' && isSeed

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Settings</CardTitle>
      </CardHeader>
      <CardContent className="space-y-6">
        {isSeed && (
          <SeedNotice />
        )}

        {/* Identity */}
        <section aria-labelledby="settings-identity-heading" className="space-y-4">
          <h4 id="settings-identity-heading" className="text-sm font-semibold text-foreground">
            Identity
          </h4>

          <Field
            id="settings-code"
            label="Template code"
            required
            error={errors.code}
            hint={
              codeReadOnly
                ? 'Code is immutable after create — send sites reference it by name.'
                : 'Lowercase snake_case identifier (e.g. signup_otp). Cannot be changed after create.'
            }
          >
            <Input
              id="settings-code"
              value={value.code}
              readOnly={codeReadOnly}
              disabled={codeReadOnly}
              onChange={(e) => { onChange({ code: e.target.value }); touch('code') }}
              onBlur={() => touch('code')}
              autoComplete="off"
              spellCheck={false}
              placeholder="signup_otp"
              aria-invalid={Boolean(errors.code)}
              aria-describedby={errors.code ? 'settings-code-error' : 'settings-code-hint'}
              className={errors.code ? 'border-red-300' : ''}
            />
          </Field>

          <Field
            id="settings-display-name"
            label="Display name"
            required
            error={errors.display_name}
            hint="Human-readable label shown in the admin console."
          >
            <Input
              id="settings-display-name"
              value={value.display_name}
              onChange={(e) => { onChange({ display_name: e.target.value }); touch('display_name') }}
              onBlur={() => touch('display_name')}
              placeholder="Signup verification code"
              maxLength={200}
              aria-invalid={Boolean(errors.display_name)}
              aria-describedby={errors.display_name ? 'settings-display-name-error' : 'settings-display-name-hint'}
              className={errors.display_name ? 'border-red-300' : ''}
            />
          </Field>

          <Field
            id="settings-description"
            label="Description"
            error={errors.description}
            hint="Internal notes about when and why this template is sent."
          >
            <textarea
              id="settings-description"
              value={value.description}
              onChange={(e) => { onChange({ description: e.target.value }); touch('description') }}
              onBlur={() => touch('description')}
              rows={3}
              maxLength={1000}
              placeholder="Sent when a new agent signs up. Contains the 6-digit verification code."
              className={`flex w-full rounded-md border ${errors.description ? 'border-red-300' : 'border-input'} bg-transparent px-3 py-2 text-sm shadow-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring resize-y`}
              aria-invalid={Boolean(errors.description)}
              aria-describedby={errors.description ? 'settings-description-error' : 'settings-description-hint'}
            />
            <p className="mt-1 text-xs text-muted-foreground">
              {value.description.length} / 1000 characters
            </p>
          </Field>
        </section>

        {/* Classification */}
        <section aria-labelledby="settings-classification-heading" className="space-y-4">
          <h4 id="settings-classification-heading" className="text-sm font-semibold text-foreground">
            Classification
          </h4>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <Field
              id="settings-channel"
              label="Channel"
              required
              hint={
                mode === 'edit'
                  ? 'Channel is immutable — different channels have different rendering guarantees.'
                  : undefined
              }
            >
              <select
                id="settings-channel"
                value={value.channel}
                disabled={mode === 'edit'}
                onChange={(e) => onChange({ channel: e.target.value as PlatformTemplateChannel })}
                className="flex h-10 w-full items-center rounded-md border border-input bg-transparent px-3 py-2 text-sm shadow-sm focus:outline-none focus:ring-1 focus:ring-ring disabled:cursor-not-allowed disabled:opacity-50"
              >
                {CHANNELS.map((c) => (
                  <option key={c} value={c}>{channelLabel(c)}</option>
                ))}
              </select>
            </Field>

            <Field id="settings-category" label="Category" required>
              <select
                id="settings-category"
                value={value.category}
                disabled={classificationLocked}
                onChange={(e) => onChange({ category: e.target.value as PlatformTemplateCategory })}
                className="flex h-10 w-full items-center rounded-md border border-input bg-transparent px-3 py-2 text-sm shadow-sm focus:outline-none focus:ring-1 focus:ring-ring disabled:cursor-not-allowed disabled:opacity-50"
              >
                {CATEGORIES.map((c) => (
                  <option key={c} value={c}>{categoryLabel(c)}</option>
                ))}
              </select>
            </Field>
          </div>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <Field
              id="settings-language"
              label="Language"
              required
              error={errors.language}
              hint="Resolver falls back to English (en) when no exact-language match exists."
            >
              <select
                id="settings-language"
                value={languageSelectValue}
                disabled={classificationLocked}
                onChange={(e) => setLanguageFromSelect(e.target.value)}
                className="flex h-10 w-full items-center rounded-md border border-input bg-transparent px-3 py-2 text-sm shadow-sm focus:outline-none focus:ring-1 focus:ring-ring disabled:cursor-not-allowed disabled:opacity-50"
              >
                {LANGUAGES.map((l) => (
                  <option key={l.value} value={l.value}>{l.label} ({l.value})</option>
                ))}
                <option value="__other__">Other (custom code)…</option>
              </select>
              {languageSelectValue === '__other__' && (
                <Input
                  aria-label="Custom language code"
                  className="mt-2"
                  value={customLanguage}
                  disabled={classificationLocked}
                  onChange={(e) => setCustomLanguageValue(e.target.value.toLowerCase().trim())}
                  placeholder="e.g. it, ja, tr"
                />
              )}
            </Field>

            <Field
              id="settings-territory"
              label="Territory"
              hint="Leave blank for the global default. Scoped rows override the global for their territory."
            >
              <select
                id="settings-territory"
                value={value.territory_id ?? ''}
                disabled={classificationLocked || territoriesLoading}
                onChange={(e) => onChange({ territory_id: e.target.value || null })}
                className="flex h-10 w-full items-center rounded-md border border-input bg-transparent px-3 py-2 text-sm shadow-sm focus:outline-none focus:ring-1 focus:ring-ring disabled:cursor-not-allowed disabled:opacity-50"
              >
                <option value="">{territoriesLoading ? 'Loading territories…' : '— Global default —'}</option>
                {territories.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.name || t.code} ({t.code})
                  </option>
                ))}
              </select>
            </Field>
          </div>

          <div className="flex items-start gap-3 rounded-md border border-border bg-muted/30 p-3">
            <input
              id="settings-is-active"
              type="checkbox"
              checked={value.is_active}
              onChange={(e) => onChange({ is_active: e.target.checked })}
              className="mt-0.5 h-4 w-4 rounded border-input"
            />
            <div className="flex-1">
              <Label htmlFor="settings-is-active" className="text-sm font-medium">
                Active
              </Label>
              <p className="text-xs text-muted-foreground">
                Only active templates participate in the resolver. Deactivating a template is the recommended
                alternative to deleting a seed — the resolver treats it as absent and the send site falls back.
              </p>
            </div>
          </div>
        </section>

        {/* Variables */}
        <section aria-labelledby="settings-variables-heading" className="space-y-4">
          <h4 id="settings-variables-heading" className="text-sm font-semibold text-foreground">
            Variables
          </h4>
          <p className="text-xs text-muted-foreground">
            Declare which variables the template body will substitute. <b>Required</b> variables block save
            when the body doesn't reference them — a template that promised {'{{code}}'} but forgot to include
            it would silently break the send. <b>Optional</b> variables are documentation only.
          </p>

          {errors.variables && (
            <div role="alert" className="rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-900">
              <AlertTriangle className="mr-2 inline h-4 w-4" aria-hidden />
              {errors.variables}
            </div>
          )}

          <VariableChipEditor
            label="Required variables"
            hint="Must appear in the subject, HTML body, or text body."
            values={value.required_variables}
            onChange={(next) => onChange({ required_variables: next })}
            testIdPrefix="required"
          />

          <VariableChipEditor
            label="Optional variables"
            hint="Documented for admins editing this template later. No enforcement."
            values={value.optional_variables}
            onChange={(next) => onChange({ optional_variables: next })}
            testIdPrefix="optional"
          />
        </section>
      </CardContent>
    </Card>
  )
}

function SeedNotice() {
  return (
    <div
      role="status"
      className="flex items-start gap-3 rounded-md border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900"
    >
      <Info className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
      <div>
        <p className="font-semibold">This template is a seed.</p>
        <p className="mt-1">
          Copy (subject, body, variables) is editable — versions history tracks every change. But the
          classification fields (channel, category, language, territory) are locked: the send site's fallback
          resolver depends on them. Deactivate rather than reclassify if you need this template to stop sending.
        </p>
      </div>
    </div>
  )
}

function Field({
  id,
  label,
  required,
  error,
  hint,
  children,
}: {
  id: string
  label: string
  required?: boolean
  error?: string
  hint?: string
  children: React.ReactNode
}) {
  return (
    <div className="space-y-1.5">
      <Label htmlFor={id} className="text-sm">
        {label}{required && <span aria-hidden className="ml-1 text-red-600">*</span>}
      </Label>
      {children}
      {error ? (
        <p id={`${id}-error`} role="alert" className="text-xs text-red-600">{error}</p>
      ) : hint ? (
        <p id={`${id}-hint`} className="text-xs text-muted-foreground">{hint}</p>
      ) : null}
    </div>
  )
}

/**
 * Chip-style multi-value editor with add + remove. Each chip is a
 * removable Badge; the input adds on Enter or comma. Names are
 * validated as `[\w.]+` on add (the same regex the backend variable
 * extractor uses) so the admin can't accidentally declare a name the
 * runtime would never match.
 */
function VariableChipEditor({
  label,
  hint,
  values,
  onChange,
  testIdPrefix,
}: {
  label: string
  hint: string
  values: string[]
  onChange: (next: string[]) => void
  testIdPrefix: string
}) {
  const [pending, setPending] = useState('')
  const [inlineError, setInlineError] = useState<string | null>(null)

  const commit = (raw: string) => {
    const cleaned = raw.trim()
    if (!cleaned) return
    if (!/^[\w.]+$/.test(cleaned)) {
      setInlineError(`Invalid variable name: "${cleaned}". Only letters, digits, underscores, and dots are allowed.`)
      return
    }
    if (values.includes(cleaned)) {
      setInlineError(`"${cleaned}" is already in the list.`)
      return
    }
    onChange([...values, cleaned])
    setPending('')
    setInlineError(null)
  }

  const remove = (name: string) => {
    onChange(values.filter((v) => v !== name))
  }

  const inputId = `variable-editor-${testIdPrefix}`

  return (
    <div className="space-y-2" data-testid={`variable-editor-${testIdPrefix}`}>
      <Label htmlFor={inputId} className="text-sm">{label}</Label>
      <p className="text-xs text-muted-foreground">{hint}</p>
      {values.length > 0 && (
        <ul className="flex flex-wrap gap-1.5" aria-label={`${label} — current entries`}>
          {values.map((name) => (
            <li key={name}>
              <Badge variant="outline" className="gap-1 font-mono text-xs">
                {`{{${name}}}`}
                <button
                  type="button"
                  className="-mr-1 rounded p-0.5 hover:bg-muted"
                  onClick={() => remove(name)}
                  aria-label={`Remove ${name}`}
                >
                  <X className="h-3 w-3" aria-hidden />
                </button>
              </Badge>
            </li>
          ))}
        </ul>
      )}
      <div className="flex gap-2">
        <Input
          id={inputId}
          value={pending}
          onChange={(e) => { setPending(e.target.value); setInlineError(null) }}
          onKeyDown={(e) => {
            if (e.key === 'Enter' || e.key === ',') {
              e.preventDefault()
              commit(pending)
            } else if (e.key === 'Backspace' && !pending && values.length > 0) {
              // Empty backspace removes the last chip — same shortcut as
              // GitHub's label editor, Notion's tag input, etc.
              remove(values[values.length - 1])
            }
          }}
          placeholder="Add a variable and press Enter"
          autoComplete="off"
          spellCheck={false}
          aria-invalid={Boolean(inlineError)}
          aria-describedby={inlineError ? `${inputId}-error` : undefined}
        />
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() => commit(pending)}
          disabled={!pending.trim()}
          aria-label={`Add ${label.toLowerCase()}`}
        >
          <Plus className="h-4 w-4" aria-hidden />
        </Button>
      </div>
      {inlineError && (
        <p id={`${inputId}-error`} role="alert" className="text-xs text-red-600">{inlineError}</p>
      )}
    </div>
  )
}
