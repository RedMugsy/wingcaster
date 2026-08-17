import { useCallback, useEffect, useState } from 'react'
import { Link, useBeforeUnload, useNavigate, useParams, useSearchParams } from 'react-router-dom'
import { ArrowLeft, Loader2, Save, Send, Trash2 } from 'lucide-react'
import { Card, CardContent } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { useAuth } from '@/context/AuthContext'
import { useStepUp } from '@/context/StepUpContext'
import { useToast } from '@/components/ui/toast'
import { api } from '@/api/client'
import type {
  PlatformMessageTemplate,
  PlatformTemplateCategory,
  PlatformTemplateChannel,
  PlatformTemplateEditorMode,
} from '@/types/platformTemplates'
import type { Territory } from '@/types/commercialPricing'
import {
  channelLabel,
  categoryLabel,
  isTemplatePublishable,
} from '@/components/platform-templates/helpers'
import {
  TemplateSettingsForm,
  draftFromTemplate,
  validateSettings,
  type TemplateSettingsDraft,
} from '@/components/platform-templates/TemplateSettingsForm'
import { PreviewPane } from '@/components/platform-templates/PreviewPane'
import { VariableDiagnosticsPanel } from '@/components/platform-templates/VariableDiagnosticsPanel'
import { VersionsTab } from '@/components/platform-templates/VersionsTab'
import { UnlayerEditor } from '@/components/platform-templates/UnlayerEditor'
import { DeleteTemplateDialog } from '@/components/platform-templates/DeleteTemplateDialog'
import { SendTestDialog } from '@/components/platform-templates/SendTestDialog'

/**
 * Combined draft used across the editor page. Settings tab writes the
 * TemplateSettingsDraft fields; Design tab writes html/design_json/text;
 * subject is edited in the fixed header bar above the tabs.
 */
interface EditorDraft extends TemplateSettingsDraft {
  subject: string
  html: string
  design_json: unknown | null
  text: string
  editor_mode: PlatformTemplateEditorMode
}

function draftFromTemplateFull(t: PlatformMessageTemplate | null): EditorDraft {
  const settings = draftFromTemplate(t)
  return {
    ...settings,
    subject: t?.subject ?? '',
    html: t?.html_body ?? '',
    design_json: t?.design_json ?? null,
    text: t?.text_body ?? '',
    editor_mode: t?.editor_mode ?? 'unlayer',
  }
}

function arrayEqual(a: string[], b: string[]): boolean {
  if (a.length !== b.length) return false
  for (let i = 0; i < a.length; i += 1) if (a[i] !== b[i]) return false
  return true
}

function draftsEqual(a: EditorDraft, b: EditorDraft): boolean {
  if (a.subject !== b.subject) return false
  if (a.html !== b.html || a.text !== b.text || a.editor_mode !== b.editor_mode) return false
  if (JSON.stringify(a.design_json) !== JSON.stringify(b.design_json)) return false
  if (
    a.code !== b.code ||
    a.display_name !== b.display_name ||
    a.description !== b.description ||
    a.channel !== b.channel ||
    a.category !== b.category ||
    a.language !== b.language ||
    a.territory_id !== b.territory_id ||
    a.is_active !== b.is_active
  ) return false
  return arrayEqual(a.required_variables, b.required_variables)
      && arrayEqual(a.optional_variables, b.optional_variables)
}

type Mode = 'create' | 'edit'

const UNLAYER_PROJECT_ID: number | undefined = (() => {
  const raw = (import.meta as { env?: Record<string, string | undefined> }).env?.VITE_UNLAYER_PROJECT_ID
  if (!raw) return undefined
  const n = Number(raw)
  return Number.isFinite(n) ? n : undefined
})()

