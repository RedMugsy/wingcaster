import { useEffect, useState } from 'react'
import { api } from '@/api/client'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { useAuth } from '@/context/AuthContext'
import { useToast } from '@/components/ui/toast'

interface Dimension {
  id: string
  name: string
  slug: string
  scoring_logic_config: any
  is_active: boolean
}

interface SourceType {
  id: string
  name: string
  slug: string
  archetype: string
  input_method: string
  is_active: boolean
}

interface AiConfig {
  id: string
  name: string
  provider: string
  model?: string
  is_active: boolean
}

interface Signal {
  id: string
  signal_type: string
  status: string
  raw_content?: string
  fetched_at?: string
}

export function AdminScoringPage() {
  const { isAdmin } = useAuth()
  const { addToast } = useToast()
  const [activeTab, setActiveTab] = useState('dimensions')
  const [dimensions, setDimensions] = useState<Dimension[]>([])
  const [sourceTypes, setSourceTypes] = useState<SourceType[]>([])
  const [aiConfigs, setAiConfigs] = useState<AiConfig[]>([])
  const [signals, setSignals] = useState<{ items: Signal[]; total: number }>({ items: [], total: 0 })
  const [usage, setUsage] = useState<any>(null)
  const [loading, setLoading] = useState(false)

  const [newDim, setNewDim] = useState({ name: '', slug: '', name_ar: '', scoring_logic_config: '{"logic":"weighted_average"}' })
  const [newSource, setNewSource] = useState({ name: '', slug: '', archetype: 'google_places', input_method: 'google_places_api' })
  const [newAi, setNewAi] = useState({ name: '', provider: 'gemini', model: '', system_prompt: '', scoring_prompt_template: '' })

  useEffect(() => {
    if (!isAdmin) return
    loadAll()
  }, [isAdmin])

  async function loadAll() {
    setLoading(true)
    try {
      const [dims, srcs, cfgs, sigs, use] = await Promise.all([
        api.listAdminDimensions() as Promise<{ items: Dimension[] }>,
        api.listAdminSourceTypes() as Promise<{ items: SourceType[] }>,
        api.listAdminAiConfigs() as Promise<{ items: AiConfig[] }>,
        api.listAdminSignals({ limit: '50' }) as Promise<{ items: Signal[]; total: number }>,
        api.getAdminGoogleUsage() as Promise<any>,
      ])
      setDimensions(dims.items)
      setSourceTypes(srcs.items)
      setAiConfigs(cfgs.items)
      setSignals(sigs)
      setUsage(use)
    } catch (err: any) {
      addToast({ title: 'Error', description: err.message || 'Failed to load scoring data', variant: 'error' })
    } finally {
      setLoading(false)
    }
  }

  async function createDimension(e: React.FormEvent) {
    e.preventDefault()
    try {
      await api.createAdminDimension({
        ...newDim,
        scoring_logic_config: JSON.parse(newDim.scoring_logic_config),
      })
      addToast({ title: 'Dimension created' })
      setNewDim({ name: '', slug: '', name_ar: '', scoring_logic_config: '{"logic":"weighted_average"}' })
      loadAll()
    } catch (err: any) {
      addToast({ title: 'Error', description: err.message, variant: 'error' })
    }
  }

  async function createSourceType(e: React.FormEvent) {
    e.preventDefault()
    try {
      await api.createAdminSourceType(newSource)
      addToast({ title: 'Source type created' })
      setNewSource({ name: '', slug: '', archetype: 'google_places', input_method: 'google_places_api' })
      loadAll()
    } catch (err: any) {
      addToast({ title: 'Error', description: err.message, variant: 'error' })
    }
  }

  async function createAiConfig(e: React.FormEvent) {
    e.preventDefault()
    try {
      await api.createAdminAiConfig(newAi)
      addToast({ title: 'AI config created' })
      setNewAi({ name: '', provider: 'gemini', model: '', system_prompt: '', scoring_prompt_template: '' })
      loadAll()
    } catch (err: any) {
      addToast({ title: 'Error', description: err.message, variant: 'error' })
    }
  }

  async function verifySignal(id: string) {
    try {
      await api.verifyAdminSignal(id)
      addToast({ title: 'Signal verified' })
      loadAll()
    } catch (err: any) {
      addToast({ title: 'Error', description: err.message, variant: 'error' })
    }
  }

  async function rejectSignal(id: string) {
    try {
      await api.rejectAdminSignal(id, 'Rejected from admin')
      addToast({ title: 'Signal rejected' })
      loadAll()
    } catch (err: any) {
      addToast({ title: 'Error', description: err.message, variant: 'error' })
    }
  }

  if (!isAdmin) {
    return <div className="container py-8 text-sm text-red-500">Platform admin access required.</div>
  }

  return (
    <div className="container mx-auto px-4 py-8">
      <h1 className="mb-4 text-2xl font-bold">Area Scoring Admin</h1>
      {loading && <p className="mb-4 text-sm text-muted-foreground">Loading...</p>}

      <Tabs value={activeTab} onValueChange={setActiveTab}>
        <TabsList>
          <TabsTrigger value="dimensions">Dimensions</TabsTrigger>
          <TabsTrigger value="sources">Source Types</TabsTrigger>
          <TabsTrigger value="ai">AI Configs</TabsTrigger>
          <TabsTrigger value="signals">Signals</TabsTrigger>
          <TabsTrigger value="usage">Google Usage</TabsTrigger>
        </TabsList>

        <TabsContent value="dimensions" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle>Dimensions</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="mb-4 max-h-96 overflow-auto">
                {dimensions.map((d) => (
                  <div key={d.id} className="flex items-center justify-between border-b py-2 text-sm">
                    <div>
                      <span className="font-medium">{d.name}</span>
                      <span className="ml-2 text-muted-foreground">{d.slug}</span>
                      <span className="ml-2 rounded bg-gray-100 px-1 text-xs">{d.scoring_logic_config?.logic}</span>
                    </div>
                    <span className="text-xs">{d.is_active ? 'Active' : 'Inactive'}</span>
                  </div>
                ))}
              </div>
              <form onSubmit={createDimension} className="space-y-2">
                <div className="grid gap-2 md:grid-cols-2">
                  <Input placeholder="Name" value={newDim.name} onChange={(e) => setNewDim({ ...newDim, name: e.target.value })} />
                  <Input placeholder="Slug" value={newDim.slug} onChange={(e) => setNewDim({ ...newDim, slug: e.target.value })} />
                  <Input placeholder="Arabic name" value={newDim.name_ar} onChange={(e) => setNewDim({ ...newDim, name_ar: e.target.value })} />
                  <Input placeholder="Scoring logic JSON" value={newDim.scoring_logic_config} onChange={(e) => setNewDim({ ...newDim, scoring_logic_config: e.target.value })} />
                </div>
                <Button type="submit" size="sm">Add Dimension</Button>
              </form>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="sources" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle>Source Types</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="mb-4 max-h-96 overflow-auto">
                {sourceTypes.map((s) => (
                  <div key={s.id} className="flex items-center justify-between border-b py-2 text-sm">
                    <div>
                      <span className="font-medium">{s.name}</span>
                      <span className="ml-2 text-muted-foreground">{s.slug}</span>
                      <span className="ml-2 rounded bg-gray-100 px-1 text-xs">{s.archetype}</span>
                    </div>
                    <span className="text-xs">{s.input_method}</span>
                  </div>
                ))}
              </div>
              <form onSubmit={createSourceType} className="space-y-2">
                <div className="grid gap-2 md:grid-cols-3">
                  <Input placeholder="Name" value={newSource.name} onChange={(e) => setNewSource({ ...newSource, name: e.target.value })} />
                  <Input placeholder="Slug" value={newSource.slug} onChange={(e) => setNewSource({ ...newSource, slug: e.target.value })} />
                  <Input placeholder="Input method" value={newSource.input_method} onChange={(e) => setNewSource({ ...newSource, input_method: e.target.value })} />
                </div>
                <Button type="submit" size="sm">Add Source Type</Button>
              </form>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="ai" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle>AI Configs</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="mb-4 max-h-96 overflow-auto">
                {aiConfigs.map((c) => (
                  <div key={c.id} className="flex items-center justify-between border-b py-2 text-sm">
                    <div>
                      <span className="font-medium">{c.name}</span>
                      <span className="ml-2 text-muted-foreground">{c.provider}</span>
                      <span className="ml-2 text-muted-foreground">{c.model}</span>
                    </div>
                    <span className="text-xs">{c.is_active ? 'Active' : 'Inactive'}</span>
                  </div>
                ))}
              </div>
              <form onSubmit={createAiConfig} className="space-y-2">
                <div className="grid gap-2 md:grid-cols-2">
                  <Input placeholder="Name" value={newAi.name} onChange={(e) => setNewAi({ ...newAi, name: e.target.value })} />
                  <Input placeholder="Provider" value={newAi.provider} onChange={(e) => setNewAi({ ...newAi, provider: e.target.value })} />
                  <Input placeholder="Model" value={newAi.model} onChange={(e) => setNewAi({ ...newAi, model: e.target.value })} />
                </div>
                <div className="grid gap-2">
                  <Label className="text-xs">System prompt</Label>
                  <textarea
                    className="min-h-[80px] w-full rounded-md border px-3 py-2 text-sm"
                    value={newAi.system_prompt}
                    onChange={(e) => setNewAi({ ...newAi, system_prompt: e.target.value })}
                  />
                  <Label className="text-xs">Scoring prompt template</Label>
                  <textarea
                    className="min-h-[80px] w-full rounded-md border px-3 py-2 text-sm"
                    value={newAi.scoring_prompt_template}
                    onChange={(e) => setNewAi({ ...newAi, scoring_prompt_template: e.target.value })}
                  />
                </div>
                <Button type="submit" size="sm">Add AI Config</Button>
              </form>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="signals" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle>Signal Review Queue</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="max-h-96 overflow-auto">
                {signals.items.map((s) => (
                  <div key={s.id} className="flex items-center justify-between border-b py-2 text-sm">
                    <div>
                      <div className="font-medium">{s.signal_type}</div>
                      <div className="text-xs text-muted-foreground">{s.status} · {s.fetched_at ? new Date(s.fetched_at).toLocaleString() : ''}</div>
                    </div>
                    <div className="flex gap-2">
                      <Button size="sm" variant="outline" onClick={() => verifySignal(s.id)}>Verify</Button>
                      <Button size="sm" variant="outline" onClick={() => rejectSignal(s.id)}>Reject</Button>
                    </div>
                  </div>
                ))}
                {signals.items.length === 0 && <p className="text-sm text-muted-foreground">No signals pending.</p>}
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="usage" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle>Google Maps Usage</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-sm">
                <div>Monthly spend: <strong>${usage?.monthly_spend_usd?.toFixed?.(4) ?? usage?.monthly_spend_usd ?? '—'}</strong></div>
                <div>Budget: <strong>${usage?.budget_usd_monthly ?? '—'}</strong></div>
                <div className="mt-2 text-muted-foreground">{usage?.items?.length ?? 0} usage records</div>
              </div>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  )
}
