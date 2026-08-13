import { useEffect, useState, useCallback } from 'react'
import { Link } from 'react-router-dom'
import { Globe, Plus, Loader2, Check, X, ExternalLink, Palette, Type, Image, Layout, Trash2, Edit3 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { useAuth } from '@/context/AuthContext'
import { api } from '@/api/client'
import { useToast } from '@/components/ui/toast'
import { usePageTitle } from '@/lib/usePageTitle'

export function WhiteLabelBuilderPage() {
  const { agent, loading: authLoading } = useAuth()
  const { addToast } = useToast()
  usePageTitle('White-Label Websites')
  const [loading, setLoading] = useState(true)
  const [agency, setAgency] = useState<any>(null)
  const [templates, setTemplates] = useState<any[]>([])
  const [sites, setSites] = useState<any[]>([])
  const [domains, setDomains] = useState<any[]>([])

  // Create site form
  const [showCreate, setShowCreate] = useState(false)
  const [createForm, setCreateForm] = useState({
    name: '',
    template_id: '',
    subdomain: '',
    custom_domain: '',
    brand_config: { primary_color: '#0f172a', secondary_color: '#3b82f6', font_family: 'Inter', logo_url: '' }
  })
  const [creating, setCreating] = useState(false)

  const loadAll = useCallback(() => {
    setLoading(true)
    Promise.all([
      api.getMyAgency().catch((err: any) => { addToast({ title: 'Agency unavailable', description: err.message, variant: 'error' }); return null }),
      api.getTemplates().catch((err: any) => { addToast({ title: 'Templates unavailable', description: err.message, variant: 'error' }); return [] }),
      api.getSites().catch((err: any) => { addToast({ title: 'Sites unavailable', description: err.message, variant: 'error' }); return [] }),
      api.getDomains().catch((err: any) => { addToast({ title: 'Domains unavailable', description: err.message, variant: 'error' }); return [] }),
    ]).then(([ag, tpls, st, dm]) => {
      setAgency(ag)
      setTemplates(tpls)
      setSites(st)
      setDomains(dm)
      setLoading(false)
    }).catch((err: any) => {
      setLoading(false)
      addToast({ title: 'Failed to load white-label data', description: err.message || 'Could not load data', variant: 'error' })
    })
  }, [addToast])

  useEffect(() => {
    if (!agent) return
    loadAll()
  }, [agent, loadAll])

  const handleCreateSite = async () => {
    if (!createForm.name.trim() || !createForm.template_id) return
    setCreating(true)
    try {
      await api.createSite(createForm)
      setShowCreate(false)
      setCreateForm({ name: '', template_id: '', subdomain: '', custom_domain: '', brand_config: { primary_color: '#0f172a', secondary_color: '#3b82f6', font_family: 'Inter', logo_url: '' } })
      const st = await api.getSites()
      setSites(st)
      addToast({ title: 'Site created', variant: 'success' })
    } catch (e: any) {
      addToast({ title: 'Failed to create site', description: e.message || 'Could not create site', variant: 'error' })
    } finally {
      setCreating(false)
    }
  }

  const handleDeleteSite = async (id: string) => {
    if (!confirm('Delete this site?')) return
    try {
      await api.deleteSite(id)
      setSites(prev => prev.filter(s => s.id !== id))
      addToast({ title: 'Site deleted', variant: 'success' })
    } catch (e: any) {
      addToast({ title: 'Failed to delete site', description: e.message || 'Could not delete site', variant: 'error' })
    }
  }

  const handleAddDomain = async (siteId: string) => {
    const domain = prompt('Enter custom domain (e.g., www.myagency.com):')
    if (!domain) return
    try {
      await api.createDomain({ domain, type: 'custom', site_id: siteId })
      const dm = await api.getDomains()
      setDomains(dm)
      addToast({ title: 'Domain added', description: domain, variant: 'success' })
    } catch (e: any) {
      addToast({ title: 'Failed to add domain', description: e.message || 'Could not add domain', variant: 'error' })
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

  if (!agency) {
    return (
      <div className="min-h-screen bg-muted/20 px-4 py-12 text-center">
        <Globe className="mx-auto h-16 w-16 text-primary/60" />
        <h1 className="mt-6 text-2xl font-bold">No Agency Found</h1>
        <p className="mt-2 text-muted-foreground">Create an agency first to build white-label websites.</p>
        <Link to="/agency"><Button className="mt-4">Create Agency</Button></Link>
      </div>
    )
  }

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-muted/20">
      <div className="border-b bg-white px-4 py-6 sm:px-6 lg:px-8">
        <div className="mx-auto max-w-7xl">
          <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <h1 className="text-2xl font-bold">White-Label Websites</h1>
              <p className="text-sm text-muted-foreground">Build branded websites for {agency.name}</p>
            </div>
            <Button onClick={() => setShowCreate(true)} className="gap-2"><Plus className="h-4 w-4" />New Website</Button>
          </div>
        </div>
      </div>

      <div className="mx-auto max-w-7xl px-4 py-8 sm:px-6 lg:px-8">
        {/* Sites List */}
        {sites.length > 0 && (
          <div className="mb-8 space-y-4">
            <h2 className="text-lg font-semibold">Your Websites</h2>
            {sites.map(site => {
              const template = templates.find(t => t.id === site.template_id)
              const siteDomains = domains.filter(d => d.site_id === site.id)
              const previewPath = site.subdomain ? `/site/${site.subdomain}` : `/public/agency/${agency?.id}`
              const url = site.custom_domain ? `https://${site.custom_domain}` : previewPath
              return (
                <Card key={site.id}>
                  <CardContent className="p-6">
                    <div className="flex flex-col gap-4 sm:flex-row sm:items-center justify-between">
                      <div className="flex items-center gap-4">
                        <div className="rounded-lg bg-primary/10 p-3">
                          <Globe className="h-6 w-6 text-primary" />
                        </div>
                        <div>
                          <h3 className="font-semibold">{site.name}</h3>
                          <p className="text-sm text-muted-foreground">{template?.name || 'Custom'} template</p>
                          <Link to={previewPath} className="text-sm text-primary flex items-center gap-1 mt-1">
                            Preview {url} <ExternalLink className="h-3 w-3" />
                          </Link>
                        </div>
                      </div>
                      <div className="flex gap-2">
                        <Button variant="outline" size="sm" onClick={() => handleAddDomain(site.id)}>Add Domain</Button>
                        <Button variant="outline" size="sm" className="text-destructive" onClick={() => handleDeleteSite(site.id)}>
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </div>
                    </div>
                    {siteDomains.length > 0 && (
                      <div className="mt-4 flex flex-wrap gap-2">
                        {siteDomains.map(d => (
                          <Badge key={d.id} variant="outline">{d.domain} ({d.status})</Badge>
                        ))}
                      </div>
                    )}
                    {site.brand_config && (
                      <div className="mt-4 flex items-center gap-4 text-sm">
                        <span className="flex items-center gap-1"><Palette className="h-3.5 w-3.5" />{site.brand_config.primary_color}</span>
                        <span className="flex items-center gap-1"><Type className="h-3.5 w-3.5" />{site.brand_config.font_family}</span>
                      </div>
                    )}
                  </CardContent>
                </Card>
              )
            })}
          </div>
        )}

        {/* Templates */}
        <div>
          <h2 className="text-lg font-semibold mb-4">Available Templates</h2>
          <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
            {templates.map(tpl => (
              <Card key={tpl.id} className="overflow-hidden">
                <div className="h-48 bg-muted">
                  <img src={tpl.preview_image} alt={tpl.name} className="h-full w-full object-cover" />
                </div>
                <CardContent className="p-4">
                  <h3 className="font-semibold">{tpl.name}</h3>
                  <p className="text-sm text-muted-foreground">{tpl.description}</p>
                  <div className="mt-3 flex flex-wrap gap-1">
                    {tpl.features?.split(',').map((f: string) => (
                      <Badge key={f} variant="secondary" className="text-xs">{f.trim()}</Badge>
                    ))}
                  </div>
                  <Button
                    className="mt-4 w-full gap-2"
                    onClick={() => {
                      setCreateForm({ ...createForm, template_id: tpl.id })
                      setShowCreate(true)
                    }}
                  >
                    <Plus className="h-4 w-4" />Use Template
                  </Button>
                </CardContent>
              </Card>
            ))}
          </div>
        </div>
      </div>

      {/* Create Site Modal */}
      {showCreate && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="w-full max-w-lg rounded-xl bg-white p-6 shadow-xl max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-lg font-bold">Create White-Label Site</h3>
              <button onClick={() => setShowCreate(false)} className="rounded-full p-1 hover:bg-muted"><X className="h-5 w-5" /></button>
            </div>
            <div className="space-y-4">
              <div><Label>Site Name *</Label><Input value={createForm.name} onChange={e => setCreateForm({ ...createForm, name: e.target.value })} placeholder="e.g., Haddad Properties" /></div>
              <div><Label>Template *</Label>
                <select value={createForm.template_id} onChange={e => setCreateForm({ ...createForm, template_id: e.target.value })} className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm h-10">
                  <option value="">Select template</option>
                  {templates.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
                </select>
              </div>
              <div><Label>Subdomain</Label>
                <div className="flex items-center gap-2">
                  <Input value={createForm.subdomain} onChange={e => setCreateForm({ ...createForm, subdomain: e.target.value })} placeholder="your-agency" />
                  <span className="text-sm text-muted-foreground shrink-0">.{new URL((import.meta.env.VITE_APP_URL || 'http://localhost:7100').replace(/\/$/, '') + '/').hostname}</span>
                </div>
              </div>
              <div><Label>Custom Domain (optional)</Label><Input value={createForm.custom_domain} onChange={e => setCreateForm({ ...createForm, custom_domain: e.target.value })} placeholder="www.youragency.com" /></div>

              <div className="rounded-lg bg-muted/50 p-4 space-y-3">
                <h4 className="text-sm font-semibold flex items-center gap-2"><Palette className="h-4 w-4" />Brand Configuration</h4>
                <div className="grid gap-3 sm:grid-cols-2">
                  <div><Label className="text-xs">Primary Color</Label>
                    <div className="flex items-center gap-2">
                      <input type="color" value={createForm.brand_config.primary_color} onChange={e => setCreateForm({ ...createForm, brand_config: { ...createForm.brand_config, primary_color: e.target.value } })} className="h-8 w-8 rounded border" />
                      <Input value={createForm.brand_config.primary_color} onChange={e => setCreateForm({ ...createForm, brand_config: { ...createForm.brand_config, primary_color: e.target.value } })} className="h-8 text-sm" />
                    </div>
                  </div>
                  <div><Label className="text-xs">Secondary Color</Label>
                    <div className="flex items-center gap-2">
                      <input type="color" value={createForm.brand_config.secondary_color} onChange={e => setCreateForm({ ...createForm, brand_config: { ...createForm.brand_config, secondary_color: e.target.value } })} className="h-8 w-8 rounded border" />
                      <Input value={createForm.brand_config.secondary_color} onChange={e => setCreateForm({ ...createForm, brand_config: { ...createForm.brand_config, secondary_color: e.target.value } })} className="h-8 text-sm" />
                    </div>
                  </div>
                </div>
                <div><Label className="text-xs">Font Family</Label>
                  <select value={createForm.brand_config.font_family} onChange={e => setCreateForm({ ...createForm, brand_config: { ...createForm.brand_config, font_family: e.target.value } })} className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm h-9">
                    <option value="Inter">Inter (Modern)</option>
                    <option value="Georgia">Georgia (Classic)</option>
                    <option value="Montserrat">Montserrat (Bold)</option>
                    <option value="Playfair Display">Playfair Display (Elegant)</option>
                  </select>
                </div>
                <div><Label className="text-xs">Logo URL</Label><Input value={createForm.brand_config.logo_url} onChange={e => setCreateForm({ ...createForm, brand_config: { ...createForm.brand_config, logo_url: e.target.value } })} placeholder="https://..." className="h-8 text-sm" /></div>
              </div>

              <div className="flex gap-2 justify-end pt-2">
                <Button variant="outline" onClick={() => setShowCreate(false)}>Cancel</Button>
                <Button onClick={handleCreateSite} disabled={creating || !createForm.name.trim() || !createForm.template_id} className="gap-2">
                  {creating ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}Create Site
                </Button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
