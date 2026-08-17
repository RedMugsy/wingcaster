import { useEffect, useMemo, useState } from 'react'
import { AlertTriangle, History, Loader2, RotateCcw, User2 } from 'lucide-react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { api } from '@/api/client'
import type {
  PlatformMessageTemplate,
  PlatformMessageTemplateVersion,
} from '@/types/platformTemplates'
import { computeLineDiff, type DiffRow } from './diff'

interface Props {
  template: PlatformMessageTemplate
  /**
   * Called when a revert completes so the parent (TemplateEditPage) can
   * refetch the template + refresh its editor state. Receives the
   * revert response (the template with the bumped version).
   */
  onReverted: (next: PlatformMessageTemplate) => void
  /**
   * Elevation-aware call runner. When present, revert wraps its
   * network call so a `step_up_required` 401 surfaces the modal
   * instead of throwing. Injectable so tests don't need the full
   * StepUpProvider.
   */
  runElevated?: <T,>(action: () => Promise<T>, label?: string) => Promise<T | null>
}

/**
 * VersionsTab — history + side-by-side diff + revert.
 *
 * The current version lives on the template row; older superseded
 * versions live in platform_message_template_versions. This tab
 * fetches the version list on mount and lets an admin pick one to
 * diff against the current state, then revert with a confirm step.
 *
 * Diff is line-based, produced client-side. Server-side diff would
 * add a round-trip per selection change; the templates are small
 * enough (subject + body, kilobytes at most) that client diff is
 * instant and doesn't need coordination.
 *
 * Revert IS a mutation. It writes a new version (higher number)
 * containing the target version's content and archives the pre-revert
 * state. Elevation-gated on the backend; wrapped in runElevated here
 * so the StepUpModal shows automatically on 401.
 */
export function VersionsTab({ template, onReverted, runElevated }: Props) {
  const [versions, setVersions] = useState<PlatformMessageTemplateVersion[]>([])
  const [currentVersion, setCurrentVersion] = useState<number>(template.version)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [confirmVersion, setConfirmVersion] = useState<PlatformMessageTemplateVersion | null>(null)
  const [reverting, setReverting] = useState(false)
  const [revertError, setRevertError] = useState<string | null>(null)

  const load = async () => {
    setLoading(true)
    setError(null)
    try {
      const res = await api.getPlatformTemplateVersions(template.id)
      setVersions(res.versions)
      setCurrentVersion(res.current_version)
      // Auto-select the most recent archived version so the diff pane
      // shows something meaningful on first render.
      setSelectedId(res.versions[0]?.id ?? null)
    } catch (err: unknown) {
      setError((err as { message?: string })?.message || 'Failed to load version history')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { void load() }, [template.id])

  const selected = versions.find((v) => v.id === selectedId) || null

  const diff = useMemo(() => {
    if (!selected) return null
    return {
      subject: computeLineDiff(selected.subject ?? '', template.subject ?? ''),
      html_body: computeLineDiff(selected.html_body ?? '', template.html_body ?? ''),
      text_body: computeLineDiff(selected.text_body ?? '', template.text_body ?? ''),
    }
  }, [selected, template.subject, template.html_body, template.text_body])

  const doRevert = async (version: PlatformMessageTemplateVersion) => {
    setReverting(true)
    setRevertError(null)
    try {
      const call = () => api.revertPlatformTemplate(template.id, version.version)
      const res = runElevated ? await runElevated(call, `revert to version ${version.version}`) : await call()
      if (!res) {
        // User cancelled the elevation prompt — silent, close the confirm.
        setConfirmVersion(null)
        setReverting(false)
        return
      }
      onReverted(res.template)
      setConfirmVersion(null)
      await load()
    } catch (err: unknown) {
      setRevertError((err as { message?: string })?.message || 'Revert failed')
    } finally {
      setReverting(false)
    }
  }

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between space-y-0">
        <div>
          <CardTitle className="flex items-center gap-2 text-base">
            <History className="h-4 w-4" aria-hidden />
            Version history
          </CardTitle>
          <p className="mt-1 text-xs text-muted-foreground">
            Current version is <b>v{currentVersion}</b>. Older superseded versions are listed below —
            select one to see what changed, or revert to restore its content as a new version.
          </p>
        </div>
      </CardHeader>
      <CardContent>
        {loading ? (
          <div role="status" className="flex items-center gap-2 py-8 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
            <span>Loading history…</span>
          </div>
        ) : error ? (
          <div role="alert" className="rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-900">
            {error}
            <div className="mt-2">
              <Button variant="outline" size="sm" onClick={() => void load()}>Retry</Button>
            </div>
          </div>
        ) : versions.length === 0 ? (
          <EmptyState />
        ) : (
          <div className="grid grid-cols-1 gap-4 lg:grid-cols-[280px_1fr]">
            <VersionList
              versions={versions}
              currentVersion={currentVersion}
              selectedId={selectedId}
              onSelect={setSelectedId}
              onRequestRevert={(v) => { setRevertError(null); setConfirmVersion(v) }}
            />
            <DiffView
              template={template}
              selected={selected}
              currentVersion={currentVersion}
              diff={diff}
            />
          </div>
        )}
      </CardContent>

      <RevertConfirmDialog
        version={confirmVersion}
        currentVersion={currentVersion}
        open={Boolean(confirmVersion)}
        onOpenChange={(next) => { if (!next && !reverting) { setConfirmVersion(null); setRevertError(null) } }}
        onConfirm={() => confirmVersion ? doRevert(confirmVersion) : Promise.resolve()}
        busy={reverting}
        error={revertError}
      />
    </Card>
  )
}

