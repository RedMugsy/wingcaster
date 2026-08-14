import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  Check, Copy, Download, Edit3, ExternalLink, Layers, Loader2, Plus,
  Sparkles, Store, Trash2, Upload, User, Users, X,
} from 'lucide-react'
import { api, type SocialCardTemplate, type SocialCardAsset } from '@/api/client'
import { useToast } from '@/components/ui/toast'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import type { Property } from '@/types'

interface Props {
  property: Property
}

type TabKey = 'my' | 'agency' | 'store' | 'platform'

export function SocialCardStudio({ property }: Props) {
  const { addToast } = useToast()
  const [tab, setTab] = useState<TabKey>('platform')
  const [templates, setTemplates] = useState<SocialCardTemplate[]>([])
  const [agencyId, setAgencyId] = useState<string | null>(null)
  const [platforms, setPlatforms] = useState<Array<{ key: string; label: string; aspect: string; width: number; height: number }>>([])
  const [selectedTemplateIds, setSelectedTemplateIds] = useState<string[]>([])
  const [selectedPlatforms, setSelectedPlatforms] = useState<Set<string>>(new Set())
  const [loading, setLoading] = useState(true)
  const [rendering, setRendering] = useState(false)
  const [rendered, setRendered] = useState<SocialCardAsset[]>([])
  const [editingTemplate, setEditingTemplate] = useState<SocialCardTemplate | null>(null)
  const [importOpen, setImportOpen] = useState(false)
  const [bannerbear, setBannerbear] = useState<{ enabled: boolean } | null>(null)
  const [syncingBb, setSyncingBb] = useState(false)

  const loadAll = useCallback(async () => {
    setLoading(true)
    try {
      const [tpls, pls, cards, bb] = await Promise.all([
        api.listSocialCardTemplates('visible'),
        api.getSocialCardPlatforms(),
        api.listSocialCards(property.id),
        api.getBannerbearStatus().catch(() => ({ enabled: false })),
      ])
      setTemplates(tpls.templates)
      setAgencyId(tpls.agency_id)
      setPlatforms(pls.platforms)
      setRendered(cards.cards)
      setBannerbear({ enabled: bb.enabled })
      // Sensible default: pre-check Instagram feed + story if nothing chosen yet.
      setSelectedPlatforms((prev) => prev.size ? prev : new Set(['instagram_feed', 'instagram_story']))
    } catch (err: any) {
      addToast({ title: 'Failed to load Social Card Studio', description: err?.message, variant: 'error' })
    } finally {
      setLoading(false)
    }
  }, [property.id, addToast])

  async function handleBannerbearSync() {
    if (syncingBb) return
    setSyncingBb(true)
    try {
      const r = await api.syncBannerbearCatalog()
      addToast({ title: `Bannerbear synced (${r.synced} templates)`, variant: 'success' })
      loadAll()
    } catch (err: any) {
      addToast({ title: 'Bannerbear sync failed', description: err?.message, variant: 'error' })
    } finally {
      setSyncingBb(false)
    }
  }

  useEffect(() => { loadAll() }, [loadAll])

  const grouped = useMemo(() => {
    const g: Record<TabKey, SocialCardTemplate[]> = { my: [], agency: [], store: [], platform: [] }
    for (const t of templates) {
      if (t.owner_type === 'platform') g.platform.push(t)
      else if (t.owner_type === 'store') g.store.push(t)
      else if (t.owner_type === 'agency') g.agency.push(t)
      else if (t.owner_type === 'agent') g.my.push(t)
    }
    return g
  }, [templates])

  function toggleSelect(id: string) {
    setSelectedTemplateIds((prev) => prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id].slice(0, 3))
  }
  function togglePlatform(key: string) {
    setSelectedPlatforms((prev) => {
      const next = new Set(prev)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })
  }

  async function handleRender() {
    if (rendering || !selectedTemplateIds.length || !selectedPlatforms.size) return
    setRendering(true)
    try {
      const r = await api.renderSocialCards(property.id, {
        template_ids: selectedTemplateIds,
        platforms: Array.from(selectedPlatforms),
      })
      addToast({ title: `Rendered ${r.cards.length} card${r.cards.length === 1 ? '' : 's'}`, variant: 'success' })
      if (r.errors.length) {
        addToast({
          title: `${r.errors.length} render${r.errors.length === 1 ? '' : 's'} failed`,
          description: r.errors.map((e) => `${e.template_id}/${e.platform}: ${e.error}`).join('\n'),
          variant: 'warning',
        })
      }
      loadAll()
    } catch (err: any) {
      addToast({ title: 'Render failed', description: err?.message, variant: 'error' })
    } finally {
      setRendering(false)
    }
  }

  async function handleDuplicate(t: SocialCardTemplate) {
    try {
      const r = await api.duplicateSocialCardTemplate(t.id, { name: `${t.name} (copy)`, owner_type: 'agent' })
      addToast({ title: 'Template duplicated to your library', variant: 'success' })
      setTemplates((prev) => [r.template, ...prev])
      setTab('my')
    } catch (err: any) {
      addToast({ title: 'Duplicate failed', description: err?.message, variant: 'error' })
    }
  }

  async function handleDelete(t: SocialCardTemplate) {
    if (!window.confirm(`Delete "${t.name}"? This can't be undone.`)) return
    try {
      await api.deleteSocialCardTemplate(t.id)
      setTemplates((prev) => prev.filter((x) => x.id !== t.id))
      setSelectedTemplateIds((prev) => prev.filter((x) => x !== t.id))
      addToast({ title: 'Template deleted', variant: 'success' })
    } catch (err: any) {
      addToast({ title: 'Delete failed', description: err?.message, variant: 'error' })
    }
  }

  async function handleDeleteAsset(a: SocialCardAsset) {
    try {
      await api.deleteSocialCard(a.id)
      setRendered((prev) => prev.filter((x) => x.id !== a.id))
    } catch (err: any) {
      addToast({ title: 'Delete failed', description: err?.message, variant: 'error' })
    }
  }

  const canDelete = (t: SocialCardTemplate) => t.owner_type === 'agent' || t.owner_type === 'agency'
  const canEdit = canDelete

  if (loading) {
    return (
      <Card>
        <CardContent className="flex items-center justify-center py-8">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        </CardContent>
      </Card>
    )
  }

  return (
    <>
      <Card>
        <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-3">
          <div>
            <CardTitle className="text-lg">Social Card Studio</CardTitle>
            <p className="mt-0.5 text-xs text-muted-foreground">
              Render branded per-platform post creatives. Pick up to 3 templates, then choose the
              platforms — each combo becomes a ready-to-publish PNG.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {bannerbear && (
              bannerbear.enabled ? (
                <Button size="sm" variant="outline" className="gap-1.5" onClick={handleBannerbearSync} disabled={syncingBb}>
                  {syncingBb ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Store className="h-3.5 w-3.5" />}
                  Sync Bannerbear
                </Button>
              ) : (
                <Badge variant="outline" className="text-[10px]" title="Set BANNERBEAR_API_KEY on the backend to enable the premium template lane.">
                  Bannerbear: disabled
                </Badge>
              )
            )}
            <Button size="sm" variant="outline" className="gap-1.5" onClick={() => setImportOpen(true)}>
              <Upload className="h-3.5 w-3.5" />
              Import JSON
            </Button>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          <Tabs value={tab} onValueChange={(v) => setTab(v as TabKey)}>
            <TabsList className="flex flex-wrap">
              <TabsTrigger value="platform" className="gap-1">
                <Sparkles className="h-3.5 w-3.5" />
                Starters
                <Badge variant="outline" className="ml-1 text-[10px]">{grouped.platform.length}</Badge>
              </TabsTrigger>
              <TabsTrigger value="store" className="gap-1">
                <Store className="h-3.5 w-3.5" />
                Template Store
                <Badge variant="outline" className="ml-1 text-[10px]">{grouped.store.length}</Badge>
              </TabsTrigger>
              <TabsTrigger value="agency" className="gap-1" disabled={!agencyId}>
                <Users className="h-3.5 w-3.5" />
                Agency
                <Badge variant="outline" className="ml-1 text-[10px]">{grouped.agency.length}</Badge>
              </TabsTrigger>
              <TabsTrigger value="my" className="gap-1">
                <User className="h-3.5 w-3.5" />
                My Templates
                <Badge variant="outline" className="ml-1 text-[10px]">{grouped.my.length}</Badge>
              </TabsTrigger>
            </TabsList>

            {(['platform', 'store', 'agency', 'my'] as TabKey[]).map((k) => (
              <TabsContent key={k} value={k} className="pt-3">
                <TemplateGrid
                  templates={grouped[k]}
                  emptyMessage={k === 'my' ? 'Duplicate a Starter or Store template to make it yours.'
                    : k === 'agency' ? 'No agency templates yet.'
                    : k === 'store'   ? 'The store is still being curated.'
                    :                    'No shipped templates yet.'}
                  selectedIds={selectedTemplateIds}
                  onToggleSelect={toggleSelect}
                  onDuplicate={handleDuplicate}
                  onEdit={(t) => canEdit(t) && setEditingTemplate(t)}
                  onDelete={(t) => canDelete(t) && handleDelete(t)}
                  canEditFn={canEdit}
                  canDeleteFn={canDelete}
                />
              </TabsContent>
            ))}
          </Tabs>

          {/* Platform picker */}
          <div>
            <div className="mb-1.5 flex items-center justify-between">
              <Label className="text-xs">Publish sizes</Label>
              <div className="flex gap-1 text-[10px]">
                <button
                  type="button"
                  onClick={() => setSelectedPlatforms(new Set(platforms.map((p) => p.key)))}
                  className="text-muted-foreground hover:text-foreground"
                >
                  All
                </button>
                <span className="text-muted-foreground">·</span>
                <button
                  type="button"
                  onClick={() => setSelectedPlatforms(new Set())}
                  className="text-muted-foreground hover:text-foreground"
                >
                  None
                </button>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-1.5 sm:grid-cols-4">
              {platforms.map((p) => {
                const active = selectedPlatforms.has(p.key)
                return (
                  <button
                    key={p.key}
                    type="button"
                    onClick={() => togglePlatform(p.key)}
                    className={`flex flex-col items-start rounded-md border p-2 text-left text-xs transition-colors ${
                      active ? 'border-slate-900 bg-slate-900 text-white' : 'border-slate-200 bg-white text-slate-700 hover:bg-slate-50'
                    }`}
                  >
                    <span className="font-medium">{p.label}</span>
                    <span className={active ? 'text-white/70' : 'text-muted-foreground'}>
                      {p.width}×{p.height} · {p.aspect}
                    </span>
                  </button>
                )
              })}
            </div>
          </div>

          <div className="flex items-center justify-between rounded-md border border-dashed bg-slate-50 p-2.5">
            <div className="text-xs text-muted-foreground">
              {selectedTemplateIds.length} template{selectedTemplateIds.length === 1 ? '' : 's'} × {selectedPlatforms.size} size{selectedPlatforms.size === 1 ? '' : 's'}
              {' = '}
              <span className="font-semibold text-foreground">
                {selectedTemplateIds.length * selectedPlatforms.size} render{selectedTemplateIds.length * selectedPlatforms.size === 1 ? '' : 's'}
              </span>
            </div>
            <Button size="sm" className="gap-1.5" disabled={rendering || !selectedTemplateIds.length || !selectedPlatforms.size} onClick={handleRender}>
              {rendering ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
              Render
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* Rendered assets gallery */}
      {rendered.length > 0 && (
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-3">
            <CardTitle className="text-lg">Rendered creatives</CardTitle>
            <Badge variant="outline">{rendered.length}</Badge>
          </CardHeader>
          <CardContent>
            <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4">
              {rendered.map((a) => (
                <li key={a.id} className="group overflow-hidden rounded-md border bg-white">
                  <div className="relative aspect-square bg-slate-100">
                    <img src={a.url} alt={a.template_name} className="absolute inset-0 h-full w-full object-contain" loading="lazy" />
                    <div className="absolute inset-x-0 bottom-0 flex items-center justify-between gap-1 bg-black/50 px-2 py-1 opacity-0 transition-opacity group-hover:opacity-100">
                      <a href={a.url} target="_blank" rel="noreferrer" className="text-[10px] text-white hover:underline inline-flex items-center gap-0.5">
                        <ExternalLink className="h-3 w-3" />
                        Open
                      </a>
                      <button
                        type="button"
                        onClick={() => navigator.clipboard.writeText(window.location.origin + a.url)}
                        className="text-[10px] text-white hover:underline inline-flex items-center gap-0.5"
                      >
                        <Copy className="h-3 w-3" />
                        Copy URL
                      </button>
                      <a href={a.url} download className="text-[10px] text-white hover:underline inline-flex items-center gap-0.5">
                        <Download className="h-3 w-3" />
                        DL
                      </a>
                      <button
                        type="button"
                        onClick={() => handleDeleteAsset(a)}
                        className="text-[10px] text-rose-200 hover:underline inline-flex items-center gap-0.5"
                      >
                        <Trash2 className="h-3 w-3" />
                        Del
                      </button>
                    </div>
                  </div>
                  <div className="p-2 text-[11px]">
                    <div className="line-clamp-1 font-medium">{a.template_name}</div>
                    <div className="line-clamp-1 text-muted-foreground">{a.platform_label} · {a.dimensions.width}×{a.dimensions.height}</div>
                  </div>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      )}

      {editingTemplate && (
        <TemplateEditorModal
          template={editingTemplate}
          onClose={() => setEditingTemplate(null)}
          onSaved={(saved) => {
            setTemplates((prev) => prev.map((t) => t.id === saved.id ? saved : t))
            setEditingTemplate(null)
          }}
        />
      )}

      {importOpen && (
        <ImportTemplateModal
          onClose={() => setImportOpen(false)}
          onSaved={(saved) => {
            setTemplates((prev) => [saved, ...prev])
            setImportOpen(false)
            setTab('my')
          }}
        />
      )}
    </>
  )
}

/* -------------------------- Template Grid card list ----------------------- */

function TemplateGrid({
  templates, emptyMessage, selectedIds, onToggleSelect, onDuplicate, onEdit, onDelete, canEditFn, canDeleteFn,
}: {
  templates: SocialCardTemplate[]
  emptyMessage: string
  selectedIds: string[]
  onToggleSelect: (id: string) => void
  onDuplicate: (t: SocialCardTemplate) => void
  onEdit: (t: SocialCardTemplate) => void
  onDelete: (t: SocialCardTemplate) => void
  canEditFn: (t: SocialCardTemplate) => boolean
  canDeleteFn: (t: SocialCardTemplate) => boolean
}) {
  if (templates.length === 0) {
    return (
      <div className="rounded-md border border-dashed bg-slate-50 p-4 text-sm text-muted-foreground">
        {emptyMessage}
      </div>
    )
  }
  return (
    <ul className="grid grid-cols-1 gap-2 sm:grid-cols-2 md:grid-cols-3">
      {templates.map((t) => {
        const selected = selectedIds.includes(t.id)
        return (
          <li
            key={t.id}
            className={`relative flex flex-col rounded-lg border p-3 text-sm transition-colors ${
              selected ? 'border-slate-900 bg-slate-50 ring-2 ring-slate-900' : 'border-slate-200 bg-white hover:border-slate-300'
            }`}
          >
            <button
              type="button"
              onClick={() => onToggleSelect(t.id)}
              className="absolute inset-x-0 top-0 h-full w-full cursor-pointer"
              aria-label={`Select ${t.name}`}
            />
            <div className="relative z-10 flex items-start justify-between gap-2">
              <div>
                <div className="flex items-center gap-1">
                  <span className="font-medium">{t.name}</span>
                  {t.engine === 'bannerbear' && <Badge variant="outline" className="text-[9px]">Bannerbear</Badge>}
                </div>
                <p className="mt-0.5 line-clamp-2 text-[11px] text-muted-foreground">{t.description || ''}</p>
              </div>
              <div className="flex-shrink-0">
                {selected
                  ? <span className="inline-flex h-5 w-5 items-center justify-center rounded-full bg-slate-900 text-white"><Check className="h-3.5 w-3.5" /></span>
                  : <span className="inline-flex h-5 w-5 items-center justify-center rounded-full border border-slate-300" />}
              </div>
            </div>
            <div className="relative z-10 mt-2 flex flex-wrap items-center gap-1 text-[10px] text-muted-foreground">
              <Layers className="h-3 w-3" />
              <span>{t.__preview?.layer_count ?? t.layers.length} layers</span>
              {t.__preview?.aspect && <><span>·</span><span>{t.__preview.aspect}</span></>}
              {t.category && <><span>·</span><span>{t.category}</span></>}
            </div>
            <div className="relative z-20 mt-2 flex flex-wrap gap-1">
              <Button size="sm" variant="outline" className="h-6 gap-1 px-2 text-[10px]" onClick={() => onDuplicate(t)}>
                <Copy className="h-3 w-3" />
                Duplicate
              </Button>
              {canEditFn(t) && (
                <Button size="sm" variant="outline" className="h-6 gap-1 px-2 text-[10px]" onClick={() => onEdit(t)}>
                  <Edit3 className="h-3 w-3" />
                  Edit
                </Button>
              )}
              {canDeleteFn(t) && (
                <Button size="sm" variant="ghost" className="h-6 gap-1 px-2 text-[10px] text-rose-600" onClick={() => onDelete(t)}>
                  <Trash2 className="h-3 w-3" />
                  Delete
                </Button>
              )}
            </div>
          </li>
        )
      })}
    </ul>
  )
}

/* ---------------------- Template editor (form-based) ---------------------- */

function TemplateEditorModal({
  template, onClose, onSaved,
}: {
  template: SocialCardTemplate
  onClose: () => void
  onSaved: (t: SocialCardTemplate) => void
}) {
  const { addToast } = useToast()
  const [name, setName] = useState(template.name)
  const [description, setDescription] = useState(template.description || '')
  const [bg, setBg] = useState(String((template.background as any)?.color || '#FFFFFF'))
  const [layers, setLayers] = useState(template.layers)
  const [busy, setBusy] = useState(false)

  async function save() {
    if (busy) return
    setBusy(true)
    try {
      const r = await api.updateSocialCardTemplate(template.id, {
        ...template,
        name: name.slice(0, 60),
        description: description.slice(0, 400),
        background: { color: bg },
        layers,
      })
      addToast({ title: 'Template saved', variant: 'success' })
      onSaved(r.template)
    } catch (err: any) {
      addToast({ title: 'Save failed', description: err?.message, variant: 'error' })
    } finally {
      setBusy(false)
    }
  }

  function updateLayer(index: number, patch: Record<string, unknown>) {
    setLayers((prev) => prev.map((l, i) => i === index ? { ...l, ...patch } : l))
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div className="flex max-h-[90vh] w-full max-w-3xl flex-col rounded-lg bg-white shadow-xl">
        <div className="flex items-center justify-between border-b p-4">
          <h2 className="text-lg font-semibold">Edit template</h2>
          <button type="button" onClick={onClose} className="rounded-full p-1 hover:bg-muted">
            <X className="h-4 w-4" />
          </button>
        </div>
        <div className="flex-1 space-y-4 overflow-y-auto p-4">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div>
              <Label className="text-xs">Name</Label>
              <Input value={name} onChange={(e) => setName(e.target.value)} maxLength={60} />
            </div>
            <div>
              <Label className="text-xs">Background color</Label>
              <Input value={bg} onChange={(e) => setBg(e.target.value)} placeholder="#FFFFFF" />
            </div>
            <div className="sm:col-span-2">
              <Label className="text-xs">Description</Label>
              <Input value={description} onChange={(e) => setDescription(e.target.value)} maxLength={400} />
            </div>
          </div>

          <div>
            <h3 className="mb-1 text-sm font-semibold">Layers ({layers.length})</h3>
            <ul className="space-y-1.5">
              {layers.map((l, i) => (
                <li key={String(l.id)} className="rounded-md border bg-slate-50 p-2.5 text-xs">
                  <div className="mb-1 flex items-center justify-between">
                    <span className="font-medium">{String(l.id)} <Badge variant="outline" className="ml-1 text-[9px]">{String(l.type)}</Badge></span>
                  </div>
                  {l.type === 'text' && (
                    <div className="grid grid-cols-1 gap-1.5 sm:grid-cols-2">
                      <label className="block">
                        <span className="text-[10px] text-muted-foreground">Bind</span>
                        <Input value={String((l as any).bind || '')} onChange={(e) => updateLayer(i, { bind: e.target.value })} className="h-7 text-xs" />
                      </label>
                      <label className="block">
                        <span className="text-[10px] text-muted-foreground">Color</span>
                        <Input value={String((l as any).color || '#000')} onChange={(e) => updateLayer(i, { color: e.target.value })} className="h-7 text-xs" />
                      </label>
                      <label className="block">
                        <span className="text-[10px] text-muted-foreground">Font size</span>
                        <Input type="number" value={Number((l as any).size || 32)} onChange={(e) => updateLayer(i, { size: Number(e.target.value) })} className="h-7 text-xs" />
                      </label>
                      <label className="block">
                        <span className="text-[10px] text-muted-foreground">Weight</span>
                        <Input type="number" value={Number((l as any).weight || 400)} onChange={(e) => updateLayer(i, { weight: Number(e.target.value) })} className="h-7 text-xs" />
                      </label>
                    </div>
                  )}
                  {(l.type === 'rect' || l.type === 'badge') && (
                    <label className="block">
                      <span className="text-[10px] text-muted-foreground">Fill color</span>
                      <Input value={String((l as any).color || (l as any).bg_color || '#000')} onChange={(e) => updateLayer(i, l.type === 'badge' ? { bg_color: e.target.value } : { color: e.target.value })} className="h-7 text-xs" />
                    </label>
                  )}
                  <div className="mt-1 grid grid-cols-4 gap-1.5">
                    <label className="block">
                      <span className="text-[10px] text-muted-foreground">x</span>
                      <Input type="number" value={Number((l as any).x || 0)} onChange={(e) => updateLayer(i, { x: Number(e.target.value) })} className="h-7 text-xs" />
                    </label>
                    <label className="block">
                      <span className="text-[10px] text-muted-foreground">y</span>
                      <Input type="number" value={Number((l as any).y || 0)} onChange={(e) => updateLayer(i, { y: Number(e.target.value) })} className="h-7 text-xs" />
                    </label>
                    {(l as any).w != null && (
                      <label className="block">
                        <span className="text-[10px] text-muted-foreground">w</span>
                        <Input type="number" value={Number((l as any).w || 0)} onChange={(e) => updateLayer(i, { w: Number(e.target.value) })} className="h-7 text-xs" />
                      </label>
                    )}
                    {(l as any).h != null && (
                      <label className="block">
                        <span className="text-[10px] text-muted-foreground">h</span>
                        <Input type="number" value={Number((l as any).h || 0)} onChange={(e) => updateLayer(i, { h: Number(e.target.value) })} className="h-7 text-xs" />
                      </label>
                    )}
                  </div>
                </li>
              ))}
            </ul>
            <p className="mt-1 text-[10px] text-muted-foreground">
              Form editor covers colors, fonts, bindings, and positions. Advanced layer types + drag-drop
              canvas designer arrive in a later phase.
            </p>
          </div>
        </div>
        <div className="flex justify-end gap-2 border-t p-3">
          <Button variant="outline" onClick={onClose} disabled={busy}>Cancel</Button>
          <Button onClick={save} disabled={busy} className="gap-1.5">
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}
            Save
          </Button>
        </div>
      </div>
    </div>
  )
}

/* --------------------------- BYO import modal ---------------------------- */

function ImportTemplateModal({
  onClose, onSaved,
}: {
  onClose: () => void
  onSaved: (t: SocialCardTemplate) => void
}) {
  const { addToast } = useToast()
  const [json, setJson] = useState('')
  const [busy, setBusy] = useState(false)

  async function save() {
    if (busy) return
    let parsed
    try {
      parsed = JSON.parse(json)
    } catch (err: any) {
      addToast({ title: 'Invalid JSON', description: err?.message, variant: 'error' })
      return
    }
    setBusy(true)
    try {
      const r = await api.createSocialCardTemplate(parsed, 'agent')
      addToast({ title: 'Template imported to your library', variant: 'success' })
      onSaved(r.template)
    } catch (err: any) {
      addToast({ title: 'Import failed', description: err?.message, variant: 'error' })
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div className="flex max-h-[90vh] w-full max-w-2xl flex-col rounded-lg bg-white shadow-xl">
        <div className="flex items-center justify-between border-b p-4">
          <h2 className="text-lg font-semibold">Import template JSON</h2>
          <button type="button" onClick={onClose} className="rounded-full p-1 hover:bg-muted">
            <X className="h-4 w-4" />
          </button>
        </div>
        <div className="flex-1 space-y-3 overflow-y-auto p-4">
          <p className="text-xs text-muted-foreground">
            Paste a template JSON conforming to the schema (name, base_canvas, layers, optional
            platform_overrides). It lands in your personal library — duplicate and edit further from there.
          </p>
          <textarea
            value={json}
            onChange={(e) => setJson(e.target.value)}
            rows={18}
            placeholder='{ "name": "My template", "base_canvas": { "width": 1080, "height": 1080 }, "layers": [...] }'
            className="w-full rounded-md border border-input bg-background px-3 py-2 font-mono text-xs"
          />
        </div>
        <div className="flex justify-end gap-2 border-t p-3">
          <Button variant="outline" onClick={onClose} disabled={busy}>Cancel</Button>
          <Button onClick={save} disabled={busy || !json.trim()} className="gap-1.5">
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
            Import
          </Button>
        </div>
      </div>
    </div>
  )
}
