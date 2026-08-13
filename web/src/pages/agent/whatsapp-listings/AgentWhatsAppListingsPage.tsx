import { useEffect, useState } from 'react'
import { api } from '@/api/client'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { DraftCard } from '@/components/whatsapp-listings/DraftCard'
import { CreditBalance } from '@/components/whatsapp-listings/CreditBalance'
import { UsageChart } from '@/components/whatsapp-listings/UsageChart'
import { useToast } from '@/components/ui/toast'

export function AgentWhatsAppListingsPage() {
  const { addToast } = useToast()
  const [drafts, setDrafts] = useState<any[]>([])
  const [analytics, setAnalytics] = useState<any>(null)
  const [credits, setCredits] = useState<any>(null)
  const [settings, setSettings] = useState<any>(null)
  const [loading, setLoading] = useState(true)
  const [topUpAmount, setTopUpAmount] = useState('10')

  useEffect(() => {
    load()
  }, [])

  async function load() {
    setLoading(true)
    try {
      const [draftsData, analyticsData, creditsData, settingsData] = await Promise.all([
        api.getWhatsAppListingsDrafts(),
        api.getWhatsAppListingsAgentAnalytics(),
        api.getWhatsAppListingsAgentCredits(),
        api.getWhatsAppListingsAgentSettings(),
      ])
      setDrafts(draftsData)
      setAnalytics(analyticsData)
      setCredits(creditsData)
      setSettings(settingsData)
    } catch (err: any) {
      addToast({ title: 'Error', description: err.message || 'Failed to load WhatsApp listings', variant: 'error' })
    } finally {
      setLoading(false)
    }
  }

  async function handleApprove(id: string) {
    try {
      await api.approveWhatsAppListingsDraft(id)
      addToast({ title: 'Approved', description: 'Draft approved and published.' })
      load()
    } catch (err: any) {
      addToast({ title: 'Error', description: err.message || 'Failed to approve', variant: 'error' })
    }
  }

  async function handleDiscard(id: string) {
    try {
      await api.discardWhatsAppListingsDraft(id)
      addToast({ title: 'Discarded', description: 'Draft discarded.' })
      load()
    } catch (err: any) {
      addToast({ title: 'Error', description: err.message || 'Failed to discard', variant: 'error' })
    }
  }

  async function handleReprocess(id: string) {
    try {
      await api.reprocessWhatsAppListingsDraft(id)
      addToast({ title: 'Re-process', description: 'Send new details to re-process.' })
      load()
    } catch (err: any) {
      addToast({ title: 'Error', description: err.message || 'Failed to reprocess', variant: 'error' })
    }
  }

  async function handleTopUp() {
    try {
      await api.topUpWhatsAppListingsAgentCredits(Number(topUpAmount))
      addToast({ title: 'Credits topped up', description: `$${topUpAmount} added to your balance.` })
      load()
    } catch (err: any) {
      addToast({ title: 'Error', description: err.message || 'Top-up failed', variant: 'error' })
    }
  }

  async function handleSaveSettings(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    const fd = new FormData(e.currentTarget)
    try {
      await api.updateWhatsAppListingsAgentSettings({
        whatsapp_listings_ai_provider: fd.get('ai_provider'),
        whatsapp_listings_template_variant: fd.get('template_variant'),
        whatsapp_listings_auto_publish_social: fd.get('auto_publish') === 'on',
      })
      addToast({ title: 'Settings saved' })
      load()
    } catch (err: any) {
      addToast({ title: 'Error', description: err.message || 'Failed to save settings', variant: 'error' })
    }
  }

  if (loading) return <div className="p-6">Loading...</div>

  const chartData = analytics
    ? [
        { label: 'Drafts', value: analytics.total_drafts },
        { label: 'Published', value: analytics.published },
        { label: 'Discarded', value: analytics.discarded },
        { label: 'Awaiting', value: analytics.awaiting_approval },
      ]
    : []

  return (
    <div className="container mx-auto space-y-6 p-6">
      <h1 className="text-2xl font-bold">WhatsApp Listings</h1>
      <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
        <CreditBalance balance={credits?.credits_remaining || 0} reserved={credits?.credits_reserved || 0} />
        <Card>
          <CardHeader><CardTitle className="text-lg">Quota</CardTitle></CardHeader>
          <CardContent>
            <p className="text-3xl font-bold">{analytics?.quota?.used ?? 0} <span className="text-base font-normal text-muted-foreground">/ {analytics?.quota?.max ?? 0}</span></p>
            <p className="text-sm text-muted-foreground">drafts this month</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader><CardTitle className="text-lg">Approval rate</CardTitle></CardHeader>
          <CardContent>
            <p className="text-3xl font-bold">{analytics?.approval_rate ?? 0}%</p>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader><CardTitle>Top up credits</CardTitle></CardHeader>
        <CardContent className="flex gap-2">
          <Label className="sr-only" htmlFor="topup">Amount USD</Label>
          <Input id="topup" type="number" value={topUpAmount} onChange={(e) => setTopUpAmount(e.target.value)} />
          <Button onClick={handleTopUp}>Top up</Button>
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle>Settings</CardTitle></CardHeader>
        <CardContent>
          <form onSubmit={handleSaveSettings} className="space-y-4">
            <div>
              <Label htmlFor="ai_provider">AI provider</Label>
              <Input id="ai_provider" name="ai_provider" defaultValue={settings?.ai_provider_preference || 'gemini'} />
            </div>
            <div>
              <Label htmlFor="template_variant">Default template</Label>
              <Input id="template_variant" name="template_variant" defaultValue={settings?.default_template_variant || 'modern'} />
            </div>
            <div className="flex items-center gap-2">
              <input id="auto_publish" name="auto_publish" type="checkbox" defaultChecked={settings?.auto_publish_social || false} />
              <Label htmlFor="auto_publish">Auto-publish to social</Label>
            </div>
            <Button type="submit">Save settings</Button>
          </form>
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle>Usage</CardTitle></CardHeader>
        <CardContent><UsageChart data={chartData} title="Draft activity" /></CardContent>
      </Card>

      <h2 className="text-xl font-semibold">My drafts</h2>
      {drafts.length === 0 && <p className="text-muted-foreground">No drafts yet. Send property photos via WhatsApp to create one.</p>}
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
        {drafts.map((draft) => (
          <DraftCard
            key={draft.id}
            draft={draft}
            onApprove={() => handleApprove(draft.id)}
            onDiscard={() => handleDiscard(draft.id)}
            onReprocess={() => handleReprocess(draft.id)}
          />
        ))}
      </div>
    </div>
  )
}
