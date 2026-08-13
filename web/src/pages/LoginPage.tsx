import { useEffect, useState } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { LogIn, Building2, Loader2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { useAuth } from '@/context/AuthContext'

export function LoginPage() {
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()
  const { login, agent, loading: authLoading } = useAuth()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
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
      await login(emailValue.trim(), passwordValue)
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

  if (authLoading) {
    return (
      <div className="flex min-h-[calc(100vh-8rem)] items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
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
                <div className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
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