/**
 * TemplateEditPage — the central admin surface for editing (or creating)
 * a platform message template. Composes five tabs:
 *
 *   Design     UnlayerEditor + HTML source escape hatch
 *   Preview    PreviewPane with sample variables (edit-mode only)
 *   Variables  VariableDiagnosticsPanel with required/optional/unknown buckets
 *   Versions   VersionsTab with history, diff, revert (edit-mode only)
 *   Settings   TemplateSettingsForm with classification + variables editor
 *
 * Save orchestration:
 *   * Ctrl/Cmd+S saves from any tab.
 *   * Save is disabled when required-variables are missing OR when
 *     there are no unsaved changes.
 *   * Save wraps its API call in runElevated so a 401 step_up_required
 *     surfaces the StepUpModal automatically.
 *   * Dirty state is compared against the last-saved snapshot; switching
 *     tabs does NOT lose in-flight edits.
 *   * Route navigation with a dirty draft is blocked via useBlocker →
 *     UnsavedChangesGuardDialog with Stay / Discard / Save-and-continue.
 *   * Browser tab close with a dirty draft prompts via
 *     useBeforeUnload.
 *
 * Route in App.tsx (5b/8):
 *   /admin/message-templates/new   — create
 *   /admin/message-templates/:id   — edit
 */
