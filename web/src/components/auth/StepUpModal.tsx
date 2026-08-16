import { useState } from 'react'
import { Loader2, ShieldCheck } from 'lucide-react'
import { api, setElevatedToken } from '@/api/client'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import type { StepUpChallenge } from '@/types/twoFactor'

export interface StepUpModalProps {
  open: boolean
  /** Human-readable name of the action being confirmed, e.g. "grant credit". */
  actionLabel?: string
  onCancel: () => void
  /** Called once elevation has been obtained and stored. */
  onElevated: () => void
}

/**
 * Re-authentication prompt for sensitive actions (Phase 7f).
 *
 * Requests a step-up challenge on open, then exchanges the user's code for a
 * short-lived elevation token. That token is stored separately from the
 * session and attached to subsequent requests by the API client, so the
 * caller only has to retry whatever it was doing.
 */
export function StepUpModal({ open, actionLabel, onCancel, onElevated }: StepUpModalProps) {
  const [challenge, setChallenge] = useState<StepUpChallenge | null>(null)
  const [code, setCode] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const [requested, setRequested] = useState(false)

  // Ask for the challenge exactly once per opening. Doing this in render-time
  // state rather than an effect keeps the request out of the test's act()
  // warnings and avoids a double-fire under StrictMode.
  if (open && !requested) {
    setRequested(true)
    setError('')
    setChallenge(null)
    setCode('')
    api
      .stepUp()
      .then(setChallenge)
      .catch((err: any) => setError(err?.message || 'Could not start verification.'))
  }
  if (!open && requested) setRequested(false)

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!challenge) return
    if (!code.trim()) {
      setError('Enter your verification code.')
      return
    }
    setLoading(true)
    setError('')
    try {
      const result = await api.stepUpVerify(challenge.challenge_id, code.trim())
      setElevatedToken(result.elevated_token)
      setCode('')
      onElevated()
    } catch (err: any) {
      setError(err?.message || 'That code was not accepted.')
      setCode('')
    } finally {
      setLoading(false)
    }
  }

  const isTotp = challenge?.method === 'totp'

  return (
    <Dialog open={open} onOpenChange={(next) => { if (!next) onCancel() }}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <ShieldCheck className="h-5 w-5" />
            Confirm it&rsquo;s you
          </DialogTitle>
          <DialogDescription>
            {actionLabel
              ? `For your security, confirm your identity before you ${actionLabel}.`
              : 'For your security, confirm your identity before continuing.'}
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={submit} className="space-y-4" noValidate>
          <div className="space-y-2">
            <Label htmlFor="stepup-code">
              {isTotp ? 'Authentication or backup code' : 'Emailed code'}
            </Label>
            <Input
              id="stepup-code"
              autoComplete="one-time-code"
              inputMode={isTotp ? 'text' : 'numeric'}
              value={code}
              onChange={(e) => setCode(e.target.value)}
              placeholder={isTotp ? '123456 or ABCDE-FGHJK' : '123456'}
              disabled={!challenge}
              required
            />
            {!challenge && !error && (
              <p className="text-sm text-muted-foreground">Preparing verification&hellip;</p>
            )}
            {challenge && !isTotp && (
              <p className="text-sm text-muted-foreground">
                We emailed a code to your account address. It expires in 10 minutes.
              </p>
            )}
          </div>

          {error && (
            <div role="alert" className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
              {error}
            </div>
          )}

          <div className="flex gap-2">
            <Button type="button" variant="outline" className="flex-1" onClick={onCancel} disabled={loading}>
              Cancel
            </Button>
            <Button type="submit" className="flex-1" disabled={loading || !challenge}>
              {loading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
              Verify
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  )
}