function EmptyState() {
  return (
    <div className="rounded-md border border-dashed border-border p-8 text-center">
      <History className="mx-auto mb-3 h-8 w-8 text-muted-foreground" aria-hidden />
      <p className="text-sm font-medium">No prior versions yet.</p>
      <p className="mt-1 text-xs text-muted-foreground">
        This template is on its first version. The moment an admin edits and saves it, the previous
        state is archived here.
      </p>
    </div>
  )
}

function VersionList({
  versions,
  currentVersion,
  selectedId,
  onSelect,
  onRequestRevert,
}: {
  versions: PlatformMessageTemplateVersion[]
  currentVersion: number
  selectedId: string | null
  onSelect: (id: string) => void
  onRequestRevert: (v: PlatformMessageTemplateVersion) => void
}) {
  // Plain <ul> + <li> semantics. Each row has TWO sibling buttons — a
  // "select this version" button (full-row hit area, aria-pressed
  // signals selection to screen readers) and a "revert" button. Nesting
  // both inside a listbox/option would produce a nested-interactive
  // violation.
  return (
    <ul className="space-y-2" aria-label="Version history">
      {versions.map((v) => {
        const isSelected = v.id === selectedId
        return (
          <li
            key={v.id}
            className={`rounded-md border transition-colors ${
              isSelected
                ? 'border-primary bg-primary/5'
                : 'border-border bg-white hover:bg-muted/40'
            }`}
          >
            <button
              type="button"
              onClick={() => onSelect(v.id)}
              aria-pressed={isSelected}
              className="block w-full rounded-t-md p-3 text-left focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              aria-label={`Show diff for version ${v.version}`}
            >
              <div className="flex items-center gap-2">
                <Badge variant="outline" className="font-mono text-xs">v{v.version}</Badge>
                <span className="text-xs text-muted-foreground">
                  {formatDate(v.created_at)}
                </span>
              </div>
              {v.change_note && (
                <p className="mt-1.5 text-sm text-foreground line-clamp-2">{v.change_note}</p>
              )}
              {v.created_by && (
                <p className="mt-1 flex items-center gap-1 text-xs text-muted-foreground">
                  <User2 className="h-3 w-3" aria-hidden />
                  {v.created_by}
                </p>
              )}
            </button>
            <div className="flex justify-end px-3 pb-3">
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => onRequestRevert(v)}
                disabled={v.version === currentVersion}
                aria-label={`Revert to version ${v.version}`}
              >
                <RotateCcw className="mr-1.5 h-3.5 w-3.5" aria-hidden />
                Revert to this
              </Button>
            </div>
          </li>
        )
      })}
    </ul>
  )
}

function DiffView({
  template,
  selected,
  currentVersion,
  diff,
}: {
  template: PlatformMessageTemplate
  selected: PlatformMessageTemplateVersion | null
  currentVersion: number
  diff: {
    subject: DiffRow[]
    html_body: DiffRow[]
    text_body: DiffRow[]
  } | null
}) {
  if (!selected || !diff) {
    return (
      <div className="rounded-md border border-dashed border-border p-8 text-center text-sm text-muted-foreground">
        Select a version to compare.
      </div>
    )
  }

  return (
    <div className="space-y-4" aria-label={`Diff: version ${selected.version} vs current v${currentVersion}`}>
      <DiffSection heading="Subject" leftLabel={`v${selected.version}`} rightLabel={`Current (v${currentVersion})`} rows={diff.subject} />
      <DiffSection heading="HTML body" leftLabel={`v${selected.version}`} rightLabel={`Current (v${currentVersion})`} rows={diff.html_body} />
      <DiffSection heading="Text body" leftLabel={`v${selected.version}`} rightLabel={`Current (v${currentVersion})`} rows={diff.text_body} />
      <VariablesDiff selected={selected} current={template} />
    </div>
  )
}

