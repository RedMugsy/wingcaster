import { useState } from 'react'
import { AlertTriangle, Loader2, Trash2 } from 'lucide-react'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import type { PlatformMessageTemplate } from '@/types/platformTemplates'

interface Props {
  template: PlatformMessageTemplate | null
  open: boolean
  onOpenChange: (open: boolean) => void
  onConfirm: () => Promise<void>
}

/**
 * Confirmation dialog for deleting a platform message template.
 *
 * Enforces a two-safeguards pattern for irreversible destructive actions:
 *   1. Type-to-confirm — the admin must literally type the template's `code`
 *      before Delete unlocks. This prevents muscle-memory clicks (Enter →
 *      Enter → oops) from destroying a template while an admin is speed-
 *      running the console.
 *   2. Seed guard — the backend refuses to delete a seed (returns 409). We
 *      surface that as a hard block IN THIS DIALOG so an admin cannot even
 *      request the delete; the seed row shows a Deactivate hint instead,
 *      pointing them at the correct destructive action.
 */
export function DeleteTemplateDialog({ template, open, onOpenChange, onConfirm }: Props) {
  const [typed, setTyped] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const requiredText = template?.code ?? ''
  // Empty requiredText (no template) would trivially match empty typed
  // text, enabling the destructive button. Require BOTH a template and
  // a non-empty typed match.
  const matches = Boolean(requiredText) && typed.trim() === requiredText
  const isSeed = Boolean(template?.is_seed)

  const reset = () => {
    setTyped('')
    setBusy(false)
    setError(null)
  }

  const handleOpenChange = (next: boolean) => {
    if (!next) reset()
    onOpenChange(next)
  }

  const handleDelete = async () => {
    if (!matches || busy || isSeed) return
    setBusy(true)
    setError(null)
    try {
      await onConfirm()
      reset()
      onOpenChange(false)
    } catch (err: unknown) {
      const msg = (err as { message?: string })?.message || 'Delete failed'
      setError(msg)
      setBusy(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent aria-describedby="delete-template-desc">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-destructive">
            <AlertTriangle className="h-5 w-5" aria-hidden />
            Delete this template
          </DialogTitle>
          <DialogDescription id="delete-template-desc">
            {template ? (
              <>
                You are about to permanently delete <b>{template.display_name}</b>
                {' '}(<code>{template.code}</code>). Every version in its history
                will be removed. This cannot be undone.
              </>
            ) : (
              <>Select a template first.</>
            )}
          </DialogDescription>
        </DialogHeader>

        {isSeed ? (
          <div
            role="alert"
            className="rounded-md border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900"
          >
            <p className="font-semibold">Seeded templates cannot be deleted.</p>
            <p className="mt-1">
              This template shipped with the platform and remains as a fallback
              for its send site (e.g. signup OTP, welcome email). If you want to
              stop using it, set it to <b>inactive</b> instead — the resolver
              will treat it as absent, and the send site's hardcoded fallback
              takes over.
            </p>
          </div>
        ) : (
          <>
            <div className="rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-900">
              <p className="font-semibold">This is permanent.</p>
              <p className="mt-1">
                The template row, its {template?.version ?? 0} version(s) of
                history, and any change-notes will all be removed. Sends that
                referenced this template code will fall through to their
                hardcoded fallback (for seeds) or fail (for admin-created rows
                with no fallback).
              </p>
            </div>

            <div className="space-y-2 pt-2">
              <Label htmlFor="delete-confirm-input" className="text-sm">
                To confirm, type the template code{' '}
                <code className="rounded bg-muted px-1.5 py-0.5 text-xs">{requiredText}</code>
              </Label>
              <Input
                id="delete-confirm-input"
                type="text"
                value={typed}
                onChange={(e) => setTyped(e.target.value)}
                placeholder={requiredText}
                autoComplete="off"
                autoCorrect="off"
                spellCheck={false}
                aria-invalid={typed.length > 0 && !matches}
                aria-describedby={typed.length > 0 && !matches ? 'delete-confirm-mismatch' : undefined}
              />
              {typed.length > 0 && !matches && (
                <p id="delete-confirm-mismatch" className="text-xs text-red-600">
                  Type the exact template code to enable Delete.
                </p>
              )}
            </div>
          </>
        )}

        {error && (
          <div role="alert" className="rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-900">
            {error}
          </div>
        )}

        <div className="flex justify-end gap-2 pt-2">
          <Button variant="outline" onClick={() => handleOpenChange(false)} disabled={busy}>
            Cancel
          </Button>
          <Button
            variant="destructive"
            onClick={handleDelete}
            disabled={!matches || isSeed || busy}
            aria-disabled={!matches || isSeed || busy}
          >
            {busy ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden />
                Deleting…
              </>
            ) : (
              <>
                <Trash2 className="mr-2 h-4 w-4" aria-hidden />
                Delete template
              </>
            )}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}
