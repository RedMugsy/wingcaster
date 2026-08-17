import { useEffect, useMemo, useState } from 'react'
import { AlertTriangle, CheckCircle2, Loader2, Send } from 'lucide-react'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { api } from '@/api/client'
import type { PlatformMessageTemplate } from '@/types/platformTemplates'
import { defaultPreviewVariables, extractAllVariables } from './helpers'

interface Props {
  template: PlatformMessageTemplate | null
  open: boolean
  onOpenChange: (next: boolean) => void
  /**
   * Email of the currently signed-in admin. The backend enforces
   * SELF-ONLY delivery on this endpoint — a mismatch surfaces as HTTP
   * 403 with code=TEST_SEND_SELF_ONLY. We render the recipient field
   * locked to this address so admins don't have to guess.
   */
  callerEmail: string
  /**
   * Elevation-aware call runner. When present, test-send wraps its
   * network call so a step_up_required 401 surfaces the modal
   * automatically. Optional so tests can supply a plain-pass-through.
   */
  runElevated?: <T,>(action: () => Promise<T>, label?: string) => Promise<T | null>
}

/**
 * SendTestDialog — one-time real send of a template to the caller's own
 * inbox for visual verification.
 *
 * The backend restricts the recipient to `req.user.email` (matches
 * `to` after lower-case), so this endpoint is not usable as a "spam
 * arbitrary addresses from a trusted domain" tool. The dialog locks
 * the recipient field to the caller email up-front so admins see the
 * constraint before they hit Send instead of after.
 *
 * Only email templates are supported today — the backend returns 400
 * with code=TEST_SEND_UNSUPPORTED_CHANNEL for whatsapp/sms. The dialog
 * refuses to open in that state (parent gates the button); this is a
 * defensive re-check to keep the failure mode obvious if the button
 * gate is ever bypassed.
 */
export function SendTestDialog({ template, open, onOpenChange, callerEmail, runElevated }: Props) {
  const [variables, setVariables] = useState<Record<string, string>>({})
  const [sending, setSending] = useState(false)
  const [result, setResult] = useState<{
    kind: 'ok'; provider: string; provider_message_id: string | null
  } | { kind: 'error'; message: string; code?: string } | null>(null)

  // Reset / seed on open. When a NEW template is opened, hydrate the
  // variables form with the same sensible samples the preview pane uses
  // (defaultPreviewVariables) plus placeholders for any variable that
  // shows up in the body but wasn't declared.
  useEffect(() => {
    if (!open || !template) return
    const seeded = defaultPreviewVariables({
      required_variables: template.required_variables,
      optional_variables: template.optional_variables,
    })
    for (const name of extractAllVariables({
      subject: template.subject, html_body: template.html_body, text_body: template.text_body,
    })) {
      if (seeded[name] === undefined) seeded[name] = `<${name}>`
    }
    setVariables(seeded)
    setResult(null)
    setSending(false)
  }, [open, template])

  const varNames = useMemo(() => Object.keys(variables).sort(), [variables])
  const isEmail = template?.channel === 'email'

  const handleSend = async () => {
    if (!template || sending) return
    setSending(true)
    setResult(null)
    try {
      const call = () => api.testSendPlatformTemplate(template.id, callerEmail, variables)
      const res = runElevated ? await runElevated(call, 'send a test email') : await call()
      if (!res) {
        // User cancelled the elevation prompt — no result, no busy.
        setSending(false)
        return
      }
      setResult({ kind: 'ok', provider: res.provider, provider_message_id: res.provider_message_id })
    } catch (err: unknown) {
      const e = err as { message?: string; code?: string }
      setResult({ kind: 'error', message: e.message || 'Test send failed', code: e.code })
    } finally {
      setSending(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={(next) => { if (!next && !sending) onOpenChange(false) }}>
      <DialogContent aria-describedby="send-test-desc">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Send className="h-5 w-5" aria-hidden />
            Send a test email
          </DialogTitle>
          <DialogDescription id="send-test-desc">
            {template ? (
              <>
                Delivers <b>{template.display_name}</b> (<code>{template.code}</code>) to your own
                inbox exactly as a tenant would receive it. Subject is prefixed with{' '}
                <code>[TEST]</code> so it's easy to spot.
              </>
            ) : (
              <>Select a template first.</>
            )}
          </DialogDescription>
        </DialogHeader>

        {template && !isEmail && (
          <div role="alert" className="rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-900">
            <AlertTriangle className="mr-2 inline h-4 w-4" aria-hidden />
            Test-send is only implemented for email templates. This template's channel is{' '}
            <b>{template.channel}</b>.
          </div>
        )}

        {template && isEmail && (
          <>
            <div className="space-y-1.5">
              <Label htmlFor="send-test-to" className="text-sm">
                Deliver to
              </Label>
              <Input
                id="send-test-to"
                type="email"
                value={callerEmail}
                readOnly
                disabled
                aria-describedby="send-test-to-hint"
              />
              <p id="send-test-to-hint" className="text-xs text-muted-foreground">
                Locked to your own email — the backend refuses any other recipient. If you need to test
                on a customer address, save the template and let the real send site pick it up.
              </p>
            </div>

            {varNames.length > 0 && (
              <section aria-labelledby="send-test-vars-heading" className="space-y-2 rounded-md border border-border bg-muted/30 p-3">
                <h4 id="send-test-vars-heading" className="text-sm font-semibold">
                  Sample variables
                </h4>
                <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                  {varNames.map((name) => (
                    <div key={name} className="space-y-1">
                      <Label htmlFor={`send-test-var-${name}`} className="font-mono text-xs">
                        {`{{${name}}}`}
                      </Label>
                      <Input
                        id={`send-test-var-${name}`}
                        value={variables[name] ?? ''}
                        onChange={(e) => setVariables((prev) => ({ ...prev, [name]: e.target.value }))}
                        autoComplete="off"
                        spellCheck={false}
                      />
                    </div>
                  ))}
                </div>
                <p className="text-xs text-muted-foreground">
                  These values are used only for this test send. They are not saved to the template.
                </p>
              </section>
            )}

            {result && result.kind === 'ok' && (
              <div role="status" className="rounded-md border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-900">
                <CheckCircle2 className="mr-2 inline h-4 w-4" aria-hidden />
                Sent via <b>{result.provider}</b>
                {result.provider_message_id && <> — message id <code>{result.provider_message_id}</code></>}.
                Check your inbox at <b>{callerEmail}</b>. It should arrive within a minute; if it doesn't,
                check your spam folder and the transport health at <code>/api/health/email</code>.
              </div>
            )}

            {result && result.kind === 'error' && (
              <div role="alert" className="rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-900">
                <AlertTriangle className="mr-2 inline h-4 w-4" aria-hidden />
                {result.message}
                {result.code && <span className="ml-1 text-xs opacity-75">({result.code})</span>}
              </div>
            )}
          </>
        )}

        <div className="flex justify-end gap-2 pt-2">
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={sending}>
            {result?.kind === 'ok' ? 'Close' : 'Cancel'}
          </Button>
          <Button
            onClick={() => void handleSend()}
            disabled={!template || !isEmail || sending || result?.kind === 'ok'}
          >
            {sending ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden />
                Sending…
              </>
            ) : (
              <>
                <Send className="mr-2 h-4 w-4" aria-hidden />
                {result?.kind === 'ok' ? 'Sent' : 'Send test'}
              </>
            )}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}
