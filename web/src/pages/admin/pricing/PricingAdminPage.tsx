import { useEffect, useState } from 'react'
import { api } from '@/api/client'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Badge } from '@/components/ui/badge'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { useToast } from '@/components/ui/toast'
import { useAuth } from '@/context/AuthContext'
import type { PricingRecalculationJob } from '@/types/marketPricing'

interface MatchConfig {
  id: string
  name: string
  config_json: MatchConfigJson
  is_default: boolean
  created_at: string
  updated_at: string
}

interface MatchConfigJson {
  same_area?: boolean
  same_property_type?: boolean
  bed_range?: number
  bath_range?: number
  area_range_percent?: number
  age_range_years?: number
  max_days_since_listed?: number
  max_comparables?: number
  radius_meters?: number
}

interface PricingSource {
  id: string
  source: string
  provider: string
  label: string
  enabled: boolean
  is_internal: boolean
  requires_disclaimer: boolean
  disclaimer?: string
  config_json: Record<string, unknown>
}

interface CurrencyRate {
  id: string
  from_currency: string
  to_currency: string
  rate: number
  source?: string
  effective_at: string
}

interface NormalizationRule {
  id: string
  rule_type: 'condition' | 'furnished' | 'view' | 'payment_method'
  value: string
  adjustment_percent: number
  description?: string
  is_active: boolean
}

interface TrendSnapshot {
  id: string
  area_id: string
  property_type: string
  year: number
  quarter: number
  median_price: number | null
  median_price_per_sqm: number | null
  properties_count: number
  change_from_prev_quarter_percent: number | null
}

interface ComparableReport {
  id: string
  comparable_id: string
  comparable_type: 'internal' | 'external'
  reason: string
  notes?: string
  status: 'pending' | 'reviewed' | 'dismissed' | 'actioned'
  created_at: string
}

interface AgentPriceReport {
  id: string
  reporter_id: string
  property_id?: string
  external_property_title?: string
  external_property_location?: string
  property_type?: string
  bedrooms?: number
  bathrooms?: number
  area_sqm?: number
  sold_price: number
  currency: string
  sold_date?: string
  status: 'pending' | 'verified' | 'rejected'
  notes?: string
  created_at: string
}

interface CsvImportLog {
  id: string
  filename: string
  rows_received: number
  rows_imported: number
  rows_failed: number
  errors: { row: number; reason: string }[]
  created_at: string
}

const DEFAULT_MATCH_CONFIG: MatchConfigJson = {
  same_area: true,
  same_property_type: true,
  bed_range: 1,
  bath_range: 1,
  area_range_percent: 20,
  age_range_years: 5,
  max_days_since_listed: 180,
  max_comparables: 20,
  radius_meters: 5000,
}

const RULE_TYPE_VALUES: Record<NormalizationRule['rule_type'], string[]> = {
  condition: ['newly_renovated', 'good', 'fair', 'needs_work', 'unknown'],
  furnished: ['fully_furnished', 'semi_furnished', 'unfurnished', 'unknown'],
  view: ['sea_view', 'mountain_view', 'city_view', 'no_view', 'unknown'],
  payment_method: ['cash', 'bankers_check', 'both', 'unspecified'],
}

