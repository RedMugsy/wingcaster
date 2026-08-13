import { useEffect, useState, useCallback } from 'react'
import { Link } from 'react-router-dom'
import { Plug, Plus, Loader2, Check, X, Trash2, RefreshCw, Globe, FileJson, Rss, Database } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { useAuth } from '@/context/AuthContext'
import { api } from '@/api/client'
import { useToast } from '@/components/ui/toast'
import { usePageTitle } from '@/lib/usePageTitle'

const SYNC_TYPES = [
  { id: 'xml_feed', name: 'XML Feed Import', icon: Rss, description: 'Import listings from an XML feed URL' },
  { id: 'json_api', name: 'JSON API', icon: FileJson, description: 'Sync via REST API endpoint' },
  { id: 'database', name: 'Database Sync', icon: Database, description: 'Direct database connection' },
  { id: 'webhook', name: 'Webhook', icon: Globe, description: 'Receive real-time updates via webhook' },
]

export function IntegrationSettingsPage() {
  const { agent, loading: authLoading } = useAuth()
  const { addToast } = useToast()
  usePageTitle('Integrations')
  const [loading, setLoading] = useState(true)
  const [connections, setConnections] = useState<any[]>([])
  const [routingRules, setRoutingRules] = useState<any[]>([])
  const [showSyncForm, setShowSyncForm] = useState(false)
  const [showRouteForm, setShowRouteForm] = useState(false)
  const [syncForm, setSyncForm] = useState({ name: '', type: 'xml_feed', config: {} as Record<string, any> })
  const [routeForm, setRouteForm] = useState({ name: '', condition: '', priority: 1, assign_to: '' })
  const [creating, setCreating] = useState(false)
  const [agents, setAgents] = useState<any[]>([])
  const [syncingId, setSyncingId] = useState<string | null>(null)
  const [importJson, setImportJson] = useState(`[
  {
    "external_id": "ext-1001",
    "title": "Imported Sea-View Apt",
    "price": 425000,
    "type": "sale",
    "property_type": "apartment",
    "bedrooms": 2,
    "bathrooms": 2,
    "area": 120,
    "location": "Ain El Mreisseh, Beirut",
    "city": "Beirut",
    "neighborhood": "Ain El Mreisseh",
    "description": "Imported via Integrations JSON.",
    "photos": ["/placeholder-property.svg"]
  }
]`)
  const [importMsg, setImportMsg] = useState('')
  const [importing, setImporting] = useState(false)

  const loadAll = useCallback(() => {
    setLoading(true)
    Promise.all([
      api.getSyncConnections().catch((err: any) => { addToast({ title: 'Sync connections unavailable', description: err.message, variant: 'error' }); return [] }),
      api.getRoutingRules().catch((err: any) => { addToast({ title: 'Routing rules unavailable', description: err.message, variant: 'error' }); return [] }),
      api.getAgents().catch((err: any) => { addToast({ title: 'Agents unavailable', description: err.message, variant: 'error' }); return [] }),
    ]).then(([conns, rules, ags]) => {
      setConnections(conns)
      setRoutingRules(rules)
      setAgents(ags)
      setLoading(false)
    }).catch((err: any) => {
      setLoading(false)
      addToast({ title: 'Failed to load integrations', description: err.message || 'Could not load data', variant: 'error' })
    })
  }, [addToast])

  useEffect(() => {
    if (!agent) return
    loadAll()
  }, [agent, loadAll])

  const handleCreateSync = async () => {
    if (!syncForm.name.trim()) return
    setCreating(true)
    try {
      await api.createSyncConnection(syncForm)
      setShowSyncForm(false)
      setSyncForm({ name: '', type: 'xml_feed', config: {} })
      const conns = await api.getSyncConnections()
      setConnections(conns)
      addToast({ title: 'Sync connection created', variant: 'success' })
    } catch (e: any) {
      addToast({ title: 'Failed to create sync connection', description: e.message || 'Could not create connection', variant: 'error' })
    } finally {
      setCreating(false)
    }
  }

  const handleCreateRoute = async () => {
    if (!routeForm.name.trim() || !routeForm.assign_to) return
    setCreating(true)
    try {
      await api.createRoutingRule(routeForm)
      setShowRouteForm(false)
      setRouteForm({ name: '', condition: '', priority: 1, assign_to: '' })
      const rules = await api.getRoutingRules()
      setRoutingRules(rules)
      addToast({ title: 'Routing rule created', variant: 'success' })
    } catch (e: any) {
      addToast({ title: 'Failed to create routing rule', description: e.message || 'Could not create rule', variant: 'error' })
    } finally {
      setCreating(false)
    }
  }

  const handleDeleteSync = async (id: string) => {
    if (!confirm('Delete this connection?')) return
    try {
      await api.deleteSyncConnection(id)
      setConnections(prev => prev.filter(c => c.id !== id))
      addToast({ title: 'Sync connection deleted', variant: 'success' })
    } catch (e: any) {
      addToast({ title: 'Failed to delete connection', description: e.message || 'Could not delete connection', variant: 'error' })
    }
  }

  const handleRunSync = async (id: string) => {
    setSyncingId(id)
    try {
      const result = await api.runSyncConnection(id)
      addToast({
        title: 'Sync completed',
        description: `${result.created || 0} created, ${result.updated || 0} updated, ${result.skipped || 0} skipped`,
        variant: 'success',
      })
      loadAll()
    } catch (e: any) {
      addToast({ title: 'Sync failed', description: e.message || 'Could not run sync', variant: 'error' })
    } finally {
      setSyncingId(null)
    }
  }

  const handleImportJson = async () => {
    setImporting(true)
    setImportMsg('')
    try {
      const parsed = JSON.parse(importJson)
      const listings = Array.isArray(parsed) ? parsed : (parsed.listings || parsed.properties || [])
      const result = await api.importListings(listings, 'manual_import')
      setImportMsg(`Imported: ${result.created || 0} created, ${result.updated || 0} updated, ${result.skipped || 0} skipped`)
      addToast({ title: 'Import completed', description: `${result.created || 0} created, ${result.updated || 0} updated`, variant: 'success' })
    } catch (e: any) {
      setImportMsg(e.message || 'Import failed')
      addToast({ title: 'Import failed', description: e.message || 'Could not import listings', variant: 'error' })
    } finally {
      setImporting(false)
    }
  }

  const handleDeleteRoute = async (id: string) => {
    if (!confirm('Delete this rule?')) return
    try {
      await api.deleteRoutingRule(id)
      setRoutingRules(prev => prev.filter(r => r.id !== id))
      addToast({ title: 'Routing rule deleted', variant: 'success' })
    } catch (e: any) {
      addToast({ title: 'Failed to delete rule', description: e.message || 'Could not delete rule', variant: 'error' })
    }
  }

  if (authLoading) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    )
  }

  if (!agent) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <div className="text-center">
          <h2 className="text-2xl font-bold">Please sign in</h2>
          <Link to="/login"><Button className="mt-4">Sign In</Button></Link>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-muted/20">
      <div className="border-b bg-white px-4 py-6 sm:px-6 lg:px-8">
        <div className="mx-auto max-w-7xl">
          <h1 className="text-2xl font-bold">Integrations</h1>
          <p className="text-sm text-muted-foreground">Sync connections, lead routing, and data feeds</p>
        </div>
      </div>

      <div className="mx-auto max-w-7xl px-4 py-8 sm:px-6 lg:px-8">
        {/* Sync Connections */}
        <Card className="mb-8">
          <CardHeader>
            <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <CardTitle className="flex items-center gap-2"><Plug className="h-5 w-5" />Sync Connections</CardTitle>
                <CardDescription>Import listings from your existing website or CRM</CardDescription>
              </div>
              <Button onClick={() => setShowSyncForm(true)} className="gap-2"><Plus className="h-4 w-4" />Add Connection</Button>
            </div>
          </CardHeader>
          <CardContent>
            {connections.length === 0 ? (
              <div className="text-center py-8 text-muted-foreground">
                <Plug className="mx-auto h-12 w-12 mb-3 opacity-50" />
                <p>No sync connections yet. Add one to import listings automatically.</p>
              </div>
            ) : (
              <div className="space-y-3">
                {connections.map(conn => {
                  const typeMeta = SYNC_TYPES.find(t => t.id === conn.type) || SYNC_TYPES[0]
                  const Icon = typeMeta.icon
                  return (
                    <div key={conn.id} className="flex items-center gap-4 rounded-lg border p-4">
                      <div className="rounded-lg bg-primary/10 p-2">
                        <Icon className="h-5 w-5 text-primary" />
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="font-medium">{conn.name}</p>
                        <p className="text-xs text-muted-foreground">{typeMeta.name} &bull; {conn.status}</p>
                        {conn.last_sync && <p className="text-xs text-muted-foreground">Last sync: {new Date(conn.last_sync).toLocaleString()}</p>}
                      </div>
                      <div className="flex gap-2">
                        <Button variant="outline" size="sm" className="gap-1" onClick={() => handleRunSync(conn.id)} disabled={syncingId === conn.id}>
                          {syncingId === conn.id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
                          Sync
                        </Button>
                        <Button variant="outline" size="sm" className="text-destructive" onClick={() => handleDeleteSync(conn.id)}>
                          <Trash2 className="h-3.5 w-3.5" />
                        </Button>
                      </div>
                    </div>
                  )
                })}
              </div>
            )}
          </CardContent>
        </Card>

        <Card className="mb-8">
          <CardHeader>
            <CardTitle>Manual JSON import</CardTitle>
            <CardDescription>
              One-way import (existing system → REB). Use <code>external_id</code> to upsert on re-import.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <textarea
              rows={12}
              className="w-full rounded-md border border-input bg-background px-3 py-2 font-mono text-xs"
              value={importJson}
              onChange={(e) => setImportJson(e.target.value)}
            />
            {importMsg && <p className="text-sm text-muted-foreground">{importMsg}</p>}
            <Button onClick={handleImportJson} disabled={importing} className="gap-2">
              {importing ? <Loader2 className="h-4 w-4 animate-spin" /> : <FileJson className="h-4 w-4" />}
              Import listings
            </Button>
          </CardContent>
        </Card>

        {/* Lead Routing Rules */}
        <Card>
          <CardHeader>
            <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <CardTitle className="flex items-center gap-2"><Globe className="h-5 w-5" />Lead Routing Rules</CardTitle>
                <CardDescription>Automatically assign leads based on conditions</CardDescription>
              </div>
              <Button onClick={() => setShowRouteForm(true)} className="gap-2"><Plus className="h-4 w-4" />Add Rule</Button>
            </div>
          </CardHeader>
          <CardContent>
            {routingRules.length === 0 ? (
              <div className="text-center py-8 text-muted-foreground">
                <Globe className="mx-auto h-12 w-12 mb-3 opacity-50" />
                <p>No routing rules yet. Add rules to automatically assign leads.</p>
              </div>
            ) : (
              <div className="space-y-3">
                {routingRules.sort((a, b) => a.priority - b.priority).map(rule => {
                  const assignee = agents.find(a => a.id === rule.assign_to)
                  return (
                    <div key={rule.id} className="flex items-center gap-4 rounded-lg border p-4">
                      <div className="rounded-lg bg-primary/10 p-2 shrink-0">
                        <span className="text-sm font-bold text-primary">#{rule.priority}</span>
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="font-medium">{rule.name}</p>
                        <p className="text-xs text-muted-foreground">If: {rule.condition || 'All leads'} &rarr; Assign to: {assignee?.name || 'Unassigned'}</p>
                      </div>
                      <div className="flex gap-2">
                        <Button variant="outline" size="sm" className="text-destructive" onClick={() => handleDeleteRoute(rule.id)}>
                          <Trash2 className="h-3.5 w-3.5" />
                        </Button>
                      </div>
                    </div>
                  )
                })}
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Add Sync Modal */}
      {showSyncForm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="w-full max-w-lg rounded-xl bg-white p-6 shadow-xl">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-lg font-bold">Add Sync Connection</h3>
              <button onClick={() => setShowSyncForm(false)} className="rounded-full p-1 hover:bg-muted"><X className="h-5 w-5" /></button>
            </div>
            <div className="space-y-4">
              <div><Label>Connection Name *</Label><Input value={syncForm.name} onChange={e => setSyncForm({ ...syncForm, name: e.target.value })} placeholder="e.g., Company Website Feed" /></div>
              <div><Label>Connection Type *</Label>
                <div className="grid gap-2 mt-1">
                  {SYNC_TYPES.map(t => {
                    const Icon = t.icon
                    return (
                      <button key={t.id} onClick={() => setSyncForm({ ...syncForm, type: t.id })} className={`flex items-center gap-3 rounded-lg border p-3 text-left transition-colors ${syncForm.type === t.id ? 'border-primary bg-primary/5' : 'hover:bg-muted/50'}`}>
                        <Icon className="h-5 w-5 shrink-0" />
                        <div><p className="font-medium text-sm">{t.name}</p><p className="text-xs text-muted-foreground">{t.description}</p></div>
                      </button>
                    )
                  })}
                </div>
              </div>
              {syncForm.type === 'xml_feed' && (
                <div><Label>Feed URL</Label><Input placeholder="https://your-site.com/feed.xml" onChange={e => setSyncForm({ ...syncForm, config: { ...syncForm.config, url: e.target.value } })} /></div>
              )}
              {syncForm.type === 'json_api' && (
                <>
                  <div><Label>API Endpoint</Label><Input placeholder="https://api.your-site.com/listings" onChange={e => setSyncForm({ ...syncForm, config: { ...syncForm.config, endpoint: e.target.value } })} /></div>
                  <div><Label>API Key</Label><Input type="password" placeholder="Bearer token or API key" onChange={e => setSyncForm({ ...syncForm, config: { ...syncForm.config, api_key: e.target.value } })} /></div>
                </>
              )}
              <div className="flex gap-2 justify-end pt-2">
                <Button variant="outline" onClick={() => setShowSyncForm(false)}>Cancel</Button>
                <Button onClick={handleCreateSync} disabled={creating || !syncForm.name.trim()} className="gap-2">
                  {creating ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}Add
                </Button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Add Route Modal */}
      {showRouteForm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="w-full max-w-lg rounded-xl bg-white p-6 shadow-xl">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-lg font-bold">Add Lead Routing Rule</h3>
              <button onClick={() => setShowRouteForm(false)} className="rounded-full p-1 hover:bg-muted"><X className="h-5 w-5" /></button>
            </div>
            <div className="space-y-4">
              <div><Label>Rule Name *</Label><Input value={routeForm.name} onChange={e => setRouteForm({ ...routeForm, name: e.target.value })} placeholder="e.g., Downtown Leads to Karim" /></div>
              <div><Label>Condition</Label>
                <select value={routeForm.condition} onChange={e => setRouteForm({ ...routeForm, condition: e.target.value })} className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm h-10">
                  <option value="">All leads</option>
                  <option value="location:Beirut">Location: Beirut</option>
                  <option value="location:Jounieh">Location: Jounieh</option>
                  <option value="type:sale">Type: Sale</option>
                  <option value="type:rent">Type: Rent</option>
                  <option value="price:>1000000">Price: {'>'}$1M</option>
                  <option value="source:website">Source: Website</option>
                </select>
              </div>
              <div><Label>Priority</Label><Input type="number" min={1} value={routeForm.priority} onChange={e => setRouteForm({ ...routeForm, priority: Number(e.target.value) })} /></div>
              <div><Label>Assign To *</Label>
                <select value={routeForm.assign_to} onChange={e => setRouteForm({ ...routeForm, assign_to: e.target.value })} className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm h-10">
                  <option value="">Select agent</option>
                  {agents.map(a => <option key={a.id} value={a.id}>{a.name}</option>)}
                </select>
              </div>
              <div className="flex gap-2 justify-end pt-2">
                <Button variant="outline" onClick={() => setShowRouteForm(false)}>Cancel</Button>
                <Button onClick={handleCreateRoute} disabled={creating || !routeForm.name.trim() || !routeForm.assign_to} className="gap-2">
                  {creating ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}Add Rule
                </Button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
