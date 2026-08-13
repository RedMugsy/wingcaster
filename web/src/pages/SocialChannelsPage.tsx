import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import {
  ArrowLeft, Check, ExternalLink, Facebook, Instagram, Linkedin, Loader2, Lock,
  MessageCircle, Plug, Twitter, Unplug, Video,
} from 'lucide-react'
import { api } from '@/api/client'
import { useAuth } from '@/context/AuthContext'
import { useToast } from '@/components/ui/toast'
import { usePageTitle } from '@/lib/usePageTitle'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'

type FieldSpec = { key: string; label: string; required: boolean; secret: boolean }
type PlatformSpec = { model: 'enterprise' | 'oauth'; target_fields: FieldSpec[] }
type Connection = {
  id: string
  platform: string
  account_name: string
  status: string
  handle: string | null
  enterprise_targets: Record<string, string>
  oauth: { connected: boolean; scope?: string | null; expires_at?: string | null; user_id?: string | null }
  updated_at: string | null
}

const PLATFORM_META: Record<string, { name: string; icon: any; color: string; description: string }> = {
  facebook: { name: 'Facebook Page', icon: Facebook, color: 'text-blue-600', description: 'Publish page posts + reply to comments and Messenger DMs via Meta Graph.' },
  instagram: { name: 'Instagram', icon: Instagram, color: 'text-pink-600', description: 'Publish feed / carousel / reels / stories + reply to DMs and comments.' },
  linkedin: { name: 'LinkedIn', icon: Linkedin, color: 'text-blue-700', description: 'Publish text, image, and article posts to a page or personal profile.' },
  whatsapp: { name: 'WhatsApp Business', icon: MessageCircle, color: 'text-green-600', description: 'Send template messages and Status broadcasts via WhatsApp Cloud API.' },
  x: { name: 'X (Twitter)', icon: Twitter, color: 'text-slate-800', description: 'Publish tweets, reply to mentions, and DM leads.' },
  tiktok: { name: 'TikTok', icon: Video, color: 'text-black', description: 'Publish photo carousels and vertical video via the Content Posting API.' },
}

const PLATFORM_ORDER = ['facebook', 'instagram', 'linkedin', 'whatsapp', 'x', 'tiktok']

export function SocialChannelsPage() {
  const { agent, loading: authLoading } = useAuth()
  const { addToast } = useToast()
  usePageTitle('Social Channels')

  const [config, setConfig] = useState<Record<string, PlatformSpec> | null>(null)
  const [connections, setConnections] = useState<Connection[]>([])
  const [loading, setLoading] = useState(true)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const [cfg, conns] = await Promise.all([
        api.getSocialChannelsConfig(),
        api.getSocialChannels(),
      ])
      setConfig(cfg.connection_fields as any)
      setConnections(conns as any)
    } catch (err: any) {
      addToast({ title: 'Failed to load channels', description: err?.message, variant: 'error' })
    } finally {
      setLoading(false)
    }
  }, [addToast])

  useEffect(() => {
    if (!authLoading && agent) load()
  }, [authLoading, agent, load])

  // Listen for OAuth completion messages from the popup.
  useEffect(() => {
    function onMessage(evt: MessageEvent) {
      if (evt.data?.type === 'listingclarion:oauth:done') {
        addToast({ title: `Connected to ${evt.data.platform}`, variant: 'success' })
        load()
      }
    }
    window.addEventListener('message', onMessage)
    return () => window.removeEventListener('message', onMessage)
  }, [addToast, load])

  const connectionByPlatform = useMemo(() => {
    const map: Record<string, Connection> = {}
    for (const c of connections) map[c.platform] = c
    return map
  }, [connections])

  if (authLoading || loading) {
    return (
      <div className="flex min-h-[60vh] items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    )
  }

  if (!agent) {
    return (
      <div className="mx-auto max-w-lg py-16 text-center">
        <h1 className="text-2xl font-semibold">Sign in to manage channels</h1>
        <Link to="/login" className="mt-3 inline-block"><Button>Sign in</Button></Link>
      </div>
    )
  }

  return (
    <div className="mx-auto max-w-4xl px-4 py-6 sm:px-6 lg:px-8">
      <div className="mb-4 flex items-center gap-2 text-sm text-muted-foreground">
        <Link to="/dashboard" className="inline-flex items-center gap-1 hover:text-foreground">
          <ArrowLeft className="h-4 w-4" /> Dashboard
        </Link>
        <span>·</span>
        <span>Settings</span>
      </div>

      <div className="mb-6">
        <h1 className="text-2xl font-semibold tracking-tight">Social channels</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Each channel is per-tenant. Facebook, Instagram, LinkedIn, and WhatsApp use ListingClarion's
          enterprise access — you provide your platform IDs so posts publish under your identity.
          X and TikTok use per-agent OAuth — click "Connect" to authorise your own account.
        </p>
      </div>

      <div className="space-y-4">
        {PLATFORM_ORDER.map((platform) => {
          const spec = config?.[platform]
          if (!spec) return null
          return (
            <PlatformCard
              key={platform}
              platform={platform}
              spec={spec}
              connection={connectionByPlatform[platform] || null}
              onChanged={load}
            />
          )
        })}
      </div>
    </div>
  )
}

