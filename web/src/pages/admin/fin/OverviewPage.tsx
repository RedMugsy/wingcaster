import { useEffect, useState } from 'react'
import { api } from '@/api/client'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { FinAdminGate } from './shell'

const KPI_ORDER = [
  'mrr_minor', 'arr_minor', 'churn_rate_bps', 'territory_mix_count', 'tier_mix_count',
  'credit_exposure_minor', 'ar_outstanding_minor', 'ar_aged_0_30_minor', 'ar_aged_31_60_minor',
  'ar_aged_61_90_minor', 'ar_aged_90_plus_minor', 'unapplied_cash_minor', 'deferred_revenue_minor',
  'recognized_revenue_mtd_minor', 'breakage_mtd_minor', 'credit_loss_mtd_minor', 'open_holds_units',
  'facility_exposure_minor', 'open_dunning_cases', 'open_recon_drift', 'pending_approvals',
  'usage_events_mtd', 'rated_usage_mtd_minor', 'contribution_margin_mtd_minor',
]

export function OverviewPage() {
  const [tiles, setTiles] = useState<Record<string, number>>({})
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    void api.finGet('/overview').then((body) => {
      setTiles((body.tiles || {}) as Record<string, number>)
    }).catch((err: Error) => setError(err.message))
  }, [])

  return (
    <FinAdminGate title="Overview">
      {error ? <p className="text-sm text-red-600">{error}</p> : null}
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {KPI_ORDER.map((key) => (
          <Card key={key}>
            <CardHeader className="pb-2"><CardTitle className="text-sm">{key}</CardTitle></CardHeader>
            <CardContent className="text-lg font-semibold">{tiles[key] ?? '—'}</CardContent>
          </Card>
        ))}
      </div>
    </FinAdminGate>
  )
}
