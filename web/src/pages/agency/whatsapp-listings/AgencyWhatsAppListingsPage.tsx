import { useEffect, useState } from 'react'
import { api } from '@/api/client'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { EntitlementForm } from '@/components/whatsapp-listings/EntitlementForm'
import { CreditBalance } from '@/components/whatsapp-listings/CreditBalance'
import { UsageChart } from '@/components/whatsapp-listings/UsageChart'
import { useToast } from '@/components/ui/toast'

export function AgencyWhatsAppListingsPage() {
  const { addToast } = useToast()
  const [usage, setUsage] = useState<any>(null)
  const [entitlements, setEntitlements] = useState<any[]>([])
  const [credits, setCredits] = useState<any>(null)
  const [transactions, setTransactions] = useState<any[]>([])
  const [loading, setLoading] = useState(true)
  const [topUpAmount, setTopUpAmount] = useState('50')
  const [allocate, setAllocate] = useState({ agent_id: '', amount: '10' })
  const [showForm, setShowForm] = useState(false)

  useEffect(() => {
    load()
  }, [])

  async function load() {
    setLoading(true)
    try {
      const [usageData, entitlementsData, creditsData, txData] = await Promise.all([
        api.getAgencyWhatsAppListingsUsage(),
        api.getAgencyWhatsAppListingsEntitlements(),
        api.getAgencyWhatsAppListingsCredits(),
        api.getAgencyWhatsAppListingsTransactions(),
      ])
      setUsage(usageData)
      setEntitlements(entitlementsData)
      setCredits(creditsData)
      setTransactions(txData)
    } catch (err: any) {
      addToast({ title: 'Error', description: err.message || 'Failed to load agency WhatsApp listings', variant: 'error' })
    } finally {
      setLoading(false)
    }
  }

  async function handleTopUp() {
    try {
      await api.topUpAgencyWhatsAppListingsCredits(Number(topUpAmount))
      addToast({ title: 'Credits topped up', description: `$${topUpAmount} added to agency pool.` })
      load()
    } catch (err: any) {
      addToast({ title: 'Error', description: err.message || 'Top-up failed', variant: 'error' })
    }
  }

  async function handleAllocate() {
    try {
      await api.allocateAgencyWhatsAppListingsCredits(allocate.agent_id, Number(allocate.amount))
      addToast({ title: 'Credits allocated', description: `$${allocate.amount} allocated to agent.` })
      load()
    } catch (err: any) {
      addToast({ title: 'Error', description: err.message || 'Allocation failed', variant: 'error' })
    }
  }

  async function handleCreateEntitlement(data: Record<string, unknown>) {
    try {
      await api.createAgencyWhatsAppListingsEntitlement(data)
      addToast({ title: 'Entitlement created' })
      setShowForm(false)
      load()
    } catch (err: any) {
      addToast({ title: 'Error', description: err.message || 'Failed to create entitlement', variant: 'error' })
    }
  }

  async function handleUpdateEntitlement(id: string, data: Record<string, unknown>) {
    try {
      await api.updateAgencyWhatsAppListingsEntitlement(id, data)
      addToast({ title: 'Entitlement updated' })
      load()
    } catch (err: any) {
      addToast({ title: 'Error', description: err.message || 'Failed to update entitlement', variant: 'error' })
    }
  }

  if (loading) return <div className="p-6">Loading...</div>

  const byAgent = usage?.by_agent || {}
  const chartData = Object.entries(byAgent).map(([agentId, data]: [string, any]) => ({
    label: agentId.slice(0, 8),
    value: data.drafts || 0,
  }))

  return (
    <div className="container mx-auto space-y-6 p-6">
      <h1 className="text-2xl font-bold">Agency WhatsApp Listings</h1>
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        <CreditBalance balance={credits?.credits_remaining || 0} reserved={credits?.credits_reserved || 0} />
        <Card>
          <CardHeader><CardTitle className="text-lg">Total drafts</CardTitle></CardHeader>
          <CardContent><p className="text-3xl font-bold">{usage?.total_drafts || 0}</p></CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader><CardTitle>Pool credit top-up</CardTitle></CardHeader>
        <CardContent className="flex gap-2">
          <Label className="sr-only" htmlFor="topup">Amount USD</Label>
          <Input id="topup" type="number" value={topUpAmount} onChange={(e) => setTopUpAmount(e.target.value)} />
          <Button onClick={handleTopUp}>Top up</Button>
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle>Allocate to agent</CardTitle></CardHeader>
        <CardContent className="flex gap-2">
          <Label className="sr-only" htmlFor="agent">Agent ID</Label>
          <Input id="agent" placeholder="Agent ID" value={allocate.agent_id} onChange={(e) => setAllocate({ ...allocate, agent_id: e.target.value })} />
          <Label className="sr-only" htmlFor="amount">Amount</Label>
          <Input id="amount" type="number" placeholder="Amount" value={allocate.amount} onChange={(e) => setAllocate({ ...allocate, amount: e.target.value })} />
          <Button onClick={handleAllocate}>Allocate</Button>
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle>Usage by agent</CardTitle></CardHeader>
        <CardContent><UsageChart data={chartData} title="Drafts" /></CardContent>
      </Card>

      <div className="flex items-center justify-between">
        <h2 className="text-xl font-semibold">Agent entitlements</h2>
        <Button onClick={() => setShowForm(!showForm)}>{showForm ? 'Cancel' : 'Add entitlement'}</Button>
      </div>
      {showForm && <EntitlementForm onSubmit={handleCreateEntitlement} onCancel={() => setShowForm(false)} />}
      <div className="space-y-4">
        {entitlements.map((e) => (
          <Card key={e.id}>
            <CardContent className="p-4">
              <p><strong>Agent:</strong> {e.scope_id}</p>
              <p><strong>Enabled:</strong> {e.enabled ? 'Yes' : 'No'}</p>
              <p><strong>Max drafts:</strong> {e.config?.max_drafts_per_month}</p>
              <p><strong>Variants:</strong> {(e.config?.thumbnail_variants || []).join(', ')}</p>
              <div className="mt-2 flex gap-2">
                <Button size="sm" onClick={() => handleUpdateEntitlement(e.id, { enabled: !e.enabled, config: e.config })}>
                  {e.enabled ? 'Disable' : 'Enable'}
                </Button>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      <h2 className="text-xl font-semibold">Transactions</h2>
      <div className="space-y-2">
        {transactions.length === 0 && <p className="text-muted-foreground">No transactions yet.</p>}
        {transactions.map((t) => (
          <div key={t.id} className="rounded border p-2 text-sm">
            <span className="font-medium">{t.type}</span> · {t.amount} credits · {new Date(t.created_at).toLocaleString()}
          </div>
        ))}
      </div>
    </div>
  )
}