function PlatformCard({
  platform, spec, connection, onChanged,
}: {
  platform: string
  spec: PlatformSpec
  connection: Connection | null
  onChanged: () => void
}) {
  const { addToast } = useToast()
  const meta = PLATFORM_META[platform] || { name: platform, icon: Plug, color: 'text-slate-700', description: '' }
  const Icon = meta.icon
  const [expanded, setExpanded] = useState(false)
  const [busy, setBusy] = useState(false)
  const [values, setValues] = useState<Record<string, string>>(() => {
    const initial: Record<string, string> = {}
    for (const f of spec.target_fields) {
      initial[f.key] = connection?.enterprise_targets?.[f.key] || ''
    }
    return initial
  })

  useEffect(() => {
    const next: Record<string, string> = {}
    for (const f of spec.target_fields) {
      next[f.key] = connection?.enterprise_targets?.[f.key] || ''
    }
    setValues(next)
  }, [connection, spec.target_fields])

  const isConnected = connection?.status === 'connected'
  const isOAuth = spec.model === 'oauth'

  async function saveEnterprise() {
    if (busy) return
    for (const f of spec.target_fields) {
      if (f.required && !f.secret && !values[f.key]?.trim()) {
        addToast({ title: `${f.label} is required`, variant: 'error' })
        return
      }
    }
    setBusy(true)
    try {
      await api.upsertSocialChannel(platform, { enterprise_targets: values })
      addToast({ title: `${meta.name} saved`, variant: 'success' })
      onChanged()
      setExpanded(false)
    } catch (err: any) {
      addToast({ title: 'Save failed', description: err?.message, variant: 'error' })
    } finally {
      setBusy(false)
    }
  }

  async function startOAuth() {
    if (busy) return
    setBusy(true)
    try {
      const r = await api.startSocialOAuth(platform)
      const popup = window.open(r.auth_url, `oauth_${platform}`, 'width=600,height=750')
      if (!popup) {
        addToast({
          title: 'Popup blocked',
          description: `Open the connect URL manually: ${r.auth_url}`,
          variant: 'warning',
        })
      } else if (r.dev) {
        // Dev mode redirects straight to our callback — no user interaction needed.
        // Give it a moment then reload.
        setTimeout(onChanged, 1500)
      }
    } catch (err: any) {
      addToast({ title: 'Could not start OAuth', description: err?.message, variant: 'error' })
    } finally {
      setBusy(false)
    }
  }

  async function disconnect() {
    if (busy || !isConnected) return
    if (!window.confirm(`Disconnect ${meta.name}? You'll need to re-enter details / re-authorise to reconnect.`)) return
    setBusy(true)
    try {
      await api.disconnectSocialChannel(platform)
      addToast({ title: `${meta.name} disconnected`, variant: 'success' })
      onChanged()
    } catch (err: any) {
      addToast({ title: 'Disconnect failed', description: err?.message, variant: 'error' })
    } finally {
      setBusy(false)
    }
  }

  return (
    <Card>
      <CardHeader className="flex flex-row items-start justify-between space-y-0 pb-3">
        <div className="flex items-start gap-3">
          <Icon className={`h-6 w-6 ${meta.color}`} />
          <div>
            <div className="flex items-center gap-2">
              <CardTitle className="text-base">{meta.name}</CardTitle>
              {isConnected ? (
                <Badge className="gap-1 border-emerald-200 bg-emerald-50 text-emerald-800" variant="outline">
                  <Check className="h-3 w-3" /> Connected
                </Badge>
              ) : (
                <Badge variant="outline">Not connected</Badge>
              )}
              <Badge variant="outline" className="text-[10px]">
                {isOAuth ? 'per-agent OAuth' : 'enterprise'}
              </Badge>
            </div>
            <p className="mt-1 text-xs text-muted-foreground">{meta.description}</p>
            {isConnected && connection?.handle && (
              <p className="mt-1 text-xs text-slate-600">as <span className="font-medium">{connection.handle}</span></p>
            )}
          </div>
        </div>
        <div className="flex flex-shrink-0 items-center gap-2">
          {isOAuth ? (
            <Button size="sm" variant={isConnected ? 'outline' : 'default'} className="gap-1.5" onClick={startOAuth} disabled={busy}>
              {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <ExternalLink className="h-4 w-4" />}
              {isConnected ? 'Re-authorise' : 'Connect'}
            </Button>
          ) : (
            <Button size="sm" variant={expanded ? 'outline' : 'default'} className="gap-1.5" onClick={() => setExpanded((e) => !e)}>
              <Plug className="h-4 w-4" />
              {expanded ? 'Cancel' : isConnected ? 'Edit' : 'Set up'}
            </Button>
          )}
          {isConnected && (
            <Button size="sm" variant="ghost" className="gap-1.5 text-red-600" onClick={disconnect} disabled={busy}>
              <Unplug className="h-4 w-4" />
              Disconnect
            </Button>
          )}
        </div>
      </CardHeader>

      {!isOAuth && (expanded || !isConnected) && (
        <CardContent className="space-y-3 pt-0">
          {spec.target_fields.map((f) => (
            <div key={f.key}>
              <Label className="flex items-center gap-1 text-xs">
                {f.label}
                {f.required && <span className="text-red-600">*</span>}
                {f.secret && (
                  <span title="Encrypted at rest" className="inline-flex">
                    <Lock className="h-3 w-3 text-muted-foreground" />
                  </span>
                )}
              </Label>
              <Input
                type={f.secret ? 'password' : 'text'}
                value={values[f.key] || ''}
                onChange={(e) => setValues((prev) => ({ ...prev, [f.key]: e.target.value }))}
                placeholder={f.secret ? (connection?.enterprise_targets?.[f.key] ? '(unchanged)' : '') : ''}
                className="mt-1"
              />
            </div>
          ))}
          <div className="flex justify-end pt-1">
            <Button size="sm" onClick={saveEnterprise} disabled={busy} className="gap-1.5">
              {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}
              Save
            </Button>
          </div>
        </CardContent>
      )}
    </Card>
  )
}
