import { useEffect, useMemo, useState } from 'react'
import {
  Check, Globe, Loader2, Megaphone, Send, Settings, Share2, X,
  Instagram, MessageCircle, Video, Twitter, Facebook, Linkedin,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Badge } from '@/components/ui/badge'
import { api } from '@/api/client'

export const SOCIAL_PROMOTE_PLATFORMS: string[] = ['instagram', 'facebook', 'linkedin', 'x', 'tiktok', 'telegram']

export const PLATFORM_META: Record<string, { name: string; color: string; icon: any; handleHint: string }> = {
  whatsapp: { name: 'WhatsApp Business', color: 'text-green-600', icon: MessageCircle, handleHint: '' },
  instagram: { name: 'Instagram', color: 'text-pink-600', icon: Instagram, handleHint: '@youragency' },
  facebook: { name: 'Facebook Page', color: 'text-blue-600', icon: Facebook, handleHint: 'Page name or numeric page ID' },
  linkedin: { name: 'LinkedIn', color: 'text-blue-700', icon: Linkedin, handleHint: 'Company page URL or personal profile URL' },
  telegram: { name: 'Telegram', color: 'text-blue-500', icon: Send, handleHint: '@your_channel or channel link' },
  tiktok: { name: 'TikTok', color: 'text-black', icon: Video, handleHint: '@yourhandle' },
  x: { name: 'X (Twitter)', color: 'text-slate-800', icon: Twitter, handleHint: '@yourhandle' },
}

type Mode = 'promote' | 'distribute'