export function PricingAdminPage() {
  const { addToast } = useToast()
  const { isAdmin } = useAuth()
  const [activeTab, setActiveTab] = useState('configs')

  const [configs, setConfigs] = useState<MatchConfig[]>([])
  const [sources, setSources] = useState<PricingSource[]>([])
  const [rates, setRates] = useState<CurrencyRate[]>([])
  const [rules, setRules] = useState<NormalizationRule[]>([])
  const [trends, setTrends] = useState<{ snapshots: TrendSnapshot[]; alerts: TrendSnapshot[] }>({ snapshots: [], alerts: [] })
  const [reports, setReports] = useState<ComparableReport[]>([])
  const [agentReports, setAgentReports] = useState<AgentPriceReport[]>([])
  const [csvLogs, setCsvLogs] = useState<CsvImportLog[]>([])
  const [jobs, setJobs] = useState<PricingRecalculationJob[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    if (!isAdmin) return
    loadAll()
  }, [isAdmin])

  async function loadAll() {
    setLoading(true)
    try {
      const [c, s, r, n, t, rep, apr, logs, jobRows] = await Promise.all([
        api.getAdminPricingConfigs(),
        api.getAdminPricingSources(),
        api.getAdminPricingCurrencyRates(),
        api.getAdminPricingNormalizationRules(),
        api.getAdminPricingTrends(),
        api.getAdminPricingReports(),
        api.getAdminAgentPriceReports(),
        api.getAdminPricingCsvImportLogs(),
        api.getAdminPricingRecalculationJobs(),
      ])
      setConfigs(c || [])
      setSources(s || [])
      setRates(r || [])
      setRules(n || [])
      setTrends(t || { snapshots: [], alerts: [] })
      setReports(rep || [])
      setAgentReports(apr || [])
      setCsvLogs(logs || [])
      setJobs(jobRows || [])
    } catch (err: any) {
      addToast({ title: 'Error', description: err.message || 'Failed to load pricing admin data', variant: 'error' })
    } finally {
      setLoading(false)
    }
  }

  if (!isAdmin) {
    return <div className="container py-8 text-sm text-red-500">Platform admin access required.</div>
  }

  if (loading) return <div className="p-6">Loading...</div>

  return (
    <div className="container mx-auto space-y-6 p-6">
      <h1 className="text-2xl font-bold">REB Price Index Admin</h1>

      <Tabs value={activeTab} onValueChange={setActiveTab}>
        <TabsList className="flex flex-wrap h-auto">
          <TabsTrigger value="configs">Match Configs</TabsTrigger>
          <TabsTrigger value="sources">Sources</TabsTrigger>
          <TabsTrigger value="csv">CSV Import</TabsTrigger>
          <TabsTrigger value="rates">Currency Rates</TabsTrigger>
          <TabsTrigger value="rules">Normalization Rules</TabsTrigger>
          <TabsTrigger value="trends">Trends</TabsTrigger>
          <TabsTrigger value="reports">Reports</TabsTrigger>
          <TabsTrigger value="agent-reports">Sold Price Reports</TabsTrigger>
          <TabsTrigger value="jobs">Recalculation Jobs</TabsTrigger>
        </TabsList>

        <TabsContent value="configs" className="space-y-4">
          <MatchConfigPanel configs={configs} onChange={loadAll} />
        </TabsContent>

        <TabsContent value="sources" className="space-y-4">
          <SourcesPanel sources={sources} onChange={loadAll} />
        </TabsContent>

        <TabsContent value="csv" className="space-y-4">
          <CsvImportPanel logs={csvLogs} onChange={loadAll} />
        </TabsContent>

        <TabsContent value="rates" className="space-y-4">
          <CurrencyRatesPanel rates={rates} onChange={loadAll} />
        </TabsContent>

        <TabsContent value="rules" className="space-y-4">
          <NormalizationRulesPanel rules={rules} onChange={loadAll} />
        </TabsContent>

        <TabsContent value="trends" className="space-y-4">
          <TrendsPanel trends={trends} onChange={loadAll} />
        </TabsContent>

        <TabsContent value="reports" className="space-y-4">
          <ReportsPanel reports={reports} onChange={loadAll} />
        </TabsContent>

        <TabsContent value="agent-reports" className="space-y-4">
          <AgentPriceReportsPanel reports={agentReports} onChange={loadAll} />
        </TabsContent>

        <TabsContent value="jobs" className="space-y-4">
          <RecalculationJobsPanel jobs={jobs} setJobs={setJobs} />
        </TabsContent>
      </Tabs>
    </div>
  )
}

