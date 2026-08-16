import { useCallback, useEffect, useRef, useState } from 'react'
import QRCode from 'qrcode'
import { AlertTriangle, Check, Copy, Download, Loader2, ShieldCheck, ShieldOff } from 'lucide-react'
import { api } from '@/api/client'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Card, CardContent, CardDescription, CardHeader } from '@/components/ui/card'
import type { TotpSetup, TwoFactorStatus } from '@/types/twoFactor'

type Stage = 'idle' | 'password' | 'scan' | 'codes'

/** Matches CardTitle's styling; see the note at its first use for why. */
const CARD_HEADING = 'flex items-center gap-2 text-2xl font-semibold leading-none tracking-tight'

/**
 * Two-factor settings (Phase 7f/2).
 *
 * Enrolment is three steps, matching the backend contract:
 *   1. confirm the current password        → POST /auth/2fa/totp/setup
 *   2. scan the secret and prove it worked → POST /auth/2fa/totp/verify
 *   3. save the backup codes               → shown once, never retrievable
 *
 * The secret returned by step 1 is held in component state only. It is not a
 * credential until step 2 succeeds, and the server does not store it before
 * then either.
 */
export function TotpSettingsPage() {
  const [status, setStatus] = useState<TwoFactorStatus | null>(null)
  const [stage, setStage] = useState<Stage>('idle')
  const [password, setPassword] = useState('')
  const [setup, setSetup] = useState<TotpSetup | null>(null)
  const [qrDataUrl, setQrDataUrl] = useState<string>('')
  const [code, setCode] = useState('')
  const [backupCodes, setBackupCodes] = useState<string[]>([])
  const [acknowledgedCodes, setAcknowledgedCodes] = useState(false)
  const [disableCode, setDisableCode] = useState('')
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [busy, setBusy] = useState(false)
  const [copied, setCopied] = useState(false)
  const secretRef = useRef<HTMLElement | null>(null)

  const loadStatus = useCallback(async () => {
    try {
      setStatus(await api.twoFactorStatus())
    } catch (err: any) {
      setError(err?.message || 'Could not load two-factor status.')
    }
  }, [])

  useEffect(() => {
    void loadStatus()
  }, [loadStatus])

  // Render the QR client-side from the provisioning URI. The secret never
  // passes through an image on the server.
  useEffect(() => {
    if (!setup?.provisioning_uri) {
      setQrDataUrl('')
      return
    }
    let cancelled = false
    QRCode.toDataURL(setup.provisioning_uri, { width: 220, margin: 1 })
      .then((url) => { if (!cancelled) setQrDataUrl(url) })
      .catch(() => { if (!cancelled) setQrDataUrl('') })
    return () => { cancelled = true }
  }, [setup?.provisioning_uri])

  const reset = () => {
    setStage('idle')
    setPassword('')
    setSetup(null)
    setCode('')
    setBackupCodes([])
    setAcknowledgedCodes(false)
    setError('')
  }

  const beginSetup = async (e: React.FormEvent) => {
    e.preventDefault()
    setError('')
    setBusy(true)
    try {
      const result = await api.totpSetup(password)
      setSetup(result)
      setPassword('')
      setStage('scan')
    } catch (err: any) {
      setError(err?.message || 'Could not start enrolment.')
    } finally {
      setBusy(false)
    }
  }

  const confirmSetup = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!setup) return
    setError('')
    setBusy(true)
    try {
      const result = await api.totpVerify(setup.secret, code.trim())
      setBackupCodes(result.backup_codes)
      setSetup(null)
      setCode('')
      setStage('codes')
      await loadStatus()
    } catch (err: any) {
      setError(err?.message || 'That code was not accepted. Check your device clock and try the next one.')
      setCode('')
    } finally {
      setBusy(false)
    }
  }

  const disable = async (e: React.FormEvent) => {
    e.preventDefault()
    setError('')
    setBusy(true)
    try {
      await api.totpDisable(disableCode.trim())
      setDisableCode('')
      setNotice('Two-factor authentication is off. Every other signed-in session was signed out.')
      await loadStatus()
    } catch (err: any) {
      setError(err?.message || 'That code was not accepted.')
      setDisableCode('')
    } finally {
      setBusy(false)
    }
  }

  const copySecret = async () => {
    if (!setup) return
    try {
      await navigator.clipboard.writeText(setup.secret)
      setCopied(true)
      window.setTimeout(() => setCopied(false), 2000)
    } catch {
      // Clipboard unavailable — the secret is on screen to type manually.
      setCopied(false)
    }
  }

  const downloadCodes = () => {
    const body = [
      'Wingcaster backup codes',
      '',
      'Each code works once. Store them somewhere safe and offline —',
      'they are the only way back in if you lose your authenticator.',
      '',
      ...backupCodes,
      '',
    ].join('\n')
    const blob = new Blob([body], { type: 'text/plain' })
    const url = URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.href = url
    link.download = 'wingcaster-backup-codes.txt'
    document.body.appendChild(link)
    link.click()
    document.body.removeChild(link)
    URL.revokeObjectURL(url)
  }

  return (
    <div className="mx-auto max-w-2xl space-y-6 px-4 py-10">
      <header>
        <h1 className="text-2xl font-bold tracking-tight">Two-factor authentication</h1>
        <p className="mt-1 text-muted-foreground">
          Add a second step to sign-in and to approving sensitive actions.
        </p>
      </header>

      {error && (
        <div role="alert" className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
          {error}
        </div>
      )}
      {notice && (
        <div role="status" className="rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-800">
          {notice}
        </div>
      )}

      {/* ---------------------------------------------------------------- */}
      {/* Backup codes — shown once, immediately after enrolment            */}
      {/* ---------------------------------------------------------------- */}
      {stage === 'codes' && (
        <Card>
          <CardHeader>
            {/* An <h2>, not <CardTitle>: that component renders an <h3>, and
                the page heading above is an <h1> — jumping a level is a
                heading-order violation. */}
            <h2 className={CARD_HEADING}>
              <AlertTriangle className="h-5 w-5 text-amber-600" />
              Save your backup codes
            </h2>
            <CardDescription>
              These are shown once and cannot be retrieved again. Each works a single time, and they are
              the only way into your account if you lose your authenticator.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <ul className="grid grid-cols-2 gap-2 rounded-md border bg-muted/30 p-4 font-mono text-sm">
              {backupCodes.map((c) => (
                <li key={c}>{c}</li>
              ))}
            </ul>
            <Button type="button" variant="outline" onClick={downloadCodes}>
              <Download className="mr-2 h-4 w-4" />
              Download codes
            </Button>
            <label className="flex items-start gap-2 text-sm">
              <input
                type="checkbox"
                className="mt-1"
                checked={acknowledgedCodes}
                onChange={(e) => setAcknowledgedCodes(e.target.checked)}
              />
              <span>I have saved these codes somewhere safe.</span>
            </label>
            <Button type="button" disabled={!acknowledgedCodes} onClick={reset}>
              Done
            </Button>
          </CardContent>
        </Card>
      )}

      {/* ---------------------------------------------------------------- */}
      {/* Current state + enrolment / disable                              */}
      {/* ---------------------------------------------------------------- */}
      {stage !== 'codes' && (
        <Card>
          <CardHeader>
            <h2 className={CARD_HEADING}>
              {status?.totp_enabled ? (
                <>
                  <ShieldCheck className="h-5 w-5 text-emerald-600" />
                  Authenticator app is on
                </>
              ) : (
                <>
                  <ShieldOff className="h-5 w-5 text-muted-foreground" />
                  Authenticator app is off
                </>
              )}
            </h2>
            <CardDescription>
              {status?.totp_enabled
                ? `${status.backup_codes_remaining} backup code${status.backup_codes_remaining === 1 ? '' : 's'} remaining.`
                : 'Sign-in currently needs only your password.'}
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-5">
            {!status && <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />}

            {/* --- not enrolled: start --- */}
            {status && !status.totp_enabled && stage === 'idle' && (
              <Button type="button" onClick={() => { setStage('password'); setError('') }}>
                Set up authenticator app
              </Button>
            )}

            {/* --- step 1: confirm password --- */}
            {status && !status.totp_enabled && stage === 'password' && (
              <form onSubmit={beginSetup} className="space-y-4" noValidate>
                <div className="space-y-2">
                  <Label htmlFor="current-password">Confirm your password</Label>
                  <Input
                    id="current-password"
                    type="password"
                    autoComplete="current-password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    required
                  />
                  <p className="text-sm text-muted-foreground">
                    Re-entering your password stops someone using a borrowed unlocked laptop from
                    attaching their own authenticator to your account.
                  </p>
                </div>
                <div className="flex gap-2">
                  <Button type="button" variant="outline" onClick={reset} disabled={busy}>
                    Cancel
                  </Button>
                  <Button type="submit" disabled={busy}>
                    {busy ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
                    Continue
                  </Button>
                </div>
              </form>
            )}

            {/* --- step 2: scan + verify --- */}
            {stage === 'scan' && setup && (
              <form onSubmit={confirmSetup} className="space-y-4" noValidate>
                <div className="space-y-3">
                  <p className="text-sm">
                    Scan this with Google Authenticator, Authy, 1Password or any TOTP app.
                  </p>
                  {qrDataUrl ? (
                    <img
                      src={qrDataUrl}
                      alt="QR code for setting up your authenticator app"
                      className="rounded-md border bg-white p-2"
                      width={220}
                      height={220}
                    />
                  ) : (
                    <p className="text-sm text-muted-foreground">Preparing QR code&hellip;</p>
                  )}
                  <div className="space-y-1">
                    <p className="text-sm text-muted-foreground">Can&rsquo;t scan? Enter this key by hand:</p>
                    <div className="flex items-center gap-2">
                      <code ref={secretRef} className="rounded bg-muted px-2 py-1 font-mono text-sm break-all">
                        {setup.secret}
                      </code>
                      <Button type="button" variant="outline" size="sm" onClick={copySecret}>
                        {copied ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
                        <span className="sr-only">Copy setup key</span>
                      </Button>
                    </div>
                  </div>
                </div>
                <div className="space-y-2">
                  <Label htmlFor="verify-code">Enter the 6-digit code from the app</Label>
                  <Input
                    id="verify-code"
                    autoComplete="one-time-code"
                    inputMode="numeric"
                    value={code}
                    onChange={(e) => setCode(e.target.value)}
                    placeholder="123456"
                    required
                  />
                </div>
                <div className="flex gap-2">
                  <Button type="button" variant="outline" onClick={reset} disabled={busy}>
                    Cancel
                  </Button>
                  <Button type="submit" disabled={busy}>
                    {busy ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
                    Turn on
                  </Button>
                </div>
              </form>
            )}

            {/* --- enrolled: disable --- */}
            {status?.totp_enabled && (
              <form onSubmit={disable} className="space-y-4" noValidate>
                <div className="space-y-2">
                  <Label htmlFor="disable-code">Authentication or backup code</Label>
                  <Input
                    id="disable-code"
                    autoComplete="one-time-code"
                    value={disableCode}
                    onChange={(e) => setDisableCode(e.target.value)}
                    placeholder="123456 or ABCDE-FGHJK"
                    required
                  />
                  <p className="text-sm text-muted-foreground">
                    Turning this off signs out every other session on your account.
                  </p>
                </div>
                <Button type="submit" variant="outline" disabled={busy}>
                  {busy ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <ShieldOff className="mr-2 h-4 w-4" />}
                  Turn off two-factor
                </Button>
              </form>
            )}
          </CardContent>
        </Card>
      )}
    </div>
  )
}
