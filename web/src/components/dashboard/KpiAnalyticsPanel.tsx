import { useState } from 'react'
import { ArrowLeft, Building2, Eye, TrendingUp, MessageSquare, MapPin, Smartphone, Globe2 } from 'lucide-react'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { HorizontalBarChart } from '@/components/dashboard/HorizontalBarChart'

type Analytics = {
  overview: {
    listings: number
    active_listings: number
    total_views: number
    total_clicks: number
    total_inquiries: number
    avg_views: number
  }
  by_property: Array<{
    id: string
    title: string
    city: string
    views: number
    clicks: number
    inquiries: number
    engagement: number
  }>
  by_device: Array<{ label: string; value: number }>
  by_geography: Array<{ label: string; value: number }>
  by_channel: Array<{ label: string; value: number }>
  by_referrer: Array<{ label: string; value: number }>
  inquiries_by_status: Array<{ label: string; value: number }>
  ga_note?: string
}

type MetricKey = 'listings' | 'views' | 'avg' | 'inquiries'

export function KpiAnalyticsPanel({
  analytics,
  selectedMetric,
  onSelectMetric,
  onOpenProperty,
}: {
  analytics: Analytics | null
  selectedMetric: MetricKey | null
  onSelectMetric: (m: MetricKey | null) => void
  onOpenProperty?: (propertyId: string) => void
}) {
  const [selectedPropertyId, setSelectedPropertyId] = useState<string | null>(null)
  const [propertyDetail, setPropertyDetail] = useState<any>(null)
  const [loadingDetail, setLoadingDetail] = useState(false)

  const overview = analytics?.overview
  const cards = [
    { key: 'listings' as const, icon: Building2, label: 'Active Listings', value: overview?.active_listings ?? overview?.listings ?? 0, color: 'text-blue-500' },
    { key: 'views' as const, icon: Eye, label: 'Total Views', value: overview?.total_views ?? 0, color: 'text-green-500' },
    { key: 'avg' as const, icon: TrendingUp, label: 'Avg. Views', value: overview?.avg_views ?? 0, color: 'text-purple-500' },
    { key: 'inquiries' as const, icon: MessageSquare, label: 'Inquiries', value: overview?.total_inquiries ?? 0, color: 'text-orange-500' },
  ]

  const loadProperty = async (id: string) => {
    setSelectedPropertyId(id)
    setLoadingDetail(true)
    try {
      const { api } = await import('@/api/client')
      const detail = await api.getPropertyAnalytics(id)
      setPropertyDetail(detail)
      onOpenProperty?.(id)
    } catch {
      setPropertyDetail(null)
    } finally {
      setLoadingDetail(false)
    }
  }

  const propertyBars = (analytics?.by_property || []).map((p) => ({
    id: p.id,
    label: `${p.title}${p.city ? ` · ${p.city}` : ''}`,
    value: selectedMetric === 'inquiries' ? p.inquiries : selectedMetric === 'avg' || selectedMetric === 'views' ? p.views : p.engagement || p.views,
  }))

  return (
    <div className="mb-8 space-y-4">
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {cards.map((stat) => {
          const Icon = stat.icon
          const active = selectedMetric === stat.key
          return (
            <button
              key={stat.key}
              type="button"
              onClick={() => {
                setSelectedPropertyId(null)
                setPropertyDetail(null)
                onSelectMetric(active ? null : stat.key)
              }}
              className={`text-left transition-shadow ${active ? 'ring-2 ring-[#0F0F0F] rounded-xl' : ''}`}
            >
              <Card className={`h-full ${active ? 'border-[#0F0F0F]' : 'hover:border-foreground/30'}`}>
                <CardContent className="flex items-center gap-4 p-6">
                  <div className={`rounded-lg bg-muted p-3 ${stat.color}`}><Icon className="h-6 w-6" /></div>
                  <div>
                    <p className="text-2xl font-bold">{Number(stat.value).toLocaleString()}</p>
                    <p className="text-sm text-muted-foreground">{stat.label}</p>
                    <p className="mt-1 text-[11px] text-muted-foreground">{active ? 'Click to close' : 'Click for breakdown'}</p>
                  </div>
                </CardContent>
              </Card>
            </button>
          )
        })}
      </div>

      {selectedMetric && analytics && (
        <Card>
          <CardHeader className="pb-3">
            <div className="flex flex-wrap items-start justify-between gap-2">
              <div>
                <CardTitle className="text-lg">
                  {selectedPropertyId
                    ? 'Property traffic detail'
                    : selectedMetric === 'inquiries'
                      ? 'Inquiries by listing'
                      : selectedMetric === 'listings'
                        ? 'Engagement by listing'
                        : 'Views / clicks by listing'}
                </CardTitle>
                <CardDescription>
                  {selectedPropertyId
                    ? 'Geography, device, channel, and referral sources for this listing'
                    : 'Horizontal bars show relative volume. Click a listing for geo & device analytics.'}
                </CardDescription>
              </div>
              {selectedPropertyId ? (
                <Button
                  variant="outline"
                  size="sm"
                  className="gap-1"
                  onClick={() => {
                    setSelectedPropertyId(null)
                    setPropertyDetail(null)
                  }}
                >
                  <ArrowLeft className="h-4 w-4" /> All listings
                </Button>
              ) : (
                <Button variant="ghost" size="sm" onClick={() => onSelectMetric(null)}>Close</Button>
              )}
            </div>
          </CardHeader>
          <CardContent>
            {!selectedPropertyId && (
              <HorizontalBarChart
                items={propertyBars}
                onSelect={(item) => item.id && loadProperty(item.id)}
                emptyLabel="No listing analytics yet"
              />
            )}

            {selectedPropertyId && loadingDetail && (
              <p className="py-8 text-center text-sm text-muted-foreground">Loading property analytics…</p>
            )}

            {selectedPropertyId && propertyDetail && !loadingDetail && (
              <div className="space-y-6">
                <div>
                  <h4 className="font-semibold">{propertyDetail.property?.title}</h4>
                  <p className="text-sm text-muted-foreground">
                    {propertyDetail.property?.city || propertyDetail.property?.location}
                  </p>
                  <div className="mt-2 flex flex-wrap gap-2">
                    <Badge variant="outline">{propertyDetail.views || 0} views</Badge>
                    <Badge variant="outline">{propertyDetail.clicks || 0} clicks</Badge>
                    <Badge variant="outline">{(propertyDetail.inquiries || []).length} inquiries</Badge>
                  </div>
                </div>
                <div className="grid gap-6 lg:grid-cols-2">
                  <div>
                    <p className="mb-3 flex items-center gap-2 text-sm font-semibold"><MapPin className="h-4 w-4" /> Geography</p>
                    <HorizontalBarChart items={propertyDetail.by_geography || []} />
                  </div>
                  <div>
                    <p className="mb-3 flex items-center gap-2 text-sm font-semibold"><Smartphone className="h-4 w-4" /> Device type</p>
                    <HorizontalBarChart items={propertyDetail.by_device || []} />
                  </div>
                  <div>
                    <p className="mb-3 flex items-center gap-2 text-sm font-semibold"><Globe2 className="h-4 w-4" /> Channel</p>
                    <HorizontalBarChart items={propertyDetail.by_channel || []} />
                  </div>
                  <div>
                    <p className="mb-3 flex items-center gap-2 text-sm font-semibold"><Eye className="h-4 w-4" /> Referrer</p>
                    <HorizontalBarChart items={propertyDetail.by_referrer || []} />
                  </div>
                </div>
              </div>
            )}

            {analytics.ga_note && (
              <p className="mt-6 rounded-md border border-dashed bg-muted/40 px-3 py-2 text-xs text-muted-foreground">
                {analytics.ga_note}
              </p>
            )}
          </CardContent>
        </Card>
      )}
    </div>
  )
}