function MatchConfigPanel({ configs, onChange }: { configs: MatchConfig[]; onChange: () => void }) {
  const { addToast } = useToast()
  const [showForm, setShowForm] = useState(false)
  const [name, setName] = useState('')
  const [cfg, setCfg] = useState<MatchConfigJson>(DEFAULT_MATCH_CONFIG)
  const [isDefault, setIsDefault] = useState(false)
  const [editingId, setEditingId] = useState<string | null>(null)

  function resetForm() {
    setName('')
    setCfg(DEFAULT_MATCH_CONFIG)
    setIsDefault(false)
    setEditingId(null)
    setShowForm(false)
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    try {
      if (editingId) {
        await api.updateAdminPricingConfig(editingId, { name, config_json: cfg, is_default: isDefault })
      } else {
        await api.createAdminPricingConfig({ name, config_json: cfg, is_default: isDefault })
      }
      resetForm()
      onChange()
      addToast({ title: editingId ? 'Config updated' : 'Config created' })
    } catch (err: any) {
      addToast({ title: 'Error', description: err.message, variant: 'error' })
    }
  }

  async function handleDelete(id: string) {
    try {
      await api.deleteAdminPricingConfig(id)
      onChange()
      addToast({ title: 'Config deleted' })
    } catch (err: any) {
      addToast({ title: 'Error', description: err.message, variant: 'error' })
    }
  }

  function updateField<K extends keyof MatchConfigJson>(key: K, value: MatchConfigJson[K]) {
    setCfg((prev) => ({ ...prev, [key]: value }))
  }

  function startEdit(config: MatchConfig) {
    setEditingId(config.id)
    setName(config.name)
    setCfg({ ...DEFAULT_MATCH_CONFIG, ...config.config_json })
    setIsDefault(config.is_default)
    setShowForm(true)
  }

  function startClone(config: MatchConfig) {
    setEditingId(null)
    setName(`${config.name} copy`)
    setCfg({ ...DEFAULT_MATCH_CONFIG, ...config.config_json })
    setIsDefault(false)
    setShowForm(true)
  }

  return (
    <>
      <div className="flex items-center justify-between">
        <h2 className="text-xl font-semibold">Comparable Match Configs</h2>
        <Button onClick={() => showForm ? resetForm() : setShowForm(true)}>{showForm ? 'Cancel' : 'Add config'}</Button>
      </div>

      {showForm && (
        <Card>
          <CardHeader><CardTitle>{editingId ? 'Edit match config' : 'New match config'}</CardTitle></CardHeader>
          <CardContent>
            <form onSubmit={handleSubmit} className="space-y-4">
              <div>
                <Label htmlFor="cfg-name">Name</Label>
                <Input id="cfg-name" value={name} onChange={(e) => setName(e.target.value)} required />
              </div>
              <div className="grid gap-4 md:grid-cols-3">
                <NumberField label="Bed range ±" value={cfg.bed_range ?? 1} onChange={(v) => updateField('bed_range', v)} />
                <NumberField label="Bath range ±" value={cfg.bath_range ?? 1} onChange={(v) => updateField('bath_range', v)} />
                <NumberField label="Area range %" value={cfg.area_range_percent ?? 20} onChange={(v) => updateField('area_range_percent', v)} />
                <NumberField label="Age range (years)" value={cfg.age_range_years ?? 5} onChange={(v) => updateField('age_range_years', v)} />
                <NumberField label="Max days since listed" value={cfg.max_days_since_listed ?? 180} onChange={(v) => updateField('max_days_since_listed', v)} />
                <NumberField label="Max comparables" value={cfg.max_comparables ?? 20} onChange={(v) => updateField('max_comparables', v)} />
                <NumberField label="Radius (meters)" value={cfg.radius_meters ?? 5000} onChange={(v) => updateField('radius_meters', v)} />
              </div>
              <div className="flex gap-4 text-sm">
                <label className="flex items-center gap-2">
                  <input type="checkbox" checked={cfg.same_area} onChange={(e) => updateField('same_area', e.target.checked)} />
                  Same area
                </label>
                <label className="flex items-center gap-2">
                  <input type="checkbox" checked={cfg.same_property_type} onChange={(e) => updateField('same_property_type', e.target.checked)} />
                  Same property type
                </label>
                <label className="flex items-center gap-2">
                  <input type="checkbox" checked={isDefault} onChange={(e) => setIsDefault(e.target.checked)} />
                  Set as default
                </label>
              </div>
              <div className="rounded-lg border bg-muted/30 p-4 text-sm">
                <p className="font-medium">Live scope preview</p>
                <p className="mt-1 text-muted-foreground">
                  Match {cfg.same_property_type ? 'the same property type' : 'all property types'} within {Number(cfg.radius_meters || 0).toLocaleString()}m,
                  {cfg.same_area ? ' constrained to the resolved area,' : ''} bedrooms ±{cfg.bed_range}, bathrooms ±{cfg.bath_range}, area ±{cfg.area_range_percent}%,
                  listed in the last {cfg.max_days_since_listed} days. Keep up to {cfg.max_comparables} weighted comparables.
                </p>
              </div>
              <Button type="submit">{editingId ? 'Save changes' : 'Save config'}</Button>
            </form>
          </CardContent>
        </Card>
      )}

      <div className="space-y-3">
        {configs.map((cfg) => (
          <Card key={cfg.id}>
            <CardContent className="p-4">
              <div className="flex items-start justify-between gap-4">
                <div>
                  <p className="font-medium">{cfg.name} {cfg.is_default && <Badge>default</Badge>}</p>
                  <p className="text-xs text-muted-foreground">
                    bed ±{cfg.config_json.bed_range} · bath ±{cfg.config_json.bath_range} · area ±{cfg.config_json.area_range_percent}% ·
                    age ±{cfg.config_json.age_range_years}y · radius {cfg.config_json.radius_meters}m · max {cfg.config_json.max_comparables}
                  </p>
                </div>
                <div className="flex flex-wrap gap-2">
                  <Button size="sm" variant="outline" onClick={() => startEdit(cfg)}>Edit</Button>
                  <Button size="sm" variant="outline" onClick={() => startClone(cfg)}>Clone</Button>
                  <Button size="sm" variant="destructive" onClick={() => handleDelete(cfg.id)}>Delete</Button>
                </div>
              </div>
            </CardContent>
          </Card>
        ))}
        {configs.length === 0 && <p className="text-muted-foreground">No match configs found.</p>}
      </div>
    </>
  )
}

function NumberField({ label, value, onChange }: { label: string; value: number; onChange: (v: number) => void }) {
  return (
    <div>
      <Label>{label}</Label>
      <Input type="number" value={value} onChange={(e) => onChange(Number(e.target.value))} />
    </div>
  )
}

