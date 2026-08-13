import { useMemo, useState } from 'react'
import { Link, useLocation, useNavigate } from 'react-router-dom'
import { CheckCircle2, Loader2, ShieldCheck } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { api } from '@/api/client'
import { usePageTitle } from '@/lib/usePageTitle'

export function AccountRecoveryCompletePage() {
  usePageTitle('Complete Account Recovery')
  const navigate = useNavigate()
  const location = useLocation()

  const { caseId, token } = useMemo(() => {
    const params = new URLSearchParams(location.search)
    return {
      caseId: params.get('case_id') || '',
      token: params.get('token') || '',
    }
  }, [location.search])

  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [done, setDone] = useState(false)

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError('')

    if (!caseId || !token) {
      setError('Recovery link is invalid. Please request account recovery again.')
      return
    }
    if (password.length < 10) {
      setError('Password must be at least 10 characters long.')
      return
    }
    if (password !== confirm) {
      setError('Passwords do not match.')
      return
    }

    setLoading(true)
    try {
      await api.completeAccountRecovery({
        case_id: caseId,
        token,
        password,
      })
      setDone(true)
      setTimeout(() => navigate('/login', { replace: true }), 1800)
    } catch (err: any) {
      setError(err.message || 'Could not complete account recovery. Please request a new recovery process.')
    } finally {
      setLoading(false)
    }
  }

  if (done) {
    return (
      <div className="flex min-h-[calc(100vh-8rem)] items-center justify-center bg-muted/20 px-4 py-12">
        <Card className="w-full max-w-md">
          <CardContent className="py-10 text-center">
            <CheckCircle2 className="mx-auto mb-3 h-10 w-10 text-green-600" />
            <h2 className="text-xl font-semibold">Recovery completed</h2>
            <p className="mt-1 text-sm text-muted-foreground">Your password has been reset. Redirecting to sign in…</p>
          </CardContent>
        </Card>
      </div>
    )
  }

  return (
    <div className="flex min-h-[calc(100vh-8rem)] items-center justify-center bg-muted/20 px-4 py-12">
      <div className="w-full max-w-md">
        <Card className="border shadow-sm">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-xl">
              <ShieldCheck className="h-5 w-5" />
              Complete account recovery
            </CardTitle>
            <CardDescription>Set a new password to restore account access securely.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <form onSubmit={handleSubmit} className="space-y-4" noValidate>
              <div className="space-y-2">
                <Label htmlFor="password">New password</Label>
                <Input
                  id="password"
                  type="password"
                  autoComplete="new-password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="At least 10 characters"
                  required
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="confirm">Confirm new password</Label>
                <Input
                  id="confirm"
                  type="password"
                  autoComplete="new-password"
                  value={confirm}
                  onChange={(e) => setConfirm(e.target.value)}
                  placeholder="Re-enter password"
                  required
                />
              </div>

              {error && (
                <div className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{error}</div>
              )}

              <Button type="submit" className="h-11 w-full" disabled={loading}>
                {loading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <ShieldCheck className="mr-2 h-4 w-4" />}
                Complete recovery
              </Button>
            </form>

            <p className="text-center text-sm text-muted-foreground">
              Back to{' '}
              <Link to="/login" className="font-medium text-foreground underline underline-offset-4">
                sign in
              </Link>
            </p>
          </CardContent>
        </Card>
      </div>
    </div>
  )
}
