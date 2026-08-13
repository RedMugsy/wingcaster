import { useEffect, useState } from 'react'
import { api } from '@/api/client'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { EntitlementForm } from '@/components/whatsapp-listings/EntitlementForm'
import { UsageChart } from '@/components/whatsapp-listings/UsageChart'
import { useToast } from '@/components/ui/toast'

export function AdminWhatsAppListingsPage() {
  const { addToast } = useToast()
  const [health, setHealth] = useState<any>(null)
  const [usage, setUsage] = useState<any>(null)
  const [audit, setAudit] = useState<any[]>([])
  const [entitlements, setEntitlements] = useState<any[]>([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [showForm, setShowForm] = useState(false)

  useEffect(() => {
    load()
  }, [])

  async function load() {
    setLoading(true)
    try {
      const [healthData, usageData, auditData, entitlementsData] = await Promise.all([
        api.getWhatsAppListingsHealth(),
        api.getAdminWhatsAppListingsUsage(),
        api.getAdminWhatsAppListingsAuditLog(),
        api.getAdminWhatsAppListingsEntitlements(),
      ])
      setHealth(healthData)
      setUsage(usageData)
      setAudit(auditData.items || [])
      setEntitlements(entitlementsData)
    } catch (err: any) {
      addToast({ title: 'Error', description: err.message || 'Failed to load admin WhatsApp listings', variant: 'error' })
    } finally {
      setLoading(false)
    }
  }

  async function handleCreateEntitlement(data: Record<string, unknown>) {
    try {
      await api.createAdminWhatsAppListingsEntitlement(data)
      addToast({ title: 'Entitlement created' })
      setShowForm(false)
      load()
    } catch (err: any) {
      addToast({ title: 'Error', description: err.message || 'Failed to create entitlement', variant: 'error' })
    }
  }

  async function handleDelete(id: string) {
    try {
      await api.deleteAdminWhatsAppListingsEntitlement(id)
      addToast({ title: 'Entitlement deleted' })
      load()
    } catch (err: any) {
      addToast({ title: 'Error', description: err.message || 'Failed to delete entitlement', variant: 'error' })
    }
  }

  if (loading) return <div className="p-6">Loading...</div>

  const byAgent = usage?.by_agent || {}
  const chartData = Object.entries(byAgent).map(([agentId, data]: [string, any]) => ({
    label: agentId.slice(0, 8),
    value: data.drafts || 0,
  }))
  const filtered = entitlements.filter((e) =>
    (e.scope_id || '').includes(search) || (e.scope || '').includes(search),
  )

  return (
    <div className="container mx-auto space-y-6 p-6">
      <h1 className="text-2xl font-bold">Admin: WhatsApp Listings</h1>

      <Card>
        <CardHeader><CardTitle>Module health</CardTitle></CardHeader>
        <CardContent>
          <p><strong>AI provider:</strong> {health?.ai_provider}</p>
          <p><strong>Fallback providers:</strong> {(health?.fallback_providers || []).join(', ')}</p>
          <p><strong>Storage:</strong> {health?.storage_path}</p>
        </CardContent>
      </Card>

      <div className="grid grid-cols-1 gap-4 md:grid-cols-4">
        <Card><CardContent className="p-4"><p className="text-sm text-muted-foreground">Total drafts</p><p className="text-2xl font-bold">{usage?.total_drafts || 0}</p></CardContent></Card>
        <Card><CardContent className="p-4"><p className="text-sm text-muted-foreground">Drafts today</p><p className="text-2xl font-bold">{usage?.drafts_today || 0}</p></CardContent></Card>
        <Card><CardContent className="p-4"><p className="text-sm text-muted-foreground">AI credits consumed</p><p className="text-2xl font-bold">{usage?.ai_credits_consumed?.toFixed(2) || 0}</p></CardContent></Card>
        <Card><CardContent className="p-4"><p className="text-sm text-muted-foreground">Approval rate</p><p className="text-2xl font-bold">{usage?.approval_rate || 0}%</p></CardContent></Card>
      </div>

      <Card>
        <CardHeader><CardTitle>Drafts by agent</CardTitle></CardHeader>
        <CardContent><UsageChart data={chartData} title="Drafts" /></CardContent>
      </Card>

      <div className="flex items-center justify-between">
        <h2 className="text-xl font-semibold">Entitlements</h2>
        <Button onClick={() => setShowForm(!showForm)}>{showForm ? 'Cancel' : 'Add entitlement'}</Button>
      </div>
      {showForm && <EntitlementForm onSubmit={handleCreateEntitlement} onCancel={() => setShowForm(false)} />}
      <div>
        <Label className="sr-only" htmlFor="search">Search</Label>
        <Input id="search" placeholder="Search by scope or ID" value={search} onChange={(e) => setSearch(e.target.value)} />
      </div>
      <div className="space-y-4">
        {filtered.map((e) => (
          <Card key={e.id}>
            <CardContent className="p-4">
              <p><strong>{e.scope}:</strong> {e.scope_id}</p>
              <p><strong>Enabled:</strong> {e.enabled ? 'Yes' : 'No'}</p>
              <p><strong>Max drafts:</strong> {e.config?.max_drafts_per_month}</p>
              <p><strong>AI providers:</strong> {(e.config?.ai_providers_allowed || []).join(', ')}</p>
              <p><strong>Variants:</strong> {(e.config?.thumbnail_variants || []).join(', ')}</p>
              <Button className="mt-2" size="sm" variant="destructive" onClick={() => handleDelete(e.id)}>Delete</Button>
            </CardContent>
          </Card>
        ))}
      </div>

      <h2 className="text-xl font-semibold">Audit log</h2>
      <div className="space-y-2">
        {audit.length === 0 && <p className="text-muted-foreground">No audit entries yet.</p>}
        {audit.map((log) => (
          <div key={log.id} className="rounded border p-2 text-sm">
            <span className="font-medium">{log.type}</span> · {new Date(log.created_at).toLocaleString()} · {JSON.stringify(log.meta || {})}
          </div>
        ))}
      </div>
    </div>
  )
}
