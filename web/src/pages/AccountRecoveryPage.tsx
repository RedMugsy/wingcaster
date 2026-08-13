import { useState } from 'react'
import { Link } from 'react-router-dom'
import { AlertTriangle, Loader2, ShieldAlert } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { api } from '@/api/client'
import { usePageTitle } from '@/lib/usePageTitle'

export function AccountRecoveryPage() {
  usePageTitle('Account Recovery')
  const [email, setEmail] = useState('')
  const [reason, setReason] = useState('')
  const [preferredChannel, setPreferredChannel] = useState<'email' | 'whatsapp'>('email')
  const [contact, setContact] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [message, setMessage] = useState('')

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError('')
    setMessage('')

    if (!email.trim() || !email.includes('@')) {
      setError('Valid account email is required.')
      return
    }
    if (reason.trim().length < 10) {
      setError('Please provide enough detail so the security team can review your request.')
      return
    }

    setLoading(true)
    try {
      const res = await api.requestAccountRecovery({
        email: email.trim(),
        reason: reason.trim(),
        preferred_channel: preferredChannel,
        contact: contact.trim(),
      })
      setMessage(res?.message || 'Recovery request submitted. We will contact you securely after review.')
    } catch (err: any) {
      setError(err.message || 'Could not submit account recovery request.')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="flex min-h-[calc(100vh-8rem)] items-center justify-center bg-muted/20 px-4 py-12">
      <div className="w-full max-w-2xl">
        <Card className="border shadow-sm">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-xl">
              <ShieldAlert className="h-5 w-5" />
              Account recovery request
            </CardTitle>
            <CardDescription>
              Use this secure process if you cannot access your account and standard password reset is unavailable.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <form onSubmit={handleSubmit} className="space-y-4" noValidate>
              <div className="grid gap-4 sm:grid-cols-2">
                <div className="space-y-2 sm:col-span-2">
                  <Label htmlFor="email">Account email</Label>
                  <Input
                    id="email"
                    type="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    placeholder="you@agency.com"
                    required
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="channel">Preferred response channel</Label>
                  <select
                    id="channel"
                    className="h-10 w-full rounded-md border bg-background px-3 text-sm"
                    value={preferredChannel}
                    onChange={(e) => setPreferredChannel(e.target.value as 'email' | 'whatsapp')}
                  >
                    <option value="email">Email</option>
                    <option value="whatsapp">WhatsApp</option>
                  </select>
                </div>
                <div className="space-y-2">
                  <Label htmlFor="contact">Preferred contact (optional)</Label>
                  <Input
                    id="contact"
                    value={contact}
                    onChange={(e) => setContact(e.target.value)}
                    placeholder={preferredChannel === 'whatsapp' ? '+96170123456' : 'alternative@contact.com'}
                  />
                </div>
              </div>

              <div className="space-y-2">
                <Label htmlFor="reason">What happened?</Label>
                <textarea
                  id="reason"
                  className="min-h-[140px] w-full rounded-md border bg-background px-3 py-2 text-sm"
                  value={reason}
                  onChange={(e) => setReason(e.target.value)}
                  placeholder="Describe account lockout, suspected compromise, lost device, or any relevant context."
                  required
                />
              </div>

              {error && (
                <div className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{error}</div>
              )}
              {message && (
                <div className="rounded-md border border-green-200 bg-green-50 px-3 py-2 text-sm text-green-700">{message}</div>
              )}

              <Button type="submit" className="h-11 w-full" disabled={loading}>
                {loading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <AlertTriangle className="mr-2 h-4 w-4" />}
                Submit recovery request
              </Button>
            </form>

            <p className="text-center text-sm text-muted-foreground">
              Try password reset first on the{' '}
              <Link to="/forgot-password" className="font-medium text-foreground underline underline-offset-4">
                forgot password page
              </Link>
              .
            </p>
          </CardContent>
        </Card>
      </div>
    </div>
  )
}
