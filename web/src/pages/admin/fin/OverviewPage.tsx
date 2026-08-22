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
  const [readiness, setReadiness] = useState<Record<string, unknown> | null>(null)

  useEffect(() => {
    void api.finGet('/overview').then((body) => {
      setTiles((body.tiles || {}) as Record<string, number>)
    }).catch((err: Error) => setError(err.message))
    void api.finGet('/cutover/readiness').then((body) => {
      setReadiness(body)
    }).catch(() => setReadiness(null))
  }, [])

  const reconCodes = ['R090', 'R091', 'R092', 'R093', 'R094', 'R095'] as const
  const attestation = (readiness?.attestation || {}) as {
    last_signed_at?: string | null
    signed_by_email?: string | null
    eligible_to_sign?: boolean
  }

  return (
    <FinAdminGate title="Overview">
      {error ? <p className="text-sm text-red-600">{error}</p> : null}
      <Card className="mb-4">
        <CardHeader className="pb-2"><CardTitle className="text-sm">Cutover readiness</CardTitle></CardHeader>
        <CardContent className="text-sm">
          <div className="mb-2 flex flex-wrap gap-2">
            {reconCodes.map((code) => (
              <span key={code} className="rounded border px-2 py-1">
                {code} {String(readiness?.[code] ?? '—')}
              </span>
            ))}
          </div>
          <p>
            Attestation: {attestation.last_signed_at
              ? `signed ${String(attestation.last_signed_at)} by ${String(attestation.signed_by_email || 'unknown')}`
              : 'not signed'}
            {attestation.eligible_to_sign ? ' (eligible to sign)' : ''}
          </p>
          <p>ready_for_cutover: {String(readiness?.ready_for_cutover ?? '—')}</p>
        </CardContent>
      </Card>
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