export function PromoteDistributeModal({
  open,
  mode,
  property,
  platforms,
  myConnections,
  fiAccounts,
  whatsappRecipient,
  onClose,
  onDone,
}: {
  open: boolean
  mode: Mode
  property: any
  platforms: any[]
  myConnections: any[]
  fiAccounts: any[]
  whatsappRecipient: string
  onClose: () => void
  onDone: () => void
}) {
  const [selectedOwn, setSelectedOwn] = useState<string[]>([])
  const [selectedFi, setSelectedFi] = useState<string[]>([])
  const [caption, setCaption] = useState('')
  const [fiMessage, setFiMessage] = useState('')
  const [recipient, setRecipient] = useState(whatsappRecipient || '')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    if (!open) return
    setSelectedOwn([])
    setSelectedFi([])
    setCaption('')
    setFiMessage(mode === 'promote' ? 'Please promote this listing on REB pages' : '')
    setRecipient(whatsappRecipient || '')
    setError('')
  }, [open, mode, property?.id, whatsappRecipient])

  const connected = useMemo(
    () => myConnections.filter((c) => c.status === 'connected').map((c) => c.platform),
    [myConnections]
  )

  const ownOptions = useMemo(() => {
    if (mode === 'promote') {
      return platforms.filter((p) => SOCIAL_PROMOTE_PLATFORMS.includes(p.id))
    }
    return platforms
  }, [platforms, mode])

  const fiOptions = useMemo(() => {
    if (mode === 'promote') {
      return fiAccounts.filter((a) => SOCIAL_PROMOTE_PLATFORMS.includes(a.platform))
    }
    return fiAccounts
  }, [fiAccounts, mode])

  if (!open || !property) return null

  const toggle = (list: string[], id: string, setter: (v: string[]) => void) => {
    setter(list.includes(id) ? list.filter((x) => x !== id) : [...list, id])
  }

  const defaultCaption = () => {
    const price = property.price ? `$${Number(property.price).toLocaleString()}` : ''
    const city = property.city || property.location || ''
    return `${property.title}${city ? ` · ${city}` : ''}${price ? ` · ${price}` : ''}\n\nAvailable on REB`
  }

  const handleSubmit = async () => {
    setError('')
    if (selectedOwn.length === 0 && selectedFi.length === 0) {
      setError('Select at least one of your platforms or a REB page.')
      return
    }
    const missing = selectedOwn.filter((p) => !connected.includes(p))
    if (missing.length) {
      setError(`Connect these accounts in Channel Settings first: ${missing.join(', ')}`)
      return
    }
    setLoading(true)
    try {
      if (selectedOwn.length > 0) {
        const rows = await api.distributeOwn(property.id, selectedOwn, {
          mode: 'publish',
          recipient: recipient || undefined,
          caption: caption.trim() || defaultCaption(),
          intent: mode,
        })
        const failed = (rows || []).filter((r: any) => r.status === 'failed')
        if (failed.length) {
          setError(failed.map((f: any) => `${f.platform}: ${f.error}`).join('\n'))
          setLoading(false)
          return
        }
      }
      if (selectedFi.length > 0) {
        await api.submitToFi(property.id, selectedFi, fiMessage || caption.trim() || defaultCaption())
      }
      onDone()
      onClose()
    } catch (e: any) {
      setError(e.message || 'Failed to publish')
    } finally {
      setLoading(false)
    }
  }

  const title = mode === 'promote' ? 'Promote listing' : 'Distribute listing'
  const subtitle =
    mode === 'promote'
      ? 'Post to your connected socials and/or request placement on REB pages'
      : 'Publish to your channels or submit to REB for review'

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div className="w-full max-w-xl rounded-xl bg-white p-6 shadow-xl max-h-[90vh] overflow-y-auto">
        <div className="mb-4 flex items-start justify-between gap-3">
          <div>
            <h3 className="flex items-center gap-2 text-lg font-bold">
              {mode === 'promote' ? <Megaphone className="h-5 w-5" /> : <Share2 className="h-5 w-5" />}
              {title}
            </h3>
            <p className="text-sm text-muted-foreground truncate">{property.title}</p>
            <p className="mt-1 text-xs text-muted-foreground">{subtitle}</p>
          </div>
          <button type="button" onClick={onClose} className="rounded-full p-1 hover:bg-muted">
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="mb-6">
          <h4 className="mb-2 flex items-center gap-2 text-sm font-semibold">
            <Settings className="h-4 w-4" />
            Your social platforms
          </h4>
          <div className="space-y-2">
            {ownOptions.map((p: any) => {
              const isConnected = connected.includes(p.id)
              const isSel = selectedOwn.includes(p.id)
              const conn = myConnections.find((c) => c.platform === p.id && c.status === 'connected')
              const Icon = PLATFORM_META[p.id]?.icon || Globe
              return (
                <button
                  key={p.id}
                  type="button"
                  disabled={!isConnected}
                  onClick={() => isConnected && toggle(selectedOwn, p.id, setSelectedOwn)}
                  className={`w-full flex items-center gap-3 rounded-lg border p-3 text-left transition-colors ${
                    !isConnected
                      ? 'opacity-60 cursor-not-allowed bg-muted/30'
                      : isSel
                        ? 'border-[#0F0F0F] bg-[#0F0F0F]/5'
                        : 'hover:bg-muted/50'
                  }`}
                >
                  <div className={`rounded-lg p-2 ${isSel ? 'bg-[#0F0F0F] text-white' : 'bg-muted'}`}>
                    <Icon className="h-4 w-4" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="font-medium text-sm flex items-center gap-2">
                      {p.name}
                      {isConnected ? (
                        <Badge variant="outline" className="text-[10px] text-green-700">Connected</Badge>
                      ) : (
                        <Badge variant="secondary" className="text-[10px]">Not connected</Badge>
                      )}
                    </p>
                    <p className="text-xs text-muted-foreground truncate">
                      {isConnected
                        ? `Post to ${conn?.account_name || conn?.settings?.handle || 'your account'}`
                        : 'Connect this account under Channel Settings'}
                    </p>
                  </div>
                  {isSel && <Check className="h-5 w-5" />}
                </button>
              )
            })}
          </div>
        </div>

        {selectedOwn.includes('whatsapp') && mode === 'distribute' && (
          <div className="mb-6">
            <Label className="text-sm font-semibold">WhatsApp recipient</Label>
            <Input
              className="mt-2"
              placeholder="9617XXXXXXX"
              value={recipient}
              onChange={(e) => setRecipient(e.target.value)}
            />
          </div>
        )}

        <div className="mb-6">
          <Label className="text-sm font-semibold">Caption / post copy</Label>
          <textarea
            className="mt-2 min-h-[88px] w-full rounded-md border bg-background px-3 py-2 text-sm"
            placeholder={defaultCaption()}
            value={caption}
            onChange={(e) => setCaption(e.target.value)}
          />
          <p className="mt-1 text-xs text-muted-foreground">Used on your social posts. Leave blank to auto-generate.</p>
        </div>

        <div className="relative my-4">
          <div className="absolute inset-0 flex items-center"><div className="w-full border-t" /></div>
          <div className="relative flex justify-center text-xs">
            <span className="bg-white px-2 text-muted-foreground">and / or</span>
          </div>
        </div>

        <div className="mb-6">
          <h4 className="mb-2 flex items-center gap-2 text-sm font-semibold">
            <Globe className="h-4 w-4" />
            REB pages
            <span className="text-xs font-normal text-muted-foreground">(goes to admin review)</span>
          </h4>
          <div className="space-y-2">
            {fiOptions.map((acc: any) => {
              const isSel = selectedFi.includes(acc.platform)
              const Icon = PLATFORM_META[acc.platform]?.icon || Globe
              return (
                <button
                  key={acc.id}
                  type="button"
                  onClick={() => toggle(selectedFi, acc.platform, setSelectedFi)}
                  className={`w-full flex items-center gap-3 rounded-lg border p-3 text-left transition-colors ${
                    isSel ? 'border-[#0F0F0F] bg-[#0F0F0F]/5' : 'hover:bg-muted/50'
                  }`}
                >
                  <div className={`rounded-lg p-2 ${isSel ? 'bg-[#0F0F0F] text-white' : 'bg-muted'}`}>
                    <Icon className="h-4 w-4" />
                  </div>
                  <div className="flex-1">
                    <p className="font-medium text-sm">{acc.account_name}</p>
                    <p className="text-xs text-muted-foreground">{acc.description}</p>
                  </div>
                  {isSel && <Check className="h-5 w-5" />}
                </button>
              )
            })}
          </div>
          {selectedFi.length > 0 && (
            <div className="mt-3">
              <Label className="text-xs">Note for REB review team</Label>
              <Input
                className="mt-1"
                value={fiMessage}
                onChange={(e) => setFiMessage(e.target.value)}
                placeholder="e.g. Feature on Instagram this weekend"
              />
            </div>
          )}
        </div>

        {error && (
          <div className="mb-4 whitespace-pre-wrap rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
            {error}
          </div>
        )}

        <div className="flex justify-end gap-2">
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button
            onClick={handleSubmit}
            disabled={loading || (selectedOwn.length === 0 && selectedFi.length === 0)}
            className="gap-2 bg-[#0F0F0F] text-white hover:bg-[#2F2F2F]"
          >
            {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : mode === 'promote' ? <Megaphone className="h-4 w-4" /> : <Send className="h-4 w-4" />}
            {mode === 'promote' ? 'Promote now' : 'Publish'}
          </Button>
        </div>
      </div>
    </div>
  )
}