function SourcesPanel({ sources, onChange }: { sources: PricingSource[]; onChange: () => void }) {
  const { addToast } = useToast()
  const [showForm, setShowForm] = useState(false)
  const [source, setSource] = useState('')
  const [label, setLabel] = useState('')
  const [provider, setProvider] = useState('olx_lebanon')

  async function toggle(sourceRow: PricingSource) {
    try {
      await api.updateAdminPricingSource(sourceRow.source, { enabled: !sourceRow.enabled })
      onChange()
      addToast({ title: `${sourceRow.label} ${sourceRow.enabled ? 'disabled' : 'enabled'}` })
    } catch (err: any) {
      addToast({ title: 'Error', description: err.message, variant: 'error' })
    }
  }

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault()
    try {
      await api.createAdminPricingSource({ source, label, provider, enabled: false, is_internal: false })
      setSource('')
      setLabel('')
      setProvider('olx_lebanon')
      setShowForm(false)
      onChange()
      addToast({ title: 'Source created' })
    } catch (err: any) {
      addToast({ title: 'Error', description: err.message, variant: 'error' })
    }
  }

  return (
    <>
      <div className="flex items-center justify-between">
        <h2 className="text-xl font-semibold">Data Sources</h2>
        <Button onClick={() => setShowForm(!showForm)}>{showForm ? 'Cancel' : 'Add source'}</Button>
      </div>

      {showForm && (
        <Card>
          <CardHeader><CardTitle>New external source</CardTitle></CardHeader>
          <CardContent>
            <form onSubmit={handleCreate} className="space-y-3">
              <div>
                <Label htmlFor="src-source">Source slug</Label>
                <Input id="src-source" value={source} onChange={(e) => setSource(e.target.value)} required placeholder="olx_lebanon" />
              </div>
              <div>
                <Label htmlFor="src-label">Label</Label>
                <Input id="src-label" value={label} onChange={(e) => setLabel(e.target.value)} required />
              </div>
              <div>
                <Label htmlFor="src-provider">Provider</Label>
                <select
                  id="src-provider"
                  className="h-10 w-full rounded-md border bg-background px-3 text-sm"
                  value={provider}
                  onChange={(e) => setProvider(e.target.value)}
                >
                  <option value="olx_lebanon">OLX Lebanon</option>
                  <option value="property_finder_lb">Property Finder Lebanon</option>
                  <option value="government_records">Government records</option>
                  <option value="ai">AI estimated</option>
                </select>
              </div>
              <Button type="submit">Save source</Button>
            </form>
          </CardContent>
        </Card>
      )}

      <div className="space-y-3">
        {sources.map((s) => (
          <Card key={s.id}>
            <CardContent className="p-4">
              <div className="flex items-center justify-between">
                <div>
                  <p className="font-medium">{s.label}</p>
                  <p className="text-xs text-muted-foreground">{s.source} · provider: {s.provider} · {s.is_internal ? 'internal' : 'external'}</p>
                </div>
                <div className="flex items-center gap-2">
                  <Badge variant={s.is_internal ? 'default' : s.requires_disclaimer ? 'secondary' : 'destructive'}>
                    {s.is_internal ? 'internal approved' : s.requires_disclaimer ? 'disclaimer required' : 'compliance review required'}
                  </Badge>
                  <Badge variant={s.enabled ? 'default' : 'secondary'}>{s.enabled ? 'enabled' : 'disabled'}</Badge>
                  <Button size="sm" variant="outline" onClick={() => toggle(s)}>
                    {s.enabled ? 'Disable' : 'Enable'}
                  </Button>
                </div>
              </div>
              {s.requires_disclaimer && s.disclaimer && (
                <p className="mt-2 text-xs text-amber-700">{s.disclaimer}</p>
              )}
              {!s.is_internal && (
                <p className="mt-2 text-xs text-muted-foreground">External provider approval, terms-of-use review, and data-processing compliance remain the Platform Admin&apos;s responsibility before enablement.</p>
              )}
            </CardContent>
          </Card>
        ))}
        {sources.length === 0 && <p className="text-muted-foreground">No sources configured.</p>}
      </div>
    </>
  )
}

function CsvImportPanel({ logs, onChange }: { logs: CsvImportLog[]; onChange: () => void }) {
  const { addToast } = useToast()
  const [csvText, setCsvText] = useState('')
  const [filename, setFilename] = useState('comparables.csv')
  const [importing, setImporting] = useState(false)

  const sampleCsv = `title,price,currency,property_type,bedrooms,bathrooms,area_sqm,condition,furnished,view_type,payment_method,location_text,latitude,longitude,source_url,external_id
Sea-view villa in Batroun,450000,USD,villa,3,3,220,good,unfurnished,sea_view,cash,Batroun,34.25,35.66,https://example.com/1,ext-1
Modern apartment in Mar Mikhael,320000,USD,apartment,2,2,120,newly_renovated,semi_furnished,city_view,cash,Mar Mikhael,33.89,35.51,https://example.com/2,ext-2`

  async function handleImport() {
    if (!csvText.trim()) return
    setImporting(true)
    try {
      const result = await api.importAdminPricingCsv(csvText, filename)
      setCsvText('')
      onChange()
      addToast({ title: `Imported ${result.imported} rows`, description: `${result.failed} failed` })
    } catch (err: any) {
      addToast({ title: 'Import failed', description: err.message, variant: 'error' })
    } finally {
      setImporting(false)
    }
  }

  return (
    <>
      <h2 className="text-xl font-semibold">CSV Import for External Comparables</h2>
      <Card>
        <CardHeader><CardTitle>Bulk import comparables</CardTitle></CardHeader>
        <CardContent className="space-y-3">
          <p className="text-sm text-muted-foreground">
            Paste CSV with columns: title, price, currency, property_type, bedrooms, bathrooms, area_sqm, condition, furnished, view_type, payment_method, location_text, latitude, longitude, source_url, external_id
          </p>
          <div>
            <Label htmlFor="csv-filename">Filename</Label>
            <Input id="csv-filename" value={filename} onChange={(e) => setFilename(e.target.value)} />
          </div>
          <textarea
            className="min-h-[200px] w-full rounded-md border bg-background p-3 text-sm font-mono"
            value={csvText}
            onChange={(e) => setCsvText(e.target.value)}
            placeholder={sampleCsv}
          />
          <div className="flex gap-2">
            <Button onClick={handleImport} disabled={importing || !csvText.trim()}>
              {importing ? 'Importing...' : 'Import CSV'}
            </Button>
            <Button variant="outline" onClick={() => setCsvText(sampleCsv)}>Load sample</Button>
          </div>
        </CardContent>
      </Card>

      <div className="space-y-2">
        {logs.map((log) => (
          <div key={log.id} className="rounded-lg border p-3 text-sm">
            <span className="font-medium">{log.filename}</span>
            <span className="ml-2 text-muted-foreground">{new Date(log.created_at).toLocaleString()}</span>
            <span className="ml-2">{log.rows_imported} imported</span>
            <span className="ml-2 text-red-600">{log.rows_failed} failed</span>
            <span className="ml-2 text-muted-foreground">{log.rows_received} total</span>
          </div>
        ))}
        {logs.length === 0 && <p className="text-muted-foreground">No CSV imports yet.</p>}
      </div>
    </>
  )
}