export function TemplateEditPage() {
  const { id: routeId } = useParams<{ id: string }>()
  const [searchParams] = useSearchParams()
  const navigate = useNavigate()
  const { agent, isAdmin } = useAuth()
  const { runElevated } = useStepUp()
  const { addToast } = useToast()

  const isCreate = !routeId || routeId === 'new'
  const mode: Mode = isCreate ? 'create' : 'edit'

  const [template, setTemplate] = useState<PlatformMessageTemplate | null>(null)
  const [draft, setDraft] = useState<EditorDraft>(() => draftFromTemplateFull(null))
  const [savedSnapshot, setSavedSnapshot] = useState<EditorDraft>(() => draftFromTemplateFull(null))
  const [territories, setTerritories] = useState<Territory[]>([])
  const [territoriesLoading, setTerritoriesLoading] = useState(true)
  const [loading, setLoading] = useState(!isCreate)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState<string | null>(null)
  const [changeNote, setChangeNote] = useState('')
  const [deleteOpen, setDeleteOpen] = useState(false)
  const [sendTestOpen, setSendTestOpen] = useState(false)
  const [tab, setTab] = useState<string>(searchParams.get('tab') || (isCreate ? 'settings' : 'design'))

  // Prefill create-mode from query params so a "New template" link
  // from the list page can land the admin on the right channel /
  // category filter.
  useEffect(() => {
    if (!isCreate) return
    const seed = draftFromTemplateFull(null)
    const channel = searchParams.get('channel') as PlatformTemplateChannel | null
    const category = searchParams.get('category') as PlatformTemplateCategory | null
    if (channel) seed.channel = channel
    if (category) seed.category = category
    setDraft(seed)
    setSavedSnapshot(seed)
  }, [isCreate, searchParams])

  useEffect(() => {
    if (!isAdmin) return
    setTerritoriesLoading(true)
    api.listAdminTerritories({ include_inactive: false })
      .then((res) => setTerritories(res.territories))
      .catch(() => setTerritories([]))
      .finally(() => setTerritoriesLoading(false))
  }, [isAdmin])

  useEffect(() => {
    if (isCreate) return
    if (!routeId) return
    if (!isAdmin) return  // permission gate renders instead; do not fetch
    let cancelled = false
    setLoading(true)
    setLoadError(null)
    api.getPlatformTemplate(routeId)
      .then((res) => {
        if (cancelled) return
        setTemplate(res.template)
        const fresh = draftFromTemplateFull(res.template)
        setDraft(fresh)
        setSavedSnapshot(fresh)
      })
      .catch((err: unknown) => {
        if (cancelled) return
        setLoadError((err as { message?: string })?.message || 'Failed to load template')
      })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [routeId, isCreate, isAdmin])

  const dirty = !draftsEqual(draft, savedSnapshot)
  const settingsErrors = validateSettings(draft, mode)
  const settingsInvalid = Object.keys(settingsErrors).length > 0
  const publishable = isTemplatePublishable({
    subject: draft.subject || null,
    html_body: draft.html || null,
    text_body: draft.text || null,
    required_variables: draft.required_variables,
    channel: draft.channel,
  })
  const canSave = !saving && dirty && !settingsInvalid && publishable.ok

  const applySettings = (patch: Partial<TemplateSettingsDraft>) => {
    setDraft((prev) => ({ ...prev, ...patch }))
  }
  const applyBody = (patch: { html?: string; design_json?: unknown; text?: string }) => {
    setDraft((prev) => ({
      ...prev,
      html: patch.html !== undefined ? patch.html : prev.html,
      design_json: patch.design_json !== undefined ? patch.design_json : prev.design_json,
      text: patch.text !== undefined ? patch.text : prev.text,
    }))
  }
  const applyEditorMode = (next: PlatformTemplateEditorMode) => {
    setDraft((prev) => ({ ...prev, editor_mode: next }))
  }
  const setSubject = (next: string) => {
    setDraft((prev) => ({ ...prev, subject: next }))
  }

  const handleSave = useCallback(async () => {
    if (!canSave) return
    setSaving(true)
    setSaveError(null)
    try {
      const call = async () => {
        if (isCreate) {
          const created = await api.createPlatformTemplate({
            code: draft.code,
            display_name: draft.display_name,
            description: draft.description || undefined,
            channel: draft.channel,
            category: draft.category,
            language: draft.language,
            territory_id: draft.territory_id,
            subject: draft.subject || null,
            html_body: draft.html || null,
            text_body: draft.text || null,
            design_json: draft.design_json,
            editor_mode: draft.editor_mode,
            required_variables: draft.required_variables,
            optional_variables: draft.optional_variables,
            is_active: draft.is_active,
          })
          return { template: created.template, kind: 'create' as const }
        }
        const updated = await api.updatePlatformTemplate(routeId as string, {
          display_name: draft.display_name,
          description: draft.description || null,
          subject: draft.subject || null,
          html_body: draft.html || null,
          text_body: draft.text || null,
          design_json: draft.design_json,
          editor_mode: draft.editor_mode,
          required_variables: draft.required_variables,
          optional_variables: draft.optional_variables,
          is_active: draft.is_active,
          change_note: changeNote || undefined,
        })
        return { template: updated.template, kind: 'update' as const }
      }
      const res = await runElevated(call, mode === 'create' ? 'create template' : 'save template')
      if (!res) {
        // Elevation cancelled — keep the draft dirty for retry.
        setSaving(false)
        return
      }
      setTemplate(res.template)
      const fresh = draftFromTemplateFull(res.template)
      setDraft(fresh)
      setSavedSnapshot(fresh)
      setChangeNote('')
      addToast({
        variant: 'success',
        title: res.kind === 'create' ? 'Template created' : 'Template saved',
        description: `${res.template.display_name} — now v${res.template.version}.`,
      })
      if (res.kind === 'create') {
        navigate(`/admin/message-templates/${res.template.id}`, { replace: true })
      }
    } catch (err: unknown) {
      const msg = (err as { message?: string })?.message || 'Save failed'
      setSaveError(msg)
      addToast({ variant: 'error', title: 'Save failed', description: msg })
    } finally {
      setSaving(false)
    }
  }, [canSave, isCreate, draft, routeId, changeNote, runElevated, mode, addToast, navigate])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && (e.key === 's' || e.key === 'S')) {
        e.preventDefault()
        void handleSave()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [handleSave])

  useBeforeUnload(
    useCallback((e: BeforeUnloadEvent) => {
      if (!dirty) return
      e.preventDefault()
      e.returnValue = ''
    }, [dirty]),
  )

  // NOTE: react-router-dom's useBlocker requires a data router
  // (createBrowserRouter + RouterProvider). The app is on <BrowserRouter>,
  // so we cannot use it here without a much larger routing migration.
  // For now, the safeguards against dirty-navigation loss are:
  //   1. useBeforeUnload above — catches browser tab close / refresh.
  //   2. The "unsaved changes" tag in the header — visible on any tab.
  //   3. A save-shortcut hint (Ctrl+S) in the button title, always
  //      available so an admin who realises mid-navigation still has a
  //      keyboard escape.
  // Migrating the app router to createBrowserRouter would let us block
  // in-app navigation too; tracked as its own follow-up.

  const handleDelete = async () => {
    if (!template) return
    const call = () => api.deletePlatformTemplate(template.id)
    const res = await runElevated(call, 'delete template')
    if (!res) return
    addToast({
      variant: 'success',
      title: 'Template deleted',
      description: `${template.display_name} removed.`,
    })
    navigate('/admin/message-templates')
  }

  const handleReverted = (next: PlatformMessageTemplate) => {
    setTemplate(next)
    const fresh = draftFromTemplateFull(next)
    setDraft(fresh)
    setSavedSnapshot(fresh)
    addToast({
      variant: 'success',
      title: 'Reverted',
      description: `Now on v${next.version}.`,
    })
  }

  if (!isAdmin) {
    return <NotAdminGate />
  }

  if (loading) {
    return (
      <div className="container mx-auto max-w-4xl px-4 py-8">
        <div role="status" className="flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
          <span>Loading template…</span>
        </div>
      </div>
    )
  }

  if (loadError) {
    return (
      <div className="container mx-auto max-w-4xl px-4 py-8">
        <div role="alert" className="rounded-md border border-red-200 bg-red-50 p-4 text-sm text-red-900">
          {loadError}
          <div className="mt-2 flex gap-2">
            <Button variant="outline" size="sm" onClick={() => location.reload()}>Retry</Button>
            <Button variant="ghost" size="sm" asChild>
              <Link to="/admin/message-templates">Back to list</Link>
            </Button>
          </div>
        </div>
      </div>
    )
  }

  const titleLabel = isCreate ? 'New template' : template?.display_name ?? 'Template'

  return (
    <div className="container mx-auto max-w-6xl px-4 py-6">
      {/* Header */}
      <div className="mb-4 flex items-start justify-between gap-4">
        <div className="min-w-0 flex-1">
          <div className="mb-1 flex items-center gap-2 text-sm text-muted-foreground">
            <Link
              to="/admin/message-templates"
              className="inline-flex items-center gap-1 rounded hover:text-foreground"
            >
              <ArrowLeft className="h-3.5 w-3.5" aria-hidden />
              All templates
            </Link>
            {template && (
              <>
                <span aria-hidden>·</span>
                <span>v{template.version}</span>
                {template.is_seed && <Badge variant="outline" className="ml-1">Seed</Badge>}
                {!template.is_active && <Badge variant="outline" className="ml-1 border-amber-300 text-amber-700">Inactive</Badge>}
              </>
            )}
          </div>
          <h1 className="truncate font-display text-2xl font-semibold tracking-tight">
            {titleLabel}
            {dirty && (
              <span className="ml-2 align-middle text-xs font-normal text-muted-foreground">
                • unsaved changes
              </span>
            )}
          </h1>
          {template && (
            <p className="mt-1 text-sm text-muted-foreground">
              <code>{template.code}</code> · {channelLabel(template.channel)} · {categoryLabel(template.category)} · {template.language}
              {template.territory_id ? ' · territorial' : ' · global'}
            </p>
          )}
        </div>
        <div className="flex shrink-0 items-center gap-2">
          {!isCreate && template && (
            <>
              <Button
                variant="outline"
                onClick={() => setSendTestOpen(true)}
                disabled={template.channel !== 'email' || dirty}
                title={dirty ? 'Save your changes before sending a test' : undefined}
              >
                <Send className="mr-2 h-4 w-4" aria-hidden />
                Send test
              </Button>
              <Button
                variant="outline"
                onClick={() => setDeleteOpen(true)}
                disabled={template.is_seed}
                title={template.is_seed ? 'Seed templates cannot be deleted — deactivate instead' : undefined}
              >
                <Trash2 className="mr-2 h-4 w-4" aria-hidden />
                Delete
              </Button>
            </>
          )}
          <Button onClick={() => void handleSave()} disabled={!canSave}>
            {saving ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden />
                Saving…
              </>
            ) : (
              <>
                <Save className="mr-2 h-4 w-4" aria-hidden />
                {isCreate ? 'Create' : 'Save'}
              </>
            )}
          </Button>
        </div>
      </div>

      {!publishable.ok && (
        <div role="status" className="mb-3 rounded-md border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
          Cannot save yet — {publishable.reason}
        </div>
      )}
      {saveError && (
        <div role="alert" className="mb-3 rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-900">
          {saveError}
        </div>
      )}

      {draft.channel === 'email' && (
        <SubjectBar value={draft.subject} onChange={setSubject} />
      )}

      <Tabs value={tab} onValueChange={setTab} className="mt-4">
        <TabsList>
          <TabsTrigger value="design">Design</TabsTrigger>
          <TabsTrigger value="preview">Preview</TabsTrigger>
          <TabsTrigger value="variables">Variables</TabsTrigger>
          {!isCreate && <TabsTrigger value="versions">Versions</TabsTrigger>}
          <TabsTrigger value="settings">Settings</TabsTrigger>
        </TabsList>

        <TabsContent value="design" className="mt-4">
          <UnlayerEditor
            mode={draft.editor_mode}
            onModeChange={applyEditorMode}
            html={draft.html}
            designJson={draft.design_json}
            text={draft.text}
            onChange={applyBody}
            projectId={UNLAYER_PROJECT_ID}
          />
        </TabsContent>

        <TabsContent value="preview" className="mt-4">
          {template && !isCreate ? (
            <PreviewPane
              template={template}
              draft={{
                subject: draft.subject,
                html_body: draft.html,
                text_body: draft.text,
                required_variables: draft.required_variables,
                optional_variables: draft.optional_variables,
              }}
            />
          ) : (
            <Card>
              <CardContent className="p-6 text-sm text-muted-foreground">
                Preview is available after the template is saved for the first time. The Design tab
                renders the current body without the round-trip.
              </CardContent>
            </Card>
          )}
        </TabsContent>

        <TabsContent value="variables" className="mt-4">
          <VariableDiagnosticsPanel
            template={{
              subject: draft.subject,
              html_body: draft.html,
              text_body: draft.text,
              required_variables: draft.required_variables,
              optional_variables: draft.optional_variables,
            }}
          />
        </TabsContent>

        {!isCreate && template && (
          <TabsContent value="versions" className="mt-4">
            <VersionsTab
              template={template}
              onReverted={handleReverted}
              runElevated={runElevated}
            />
          </TabsContent>
        )}

        <TabsContent value="settings" className="mt-4 space-y-4">
          {mode === 'edit' && (
            <Card>
              <CardContent className="space-y-2 p-4">
                <label htmlFor="change-note" className="text-sm font-medium">Change note (optional)</label>
                <textarea
                  id="change-note"
                  value={changeNote}
                  onChange={(e) => setChangeNote(e.target.value)}
                  rows={2}
                  maxLength={500}
                  className="w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm shadow-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                  placeholder="What did you change and why? Recorded in the version history."
                />
              </CardContent>
            </Card>
          )}
          <TemplateSettingsForm
            mode={mode}
            value={draft}
            onChange={applySettings}
            territories={territories}
            territoriesLoading={territoriesLoading}
            isSeed={template?.is_seed}
          />
        </TabsContent>
      </Tabs>

      <DeleteTemplateDialog
        template={template}
        open={deleteOpen}
        onOpenChange={setDeleteOpen}
        onConfirm={handleDelete}
      />
      <SendTestDialog
        template={template}
        open={sendTestOpen}
        onOpenChange={setSendTestOpen}
        callerEmail={agent?.email || ''}
        runElevated={runElevated}
      />
    </div>
  )
}

function SubjectBar({ value, onChange }: { value: string; onChange: (next: string) => void }) {
  return (
    <div className="mb-2">
      <label htmlFor="template-subject" className="mb-1 block text-xs font-medium uppercase tracking-wide text-muted-foreground">
        Subject
      </label>
      <input
        id="template-subject"
        type="text"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        maxLength={500}
        placeholder="Verify your account — {{code}}"
        className="w-full rounded-md border border-input bg-white px-3 py-2 text-sm shadow-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
      />
    </div>
  )
}

function NotAdminGate() {
  return (
    <div className="container mx-auto max-w-2xl px-4 py-8">
      <Card>
        <CardContent className="p-6 text-sm text-muted-foreground">
          Platform message templates are restricted to platform administrators.
        </CardContent>
      </Card>
    </div>
  )
}