function DiffSection({
  heading,
  leftLabel,
  rightLabel,
  rows,
}: {
  heading: string
  leftLabel: string
  rightLabel: string
  rows: DiffRow[]
}) {
  const isUnchanged = rows.every((r) => r.kind === 'unchanged')
  return (
    <div className="rounded-md border border-border bg-white">
      <div className="flex items-center justify-between border-b border-border px-3 py-2">
        <h4 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{heading}</h4>
        {isUnchanged ? (
          <span className="text-xs italic text-muted-foreground">Unchanged</span>
        ) : (
          <span className="flex items-center gap-2 text-xs">
            <Badge variant="outline" className="border-red-200 bg-red-50 text-red-800">{leftLabel}</Badge>
            <span className="text-muted-foreground">→</span>
            <Badge variant="outline" className="border-emerald-200 bg-emerald-50 text-emerald-800">{rightLabel}</Badge>
          </span>
        )}
      </div>
      {isUnchanged ? null : (
        <pre className="max-h-[300px] overflow-auto whitespace-pre-wrap px-3 py-2 text-xs font-mono">
          {rows.map((row, idx) => (
            <div
              key={idx}
              className={
                row.kind === 'added'
                  ? 'bg-emerald-50 text-emerald-900'
                  : row.kind === 'removed'
                    ? 'bg-red-50 text-red-900 line-through'
                    : 'text-foreground'
              }
            >
              <span aria-hidden className="mr-2 select-none text-muted-foreground">
                {row.kind === 'added' ? '+' : row.kind === 'removed' ? '−' : ' '}
              </span>
              {row.text || ' '}
            </div>
          ))}
        </pre>
      )}
    </div>
  )
}

function VariablesDiff({
  selected,
  current,
}: {
  selected: PlatformMessageTemplateVersion
  current: PlatformMessageTemplate
}) {
  const wasRequired = new Set(selected.required_variables || [])
  const nowRequired = new Set(current.required_variables || [])
  const wasOptional = new Set(selected.optional_variables || [])
  const nowOptional = new Set(current.optional_variables || [])

  const addedRequired = [...nowRequired].filter((v) => !wasRequired.has(v))
  const removedRequired = [...wasRequired].filter((v) => !nowRequired.has(v))
  const addedOptional = [...nowOptional].filter((v) => !wasOptional.has(v))
  const removedOptional = [...wasOptional].filter((v) => !nowOptional.has(v))

  const noVariableChanges =
    !addedRequired.length && !removedRequired.length && !addedOptional.length && !removedOptional.length

  return (
    <div className="rounded-md border border-border bg-white">
      <div className="flex items-center justify-between border-b border-border px-3 py-2">
        <h4 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          Variables
        </h4>
        {noVariableChanges && (
          <span className="text-xs italic text-muted-foreground">Unchanged</span>
        )}
      </div>
      {noVariableChanges ? null : (
        <div className="space-y-2 px-3 py-2 text-xs">
          <VarLine label="Required added" tone="added" items={addedRequired} />
          <VarLine label="Required removed" tone="removed" items={removedRequired} />
          <VarLine label="Optional added" tone="added" items={addedOptional} />
          <VarLine label="Optional removed" tone="removed" items={removedOptional} />
        </div>
      )}
    </div>
  )
}

function VarLine({
  label,
  tone,
  items,
}: {
  label: string
  tone: 'added' | 'removed'
  items: string[]
}) {
  if (!items.length) return null
  return (
    <div className="flex flex-wrap items-center gap-2">
      <span className="text-muted-foreground">{label}:</span>
      {items.map((name) => (
        <Badge
          key={name}
          variant="outline"
          className={
            tone === 'added'
              ? 'border-emerald-300 bg-emerald-50 font-mono text-emerald-800'
              : 'border-red-300 bg-red-50 font-mono text-red-800 line-through'
          }
        >
          {`{{${name}}}`}
        </Badge>
      ))}
    </div>
  )
}

function RevertConfirmDialog({
  version,
  currentVersion,
  open,
  onOpenChange,
  onConfirm,
  busy,
  error,
}: {
  version: PlatformMessageTemplateVersion | null
  currentVersion: number
  open: boolean
  onOpenChange: (next: boolean) => void
  onConfirm: () => Promise<void>
  busy: boolean
  error: string | null
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent aria-describedby="revert-confirm-desc">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <RotateCcw className="h-5 w-5" aria-hidden />
            Revert to version {version?.version}?
          </DialogTitle>
          <DialogDescription id="revert-confirm-desc">
            {version ? (
              <>
                This creates a new version <b>v{currentVersion + 1}</b> containing the content of{' '}
                <b>v{version.version}</b>. The current version <b>v{currentVersion}</b> is preserved
                in history so you can un-revert if you change your mind.
              </>
            ) : null}
          </DialogDescription>
        </DialogHeader>
        {version?.change_note && (
          <div className="rounded-md border border-border bg-muted/40 p-3 text-sm">
            <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              Change note on v{version.version}
            </p>
            <p className="text-sm text-foreground">{version.change_note}</p>
          </div>
        )}
        {error && (
          <div role="alert" className="rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-900">
            <AlertTriangle className="mr-2 inline h-4 w-4" aria-hidden />
            {error}
          </div>
        )}
        <div className="flex justify-end gap-2 pt-2">
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={busy}>
            Cancel
          </Button>
          <Button onClick={() => void onConfirm()} disabled={busy || !version}>
            {busy ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden />
                Reverting…
              </>
            ) : (
              <>
                <RotateCcw className="mr-2 h-4 w-4" aria-hidden />
                Revert
              </>
            )}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}

function formatDate(iso: string): string {
  if (!iso) return ''
  try {
    const d = new Date(iso)
    return d.toLocaleString(undefined, {
      year: 'numeric', month: 'short', day: '2-digit',
      hour: '2-digit', minute: '2-digit',
    })
  } catch {
    return iso
  }
}
