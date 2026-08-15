import { useEffect, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { api } from '@/api/client'
import { useAuth } from '@/context/AuthContext'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { LaunchStatusBadge } from '@/components/commercial-pricing/LaunchStatusBadge'
import { MarketPreviewCard } from '@/components/commercial-pricing/MarketPreviewCard'
import { ConfirmDeactivateDialog } from '@/components/commercial-pricing/ConfirmDeactivateDialog'
import { TerritoryFormDialog } from './TerritoryFormDialog'
import { ZoneFormDialog } from './ZoneFormDialog'
import { CitiesTable } from './CitiesTable'
import type { Territory, Zone } from '@/types/commercialPricing'

export function TerritoryDetailPage() {
  const { id } = useParams<{ id: string }>()
  const { isAdmin } = useAuth()
  const [territory, setTerritory] = useState<Territory | null>(null)
  const [zones, setZones] = useState<Zone[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [previewZoneId, setPreviewZoneId] = useState<string | undefined>(undefined)
  const [tab, setTab] = useState<'overview' | 'zones' | 'cities'>('overview')
  const [editTerritoryOpen, setEditTerritoryOpen] = useState(false)
  const [zoneFormOpen, setZoneFormOpen] = useState(false)
  const [editingZone, setEditingZone] = useState<Zone | null>(null)
  const [deactivatingZone, setDeactivatingZone] = useState<Zone | null>(null)
  const [zoneAction, setZoneAction] = useState<{ id: string; action: string } | null>(null)

  useEffect(() => { if (isAdmin && id) void load() }, [isAdmin, id])

  async function load() {
    if (!id) return
    setLoading(true)
    setError(null)
    try {
      const { territory, zones } = await api.getAdminTerritory(id)
      setTerritory(territory)
      setZones(zones)
      setPreviewZoneId(territory.default_zone_id || zones.find((z) => z.is_default)?.id || zones[0]?.id)
    } catch (err: any) {
      setError(err?.message || 'Failed to load territory')
    } finally {
      setLoading(false)
    }
  }

  async function handleSetDefault(zone: Zone) {
    setZoneAction({ id: zone.id, action: 'default' })
    try {
      await api.updateAdminZone(zone.id, { is_default: true })
      await load()
    } catch (err: any) {
      setError(err?.message || 'Failed to set default zone')
    } finally {
      setZoneAction(null)
    }
  }

  async function handleDeactivateZone() {
    if (!deactivatingZone) return
    setZoneAction({ id: deactivatingZone.id, action: 'deactivate' })
    try {
      await api.deactivateAdminZone(deactivatingZone.id)
      setDeactivatingZone(null)
      await load()
    } catch (err: any) {
      setError(err?.message || 'Deactivation failed')
    } finally {
      setZoneAction(null)
    }
  }

  if (!isAdmin) {
    return (
      <div className="container mx-auto max-w-2xl px-4 py-8">
        <Card>
          <CardHeader><CardTitle>Platform admin required</CardTitle></CardHeader>
          <CardContent className="text-sm text-muted-foreground">
            Commercial pricing configuration is restricted to platform admins.
          </CardContent>
        </Card>
      </div>
    )
  }

  return (
    <div className="container mx-auto px-4 py-8">
      <div className="mb-4">
        <Link to="/admin/commercial-pricing/territories" className="text-sm text-muted-foreground hover:underline">
          ← Territories
        </Link>
      </div>

      {error ? <p className="mb-3 text-sm text-red-600">{error}</p> : null}
      {loading || !territory ? (
        <p className="text-sm text-muted-foreground">Loading…</p>
      ) : (
        <>
          <div className="mb-6 flex items-start justify-between gap-4">
            <div>
              <div className="flex items-center gap-3">
                <span className="font-mono text-lg font-bold uppercase">{territory.code}</span>
                <h1 className="text-2xl font-bold">{territory.name || 'Unnamed'}</h1>
                <LaunchStatusBadge status={territory.launch_status} />
                {!territory.active ? <Badge variant="secondary">Inactive</Badge> : null}
              </div>
            </div>
            <Button variant="outline" onClick={() => setEditTerritoryOpen(true)}>Edit territory</Button>
          </div>

          <div className="grid gap-6 lg:grid-cols-3">
            <div className="lg:col-span-2">
              <Tabs value={tab} onValueChange={(v) => setTab(v as typeof tab)}>
                <TabsList>
                  <TabsTrigger value="overview">Overview</TabsTrigger>
                  <TabsTrigger value="zones">Zones ({zones.length})</TabsTrigger>
                  <TabsTrigger value="cities">Cities</TabsTrigger>
                </TabsList>

                <TabsContent value="overview" className="space-y-4">
                  <Section title="Identity">
                    <Field label="Code">{territory.code}</Field>
                    <Field label="Name">{territory.name || '—'}</Field>
                    <Field label="Currency">{territory.currency || '—'}</Field>
                  </Section>
                  <Section title="Commercial">
                    <Field label="Multiplier">
                      {territory.pricing_multiplier.toFixed(2)}{' '}
                      <span className="text-xs text-muted-foreground">({Math.round(territory.pricing_multiplier * 100)}% of base)</span>
                    </Field>
                    <Field label="Launch wave">{territory.launch_wave ?? '—'}</Field>
                    <Field label="Launch status"><LaunchStatusBadge status={territory.launch_status} /></Field>
                    <Field label="VAT">{territory.vat_percent}%</Field>
                  </Section>
                  <Section title="Compliance">
                    <Field label="Data residency required">{territory.data_residency_required ? 'Yes' : 'No'}</Field>
                    <Field label="Regulator ID type">{territory.regulator_id_type || '—'}</Field>
                    <Field label="Billing mode">{territory.billing_mode}</Field>
                  </Section>
                  <Section title="Payments">
                    <Field label="Primary gateway">{territory.payment_gateway_primary || '—'}</Field>
                    <Field label="Secondary gateway">{territory.payment_gateway_secondary || '—'}</Field>
                  </Section>
                </TabsContent>

                <TabsContent value="zones">
                  <div className="mb-3 flex items-center justify-between">
                    <p className="text-sm text-muted-foreground">Click a zone row to seed the market preview.</p>
                    <Button size="sm" onClick={() => { setEditingZone(null); setZoneFormOpen(true) }}>+ New Zone</Button>
                  </div>
                  <div className="overflow-x-auto rounded-md border">
                    <table className="w-full text-sm">
                      <thead className="bg-muted/40 text-left">
                        <tr>
                          <th className="px-3 py-2 font-medium">Name</th>
                          <th className="px-3 py-2 font-medium">Code</th>
                          <th className="px-3 py-2 font-medium">Multiplier</th>
                          <th className="px-3 py-2 font-medium">Default</th>
                          <th className="px-3 py-2 font-medium">Active</th>
                          <th className="px-3 py-2 text-right font-medium">Actions</th>
                        </tr>
                      </thead>
                      <tbody>
                        {zones.length === 0 ? (
                          <tr><td colSpan={6} className="px-3 py-4 text-center text-muted-foreground">No zones yet.</td></tr>
                        ) : zones.map((zone) => (
                          <tr
                            key={zone.id}
                            className={'cursor-pointer border-t hover:bg-muted/30 ' + (previewZoneId === zone.id ? 'bg-muted/40' : '')}
                            onClick={() => setPreviewZoneId(zone.id)}
                          >
                            <td className="px-3 py-2">{zone.name}{zone.name_ar ? <span className="ml-2 text-xs text-muted-foreground" dir="rtl">{zone.name_ar}</span> : null}</td>
                            <td className="px-3 py-2 font-mono text-xs">{zone.code}</td>
                            <td className="px-3 py-2 tabular-nums">
                              {zone.pricing_multiplier.toFixed(2)}
                              <span className="ml-1 text-xs text-muted-foreground">({Math.round(zone.pricing_multiplier * 100)}%)</span>
                            </td>
                            <td className="px-3 py-2">{zone.is_default ? <Badge>Default</Badge> : null}</td>
                            <td className="px-3 py-2">{zone.active ? <Badge variant="outline">Active</Badge> : <Badge variant="secondary">Inactive</Badge>}</td>
                            <td className="px-3 py-2 text-right" onClick={(e) => e.stopPropagation()}>
                              <Button size="sm" variant="outline" onClick={() => { setEditingZone(zone); setZoneFormOpen(true) }}>Edit</Button>
                              {!zone.is_default ? (
                                <Button size="sm" variant="outline" className="ml-2" disabled={zoneAction?.id === zone.id} onClick={() => handleSetDefault(zone)}>
                                  Set default
                                </Button>
                              ) : null}
                              {zone.active ? (
                                <Button size="sm" variant="outline" className="ml-2" onClick={() => setDeactivatingZone(zone)}>Deactivate</Button>
                              ) : null}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </TabsContent>

                <TabsContent value="cities">
                  <CitiesTable territoryId={territory.id} zones={zones} />
                </TabsContent>
              </Tabs>
            </div>

            <div className="lg:col-span-1">
              <div className="sticky top-4">
                <MarketPreviewCard territoryId={territory.id} zoneId={previewZoneId} />
              </div>
            </div>
          </div>
        </>
      )}

      <TerritoryFormDialog
        open={editTerritoryOpen}
        mode="edit"
        initial={territory}
        onClose={() => setEditTerritoryOpen(false)}
        onSaved={() => { void load() }}
      />
      <ZoneFormDialog
        open={zoneFormOpen}
        mode={editingZone ? 'edit' : 'create'}
        territoryId={territory?.id || ''}
        initial={editingZone}
        onClose={() => { setZoneFormOpen(false); setEditingZone(null) }}
        onSaved={() => { void load() }}
      />
      <ConfirmDeactivateDialog
        open={Boolean(deactivatingZone)}
        title={`Deactivate ${deactivatingZone?.name}?`}
        description="Cities pointing to this zone will need to be reassigned. New signups won't resolve to this zone."
        onConfirm={handleDeactivateZone}
        onCancel={() => setDeactivatingZone(null)}
      />
    </div>
  )
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <Card>
      <CardHeader className="pb-2"><CardTitle className="text-sm">{title}</CardTitle></CardHeader>
      <CardContent className="grid grid-cols-2 gap-3 text-sm">{children}</CardContent>
    </Card>
  )
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="text-xs text-muted-foreground">{label}</div>
      <div>{children}</div>
    </div>
  )
}