function CurrencyRatesPanel({ rates, onChange }: { rates: CurrencyRate[]; onChange: () => void }) {
  const { addToast } = useToast()
  const [fromCurrency, setFromCurrency] = useState('LBP')
  const [toCurrency, setToCurrency] = useState('USD')
  const [rate, setRate] = useState('90000')
  const [source, setSource] = useState('manual')

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    try {
      await api.createAdminPricingCurrencyRate({
        from_currency: fromCurrency,
        to_currency: toCurrency,
        rate: Number(rate),
        source,
      })
      setRate('')
      onChange()
      addToast({ title: 'Rate added' })
    } catch (err: any) {
      addToast({ title: 'Error', description: err.message, variant: 'error' })
    }
  }

  async function handleDelete(id: string) {
    try {
      await api.deleteAdminPricingCurrencyRate(id)
      onChange()
      addToast({ title: 'Rate deleted' })
    } catch (err: any) {
      addToast({ title: 'Error', description: err.message, variant: 'error' })
    }
  }

  async function handleRefresh() {
    try {
      const result = await api.refreshAdminPricingCurrencyRates()
      onChange()
      addToast({ title: 'Rate refreshed', description: `${result.source}: ${result.rate}` })
    } catch (err: any) {
      addToast({ title: 'Refresh failed', description: err.message, variant: 'error' })
    }
  }

  return (
    <>
      <div className="flex items-center justify-between">
        <h2 className="text-xl font-semibold">Currency Rates</h2>
        <Button variant="outline" onClick={handleRefresh}>Auto-fetch rate</Button>
      </div>
      <Card>
        <CardHeader><CardTitle>Add fresh USD / parallel market rate</CardTitle></CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit} className="grid gap-3 md:grid-cols-5 md:items-end">
            <div>
              <Label htmlFor="rate-from">From</Label>
              <Input id="rate-from" value={fromCurrency} onChange={(e) => setFromCurrency(e.target.value)} required />
            </div>
            <div>
              <Label htmlFor="rate-to">To</Label>
              <Input id="rate-to" value={toCurrency} onChange={(e) => setToCurrency(e.target.value)} required />
            </div>
            <div className="md:col-span-2">
              <Label htmlFor="rate-value">Rate (1 USD = how many LBP?)</Label>
              <Input id="rate-value" type="number" value={rate} onChange={(e) => setRate(e.target.value)} required />
            </div>
            <div>
              <Label htmlFor="rate-source">Source</Label>
              <Input id="rate-source" value={source} onChange={(e) => setSource(e.target.value)} required />
            </div>
            <Button type="submit">Add rate</Button>
          </form>
        </CardContent>
      </Card>

      <div className="space-y-2">
        {rates.map((r) => (
          <div key={r.id} className="flex items-center justify-between rounded-lg border p-3">
            <div className="text-sm">
              <span className="font-medium">{r.from_currency} → {r.to_currency}</span>
              <span className="ml-2">{Number(r.rate).toLocaleString()}</span>
              <span className="ml-2 text-xs text-muted-foreground">{r.source} · {new Date(r.effective_at).toLocaleString()}</span>
            </div>
            <Button size="sm" variant="destructive" onClick={() => handleDelete(r.id)}>Delete</Button>
          </div>
        ))}
        {rates.length === 0 && <p className="text-muted-foreground">No rates configured.</p>}
      </div>
    </>
  )
}

