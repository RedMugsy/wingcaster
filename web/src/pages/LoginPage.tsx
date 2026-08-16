import { useEffect, useState } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { LogIn, Building2, Loader2, ShieldCheck } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { useAuth } from '@/context/AuthContext'
import type { TwoFactorRequired } from '@/types/twoFactor'

export function LoginPage() {
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()
  const { login, completeTwoFactor, agent, loading: authLoading } = useAuth()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  // Set only when the password was right but a second factor is required.
  const [challenge, setChallenge] = useState<TwoFactorRequired | null>(null)
  const [code, setCode] = useState('')
  const requestedReturnTo = searchParams.get('returnTo')
  const returnTo = requestedReturnTo?.startsWith('/') && !requestedReturnTo.startsWith('//') ? requestedReturnTo : '/dashboard'

  useEffect(() => {
    if (!authLoading && agent) {
      navigate(returnTo, { replace: true })
    }
  }, [authLoading, agent, navigate, returnTo])

  const doLogin = async (emailValue: string, passwordValue: string) => {
    setError('')
    if (!emailValue.trim() || !passwordValue) {
      setError('Email and password are required.')
      return
    }
    setLoading(true)
    try {
      const outcome = await login(emailValue.trim(), passwordValue)
      if (outcome.status === '2fa_required') {
        setChallenge(outcome)
        // The password is no longer needed and should not linger in state.
        setPassword('')
        return
      }
      navigate(returnTo, { replace: true })
    } catch (err: any) {
      setError(err.message || 'Login failed. Check email/password and that the API is running on port 3001.')
    } finally {
      setLoading(false)
    }
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    await doLogin(email, password)
  }

  const handleTwoFactorSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!challenge) return
    setError('')
    if (!code.trim()) {
      setError('Enter the code from your authenticator app.')
      return
    }
    setLoading(true)
    try {
      await completeTwoFactor(challenge.challenge_id, code.trim())
      navigate(returnTo, { replace: true })
    } catch (err: any) {
      setError(err.message || 'That code was not accepted.')
      setCode('')
    } finally {
      setLoading(false)
    }
  }

  const cancelTwoFactor = () => {
    setChallenge(null)
    setCode('')
    setError('')
  }

  if (authLoading) {
    return (
      <div className="flex min-h-[calc(100vh-8rem)] items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    )
  }

  if (challenge) {
    const isTotp = challenge.method === 'totp'
    return (
      <div className="flex min-h-[calc(100vh-8rem)] items-center justify-center bg-muted/20 px-4 py-12">
        <div className="w-full max-w-md">
          <div className="mb-8 text-center">
            <ShieldCheck className="mx-auto mb-4 h-12 w-12 text-foreground" />
            <h1 className="text-3xl font-bold tracking-tight">Two-factor authentication</h1>
            <p className="mt-2 text-muted-foreground">
              {isTotp
                ? 'Enter the 6-digit code from your authenticator app'
                : 'Enter the code we just emailed you'}
            </p>
          </div>

          <Card className="border shadow-sm">
            {/* No CardTitle here: it renders an <h3>, and the page heading
                above is an <h1>. Jumping h1 → h3 is a heading-order
                violation, and the title would only restate the h1 anyway. */}
            <CardHeader>
              <CardDescription>
                {isTotp
                  ? 'You can also use one of your backup codes if your phone is unavailable.'
                  : 'The code expires in 10 minutes.'}
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-5">
              <form onSubmit={handleTwoFactorSubmit} className="space-y-4" noValidate>
                <div className="space-y-2">
                  <Label htmlFor="twofa-code">{isTotp ? 'Authentication or backup code' : 'Emailed code'}</Label>
                  <Input
                    id="twofa-code"
                    // `one-time-code` lets browsers and iOS offer the code from
                    // the notification / clipboard automatically.
                    autoComplete="one-time-code"
                    inputMode={isTotp ? 'text' : 'numeric'}
                    autoFocus
                    value={code}
                    onChange={(e) => setCode(e.target.value)}
                    placeholder={isTotp ? '123456 or ABCDE-FGHJK' : '123456'}
                    required
                  />
                </div>
                {error && (
                  <div role="alert" className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
                    {error}
                  </div>
                )}
                <Button
                  type="submit"
                  className="h-11 w-full bg-[#0F0F0F] text-white hover:bg-[#2F2F2F]"
                  disabled={loading}
                >
                  {loading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <ShieldCheck className="mr-2 h-4 w-4" />}
                  Verify
                </Button>
              </form>

              <button
                type="button"
                onClick={cancelTwoFactor}
                className="w-full text-center text-sm text-muted-foreground underline underline-offset-4 hover:text-foreground"
              >
                Back to sign in
              </button>
            </CardContent>
          </Card>
        </div>
      </div>
    )
  }

  return (
    <div className="flex min-h-[calc(100vh-8rem)] items-center justify-center bg-muted/20 px-4 py-12">
      <div className="w-full max-w-md">
        <div className="mb-8 text-center">
          <Building2 className="mx-auto mb-4 h-12 w-12 text-foreground" />
          <h1 className="text-3xl font-bold tracking-tight">Sign in</h1>
          <p className="mt-2 text-muted-foreground">Access your agent dashboard, listings, and agency tools</p>
        </div>

        <Card className="border shadow-sm">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-xl">
              <LogIn className="h-5 w-5" />
              Agent / Admin login
            </CardTitle>
            <CardDescription>Enter your registered email and password</CardDescription>
          </CardHeader>
          <CardContent className="space-y-5">
            <form onSubmit={handleSubmit} className="space-y-4" noValidate>
              <div className="space-y-2">
                <Label htmlFor="email">Email</Label>
                <Input
                  id="email"
                  type="email"
                  autoComplete="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="you@agency.com"
                  required
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="password">Password</Label>
                <Input
                  id="password"
                  type="password"
                  autoComplete="current-password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="••••••••"
                  required
                />
                <div className="flex items-center justify-between pt-1 text-xs sm:text-sm">
                  <Link to="/forgot-password" className="text-muted-foreground underline underline-offset-4 hover:text-foreground">
                    Forgot password?
                  </Link>
                  <Link to="/account-recovery" className="text-muted-foreground underline underline-offset-4 hover:text-foreground">
                    Account recovery
                  </Link>
                </div>
              </div>
              {error && (
                <div role="alert" className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
                  {error}
                </div>
              )}
              <Button
                type="submit"
                className="h-11 w-full bg-[#0F0F0F] text-white hover:bg-[#2F2F2F]"
                disabled={loading || authLoading}
              >
                {loading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <LogIn className="mr-2 h-4 w-4" />}
                Sign in
              </Button>
            </form>

            <p className="text-center text-sm text-muted-foreground">
              New agent?{' '}
              <Link to="/register" className="font-medium text-foreground underline underline-offset-4">
                Create an account
              </Link>
            </p>
          </CardContent>
        </Card>
      </div>
    </div>
  )
}
