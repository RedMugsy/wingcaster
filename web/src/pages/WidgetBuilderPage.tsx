import { useEffect, useState, useCallback } from 'react'
import { Link } from 'react-router-dom'
import { Code, Plus, Loader2, Check, X, Copy, Trash2, LayoutGrid, Search, MessageSquare, Calculator } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { useAuth } from '@/context/AuthContext'
import { API_BASE, api } from '@/api/client'
import { useToast } from '@/components/ui/toast'
import { usePageTitle } from '@/lib/usePageTitle'

const WIDGET_TYPES: Record<string, { name: string; icon: any; description: string; defaults: Record<string, any> }> = {
  'listing-gallery': { name: 'Listing Gallery', icon: LayoutGrid, description: 'Display property listings in a grid', defaults: { theme: 'light', limit: 6 } },
  'search-bar': { name: 'Search Bar', icon: Search, description: 'Embeddable property search', defaults: { placeholder: 'Search properties...' } },
  'contact-form': { name: 'Contact Form', icon: MessageSquare, description: 'Lead capture form', defaults: { agency_name: '' } },
  'mortgage-calculator': { name: 'Mortgage Calculator', icon: Calculator, description: 'Interactive mortgage calculator', defaults: { currency: 'USD' } },
}

export function WidgetBuilderPage() {
  const { agent, loading: authLoading } = useAuth()
  const { addToast } = useToast()
  usePageTitle('Widget Builder')
  const [widgets, setWidgets] = useState<any[]>([])
  const [loading, setLoading] = useState(true)
  const [showCreate, setShowCreate] = useState(false)
  const [createForm, setCreateForm] = useState({ name: '', type: 'listing-gallery', config: {} as Record<string, any>, site_id: '' })
  const [creating, setCreating] = useState(false)
  const [copiedId, setCopiedId] = useState<string | null>(null)
  const [sites, setSites] = useState<any[]>([])

  const loadAll = useCallback(() => {
    setLoading(true)
    Promise.all([
      api.getWidgets().catch((err: any) => { addToast({ title: 'Widgets unavailable', description: err.message, variant: 'error' }); return [] }),
      api.getSites().catch((err: any) => { addToast({ title: 'Sites unavailable', description: err.message, variant: 'error' }); return [] }),
    ]).then(([w, s]) => {
      setWidgets(w)
      setSites(s)
      setLoading(false)
    }).catch((err: any) => {
      setLoading(false)
      addToast({ title: 'Failed to load widgets', description: err.message || 'Could not load data', variant: 'error' })
    })
  }, [addToast])

  useEffect(() => {
    if (!agent) return
    loadAll()
  }, [agent, loadAll])

  const handleCreate = async () => {
    if (!createForm.name.trim()) return
    setCreating(true)
    try {
      const typeMeta = WIDGET_TYPES[createForm.type]
      const config = { ...typeMeta.defaults, ...createForm.config }
      await api.createWidget({ name: createForm.name, type: createForm.type, config, site_id: createForm.site_id || undefined })
      setShowCreate(false)
      setCreateForm({ name: '', type: 'listing-gallery', config: {}, site_id: '' })
      const w = await api.getWidgets()
      setWidgets(w)
      addToast({ title: 'Widget created', variant: 'success' })
    } catch (e: any) {
      addToast({ title: 'Failed to create widget', description: e.message || 'Could not create widget', variant: 'error' })
    } finally {
      setCreating(false)
    }
  }

  const handleDelete = async (id: string) => {
    if (!confirm('Delete this widget?')) return
    try {
      await api.deleteWidget(id)
      setWidgets(prev => prev.filter(w => w.id !== id))
      addToast({ title: 'Widget deleted', variant: 'success' })
    } catch (e: any) {
      addToast({ title: 'Failed to delete widget', description: e.message || 'Could not delete widget', variant: 'error' })
    }
  }

  const copyEmbed = (widget: any) => {
    const code = widget.embed_code || `<script src="${API_BASE}/public/widgets/${widget.id}.js"></script>`
    navigator.clipboard.writeText(code)
      .then(() => {
        setCopiedId(widget.id)
        addToast({ title: 'Embed code copied', variant: 'success' })
        setTimeout(() => setCopiedId(null), 2000)
      })
      .catch((e: any) => {
        addToast({ title: 'Copy failed', description: e.message || 'Could not copy to clipboard', variant: 'error' })
      })
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
          <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <h1 className="text-2xl font-bold">Widget Builder</h1>
              <p className="text-sm text-muted-foreground">Create embeddable widgets for your existing website</p>
            </div>
            <Button onClick={() => setShowCreate(true)} className="gap-2"><Plus className="h-4 w-4" />New Widget</Button>
          </div>
        </div>
      </div>

      <div className="mx-auto max-w-7xl px-4 py-8 sm:px-6 lg:px-8">
        {loading ? (
          <div className="flex justify-center py-12"><Loader2 className="h-8 w-8 animate-spin text-primary" /></div>
        ) : widgets.length === 0 ? (
          <div className="text-center py-12">
            <Code className="mx-auto h-16 w-16 text-primary/60" />
            <h2 className="mt-4 text-xl font-semibold">No widgets yet</h2>
            <p className="text-muted-foreground">Create your first embeddable widget</p>
            <Button className="mt-4" onClick={() => setShowCreate(true)}>Create Widget</Button>
          </div>
        ) : (
          <div className="grid gap-4">
            {widgets.map(widget => {
              const meta = WIDGET_TYPES[widget.type] || WIDGET_TYPES['listing-gallery']
              const Icon = meta.icon
              return (
                <Card key={widget.id}>
                  <CardContent className="p-6">
                    <div className="flex flex-col gap-4 sm:flex-row sm:items-center justify-between">
                      <div className="flex items-center gap-4">
                        <div className="rounded-lg bg-primary/10 p-3">
                          <Icon className="h-6 w-6 text-primary" />
                        </div>
                        <div>
                          <h3 className="font-semibold">{widget.name}</h3>
                          <p className="text-sm text-muted-foreground">{meta.name} widget</p>
                        </div>
                      </div>
                      <div className="flex gap-2">
                        <Button variant="outline" size="sm" className="gap-1" onClick={() => copyEmbed(widget)}>
                          {copiedId === widget.id ? <Check className="h-4 w-4 text-green-600" /> : <Copy className="h-4 w-4" />}
                          {copiedId === widget.id ? 'Copied!' : 'Copy Code'}
                        </Button>
                        <Button variant="outline" size="sm" className="text-destructive" onClick={() => handleDelete(widget.id)}>
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </div>
                    </div>
                    <div className="mt-4 rounded-lg bg-muted p-3">
                      <code className="text-xs break-all">{widget.embed_code || `<script src="${API_BASE}/public/widgets/${widget.id}.js"></script>`}</code>
                    </div>
                  </CardContent>
                </Card>
              )
            })}
          </div>
        )}
      </div>

      {/* Create Widget Modal */}
      {showCreate && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="w-full max-w-lg rounded-xl bg-white p-6 shadow-xl max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-lg font-bold">Create Widget</h3>
              <button onClick={() => setShowCreate(false)} className="rounded-full p-1 hover:bg-muted"><X className="h-5 w-5" /></button>
            </div>
            <div className="space-y-4">
              <div><Label>Widget Name *</Label><Input value={createForm.name} onChange={e => setCreateForm({ ...createForm, name: e.target.value })} placeholder="e.g., Homepage Listings" /></div>
              <div><Label>Widget Type *</Label>
                <div className="grid gap-2 sm:grid-cols-2 mt-1">
                  {Object.entries(WIDGET_TYPES).map(([key, meta]) => {
                    const Icon = meta.icon
                    return (
                      <button
                        type="button"
                        key={key}
                        onClick={() => setCreateForm({ ...createForm, type: key, config: meta.defaults })}
                        className={`flex items-center gap-3 rounded-lg border p-3 text-left transition-colors ${createForm.type === key ? 'border-primary bg-primary/5' : 'hover:bg-muted/50'}`}
                      >
                        <Icon className="h-5 w-5 shrink-0" />
                        <div>
                          <p className="font-medium text-sm">{meta.name}</p>
                          <p className="text-xs text-muted-foreground">{meta.description}</p>
                        </div>
                      </button>
                    )
                  })}
                </div>
              </div>
              <div><Label>Associated Site (optional)</Label>
                <select value={createForm.site_id} onChange={e => setCreateForm({ ...createForm, site_id: e.target.value })} className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm h-10">
                  <option value="">None</option>
                  {sites.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
                </select>
              </div>
              <div className="flex gap-2 justify-end pt-2">
                <Button variant="outline" onClick={() => setShowCreate(false)}>Cancel</Button>
                <Button onClick={handleCreate} disabled={creating || !createForm.name.trim()} className="gap-2">
                  {creating ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}Create
                </Button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