function NormalizationRulesPanel({ rules, onChange }: { rules: NormalizationRule[]; onChange: () => void }) {
  const { addToast } = useToast()
  const [showForm, setShowForm] = useState(false)
  const [ruleType, setRuleType] = useState<NormalizationRule['rule_type']>('condition')
  const [value, setValue] = useState('')
  const [adjustment, setAdjustment] = useState('')
  const [description, setDescription] = useState('')

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    try {
      await api.createAdminPricingNormalizationRule({
        rule_type: ruleType,
        value,
        adjustment_percent: Number(adjustment),
        description,
        is_active: true,
      })
      setValue('')
      setAdjustment('')
      setDescription('')
      setShowForm(false)
      onChange()
      addToast({ title: 'Rule created' })
    } catch (err: any) {
      addToast({ title: 'Error', description: err.message, variant: 'error' })
    }
  }

  async function handleDelete(id: string) {
    try {
      await api.deleteAdminPricingNormalizationRule(id)
      onChange()
      addToast({ title: 'Rule deleted' })
    } catch (err: any) {
      addToast({ title: 'Error', description: err.message, variant: 'error' })
    }
  }

  return (
    <>
      <div className="flex items-center justify-between">
        <h2 className="text-xl font-semibold">Normalization Rules</h2>
        <Button onClick={() => setShowForm(!showForm)}>{showForm ? 'Cancel' : 'Add rule'}</Button>
      </div>

      {showForm && (
        <Card>
          <CardHeader><CardTitle>New normalization rule</CardTitle></CardHeader>
          <CardContent>
            <form onSubmit={handleSubmit} className="grid gap-3 md:grid-cols-5 md:items-end">
              <div>
                <Label htmlFor="rule-type">Rule type</Label>
                <select
                  id="rule-type"
                  className="h-10 w-full rounded-md border bg-background px-3 text-sm"
                  value={ruleType}
                  onChange={(e) => {
                    setRuleType(e.target.value as NormalizationRule['rule_type'])
                    setValue('')
                  }}
                >
                  <option value="condition">Condition</option>
                  <option value="furnished">Furnished</option>
                  <option value="view">View</option>
                  <option value="payment_method">Payment method</option>
                </select>
              </div>
              <div>
                <Label htmlFor="rule-value">Value</Label>
                <select
                  id="rule-value"
                  className="h-10 w-full rounded-md border bg-background px-3 text-sm"
                  value={value}
                  onChange={(e) => setValue(e.target.value)}
                  required
                >
                  <option value="">Select value</option>
                  {RULE_TYPE_VALUES[ruleType].map((v) => (
                    <option key={v} value={v}>{v.replace(/_/g, ' ')}</option>
                  ))}
                </select>
              </div>
              <div>
                <Label htmlFor="rule-pct">Adjustment %</Label>
                <Input id="rule-pct" type="number" step="0.01" value={adjustment} onChange={(e) => setAdjustment(e.target.value)} required />
              </div>
              <div>
                <Label htmlFor="rule-desc">Description</Label>
                <Input id="rule-desc" value={description} onChange={(e) => setDescription(e.target.value)} />
              </div>
              <Button type="submit">Save rule</Button>
            </form>
          </CardContent>
        </Card>
      )}

      <div className="space-y-2">
        {rules.map((r) => (
          <div key={r.id} className="flex items-center justify-between rounded-lg border p-3">
            <div className="text-sm">
              <span className="font-medium capitalize">{r.rule_type.replace(/_/g, ' ')}</span>
              <span className="ml-2">{r.value.replace(/_/g, ' ')}</span>
              <span className={`ml-2 ${r.adjustment_percent >= 0 ? 'text-green-600' : 'text-red-600'}`}>
                {r.adjustment_percent > 0 ? '+' : ''}{r.adjustment_percent}%
              </span>
              {r.description && <span className="ml-2 text-xs text-muted-foreground">{r.description}</span>}
            </div>
            <Button size="sm" variant="destructive" onClick={() => handleDelete(r.id)}>Delete</Button>
          </div>
        ))}
        {rules.length === 0 && <p className="text-muted-foreground">No normalization rules configured.</p>}
      </div>
    </>
  )
}

function TrendsPanel({ trends, onChange }: { trends: { snapshots: TrendSnapshot[]; alerts: TrendSnapshot[] }; onChange: () => void }) {
  const { addToast } = useToast()

  async function runSnapshots() {
    try {
      await api.runAdminPricingTrends()
      onChange()
      addToast({ title: 'Trend snapshots updated' })
    } catch (err: any) {
      addToast({ title: 'Error', description: err.message, variant: 'error' })
    }
  }

  return (
    <>
      <div className="flex items-center justify-between">
        <h2 className="text-xl font-semibold">Price Trends</h2>
        <Button onClick={runSnapshots}>Run quarterly snapshots</Button>
      </div>

      {trends.alerts.length > 0 && (
        <Card className="border-amber-200 bg-amber-50">
          <CardHeader><CardTitle>Alerts (&gt;10% quarter-over-quarter)</CardTitle></CardHeader>
          <CardContent>
            <ul className="space-y-1 text-sm">
              {trends.alerts.map((a) => (
                <li key={a.id}>
                  {a.area_id} · {a.property_type} · Q{a.quarter} {a.year} ·
                  {a.change_from_prev_quarter_percent != null ? ` ${a.change_from_prev_quarter_percent}%` : ' N/A'}
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      )}

      <div className="space-y-2">
        {trends.snapshots.map((s) => (
          <div key={s.id} className="rounded-lg border p-3 text-sm">
            <span className="font-medium">{s.area_id}</span>
            <span className="ml-2 text-muted-foreground">{s.property_type}</span>
            <span className="ml-2">Q{s.quarter} {s.year}</span>
            <span className="ml-2">median ${s.median_price?.toLocaleString()}</span>
            {s.median_price_per_sqm != null && <span className="ml-2 text-muted-foreground">${s.median_price_per_sqm}/sqm</span>}
            <span className="ml-2 text-muted-foreground">{s.properties_count} properties</span>
            {s.change_from_prev_quarter_percent != null && (
              <span className={`ml-2 ${s.change_from_prev_quarter_percent >= 0 ? 'text-green-600' : 'text-red-600'}`}>
                {s.change_from_prev_quarter_percent > 0 ? '+' : ''}{s.change_from_prev_quarter_percent}% QoQ
              </span>
            )}
          </div>
        ))}
        {trends.snapshots.length === 0 && <p className="text-muted-foreground">No trend snapshots yet.</p>}
      </div>
    </>
  )
}

function ReportsPanel({ reports, onChange }: { reports: ComparableReport[]; onChange: () => void }) {
  const { addToast } = useToast()

  async function review(id: string, status: 'reviewed' | 'dismissed' | 'actioned') {
    try {
      await api.reviewAdminPricingReport(id, { status })
      onChange()
      addToast({ title: 'Report reviewed' })
    } catch (err: any) {
      addToast({ title: 'Error', description: err.message, variant: 'error' })
    }
  }

  return (
    <>
      <h2 className="text-xl font-semibold">Reported Comparables</h2>
      <div className="space-y-3">
        {reports.map((r) => (
          <Card key={r.id}>
            <CardContent className="p-4 text-sm">
              <div className="flex flex-wrap items-center gap-2">
                <Badge>{r.comparable_type}</Badge>
                <span className="font-medium">{r.reason}</span>
                <Badge variant={r.status === 'pending' ? 'secondary' : 'default'}>{r.status}</Badge>
              </div>
              <p className="mt-1 text-muted-foreground">Comparable: {r.comparable_id}</p>
              {r.notes && <p className="mt-1">{r.notes}</p>}
              {r.status === 'pending' && (
                <div className="mt-3 flex gap-2">
                  <Button size="sm" onClick={() => review(r.id, 'reviewed')}>Mark reviewed</Button>
                  <Button size="sm" variant="outline" onClick={() => review(r.id, 'actioned')}>Actioned</Button>
                  <Button size="sm" variant="secondary" onClick={() => review(r.id, 'dismissed')}>Dismiss</Button>
                </div>
              )}
            </CardContent>
          </Card>
        ))}
        {reports.length === 0 && <p className="text-muted-foreground">No reports.</p>}
      </div>
    </>
  )
}

function AgentPriceReportsPanel({ reports, onChange }: { reports: AgentPriceReport[]; onChange: () => void }) {
  const { addToast } = useToast()

  async function review(id: string, status: 'verified' | 'rejected') {
    try {
      await api.reviewAdminAgentPriceReport(id, { status })
      onChange()
      addToast({ title: `Report ${status}` })
    } catch (err: any) {
      addToast({ title: 'Error', description: err.message, variant: 'error' })
    }
  }

  return (
    <>
      <h2 className="text-xl font-semibold">Agent-Reported Sold Prices</h2>
      <p className="text-sm text-muted-foreground">Verified reports are included as Tier 1 comparables in the REB Price Index.</p>
      <div className="space-y-3">
        {reports.map((r) => (
          <Card key={r.id}>
            <CardContent className="p-4 text-sm">
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-medium">${Number(r.sold_price).toLocaleString()} {r.currency}</span>
                <Badge variant={r.status === 'pending' ? 'secondary' : r.status === 'verified' ? 'default' : 'destructive'}>{r.status}</Badge>
              </div>
              <p className="mt-1 text-muted-foreground">
                {r.external_property_title || r.property_id} · {r.property_type} · {r.bedrooms} beds · {r.bathrooms} baths · {r.area_sqm} sqm
              </p>
              <p className="text-muted-foreground">{r.external_property_location} · sold {r.sold_date}</p>
              {r.notes && <p className="mt-1">{r.notes}</p>}
              {r.status === 'pending' && (
                <div className="mt-3 flex gap-2">
                  <Button size="sm" onClick={() => review(r.id, 'verified')}>Verify</Button>
                  <Button size="sm" variant="secondary" onClick={() => review(r.id, 'rejected')}>Reject</Button>
                </div>
              )}
            </CardContent>
          </Card>
        ))}
        {reports.length === 0 && <p className="text-muted-foreground">No agent price reports.</p>}
      </div>
    </>
  )
}

function RecalculationJobsPanel({ jobs, setJobs }: { jobs: PricingRecalculationJob[]; setJobs: (jobs: PricingRecalculationJob[]) => void }) {
  const { addToast } = useToast()
  const [scope, setScope] = useState<'all' | 'property' | 'area'>('all')
  const [propertyId, setPropertyId] = useState('')
  const [areaId, setAreaId] = useState('')
  const [propertyType, setPropertyType] = useState('')
  const [statusFilter, setStatusFilter] = useState('')
  const [submitting, setSubmitting] = useState(false)

  async function refresh() {
    try {
      const rows = await api.getAdminPricingRecalculationJobs(statusFilter ? { status: statusFilter } : undefined)
      setJobs(rows || [])
    } catch (err: any) {
      addToast({ title: 'Job refresh failed', description: err.message, variant: 'error' })
    }
  }

  useEffect(() => {
    if (!jobs.some((job) => job.status === 'queued' || job.status === 'running')) return
    const timer = window.setInterval(() => {
      api.getAdminPricingRecalculationJobs(statusFilter ? { status: statusFilter } : undefined).then((rows) => setJobs(rows || [])).catch(() => {})
    }, 10000)
    return () => window.clearInterval(timer)
  }, [jobs, setJobs, statusFilter])

  async function createJob(event: React.FormEvent) {
    event.preventDefault()
    const payload = scope === 'property'
      ? { property_id: propertyId, force_recompute: true }
      : scope === 'area'
        ? { area_id: areaId, property_type: propertyType || undefined, force_recompute: true }
        : { all: true, property_type: propertyType || undefined, force_recompute: true }
    setSubmitting(true)
    try {
      const job = await api.createAdminPricingRecalculationJob(payload)
      addToast({ title: 'Recalculation job queued', description: `${job.total_items} listing(s) in scope.` })
      await refresh()
    } catch (err: any) {
      addToast({ title: 'Could not queue job', description: err.message, variant: 'error' })
    } finally {
      setSubmitting(false)
    }
  }

  async function cancel(id: string) {
    try { await api.cancelAdminPricingRecalculationJob(id); await refresh(); addToast({ title: 'Job cancelled' }) }
    catch (err: any) { addToast({ title: 'Cancellation failed', description: err.message, variant: 'error' }) }
  }

  async function retry(id: string) {
    try { await api.retryAdminPricingRecalculationJob(id); await refresh(); addToast({ title: 'Failed items requeued' }) }
    catch (err: any) { addToast({ title: 'Retry failed', description: err.message, variant: 'error' }) }
  }

  return (
    <>
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div><h2 className="text-xl font-semibold">Persistent Recalculation Jobs</h2><p className="text-sm text-muted-foreground">Jobs survive process restarts and are leased safely across worker instances.</p></div>
        <div className="flex gap-2">
          <select className="h-10 rounded-md border bg-background px-3 text-sm" value={statusFilter} onChange={(event) => setStatusFilter(event.target.value)} aria-label="Filter jobs by status"><option value="">All statuses</option>{['queued', 'running', 'completed', 'completed_with_errors', 'failed', 'cancelled'].map((status) => <option key={status} value={status}>{status.replace(/_/g, ' ')}</option>)}</select>
          <Button variant="outline" onClick={refresh}>Refresh</Button>
        </div>
      </div>

      <Card>
        <CardHeader><CardTitle>Queue recalculation</CardTitle></CardHeader>
        <CardContent>
          <form onSubmit={createJob} className="grid gap-3 md:grid-cols-4 md:items-end">
            <div><Label htmlFor="job-scope">Scope</Label><select id="job-scope" className="h-10 w-full rounded-md border bg-background px-3 text-sm" value={scope} onChange={(event) => setScope(event.target.value as typeof scope)}><option value="all">All active listings</option><option value="area">Area</option><option value="property">Single property</option></select></div>
            {scope === 'property' && <div className="md:col-span-2"><Label htmlFor="job-property">Property ID</Label><Input id="job-property" value={propertyId} onChange={(event) => setPropertyId(event.target.value)} required /></div>}
            {scope === 'area' && <div><Label htmlFor="job-area">Area ID</Label><Input id="job-area" value={areaId} onChange={(event) => setAreaId(event.target.value)} required /></div>}
            {scope !== 'property' && <div><Label htmlFor="job-type">Property type (optional)</Label><Input id="job-type" value={propertyType} onChange={(event) => setPropertyType(event.target.value)} placeholder="apartment" /></div>}
            <Button type="submit" disabled={submitting}>{submitting ? 'Queueing…' : 'Queue job'}</Button>
          </form>
        </CardContent>
      </Card>

      <div className="space-y-3">
        {jobs.map((job) => {
          const progress = job.total_items ? Math.round((job.processed_items / job.total_items) * 100) : (job.status === 'completed' ? 100 : 0)
          const active = job.status === 'queued' || job.status === 'running'
          return (
            <Card key={job.id}>
              <CardContent className="space-y-3 p-4">
                <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                  <div><div className="flex flex-wrap items-center gap-2"><span className="font-medium">{job.scope_type} recalculation</span><Badge variant={job.status === 'failed' ? 'destructive' : active ? 'secondary' : 'default'}>{job.status.replace(/_/g, ' ')}</Badge></div><p className="mt-1 text-xs text-muted-foreground">{job.id} · queued {new Date(job.created_at).toLocaleString()}</p><p className="text-xs text-muted-foreground">{job.scope_property_id || job.scope_area_id || 'All active listings'}{job.scope_property_type ? ` · ${job.scope_property_type}` : ''}</p></div>
                  <div className="flex gap-2">{active && <Button size="sm" variant="outline" onClick={() => cancel(job.id)}>Cancel</Button>}{(job.failed_items > 0 || job.status === 'failed' || job.status === 'completed_with_errors') && <Button size="sm" onClick={() => retry(job.id)}>Retry failed</Button>}</div>
                </div>
                <div><div className="mb-1 flex justify-between text-xs text-muted-foreground"><span>{job.processed_items}/{job.total_items} processed</span><span>{progress}%</span></div><div className="h-2 overflow-hidden rounded-full bg-muted"><div className="h-full bg-primary transition-all" style={{ width: `${progress}%` }} /></div></div>
                <div className="flex flex-wrap gap-4 text-xs"><span className="text-green-700">{job.succeeded_items} succeeded</span><span className={job.failed_items ? 'text-red-700' : 'text-muted-foreground'}>{job.failed_items} failed</span>{job.last_error && <span className="text-red-700">Last error: {job.last_error}</span>}</div>
              </CardContent>
            </Card>
          )
        })}
        {jobs.length === 0 && <p className="py-8 text-center text-muted-foreground">No recalculation jobs found.</p>}
      </div>
    </>
  )
}
