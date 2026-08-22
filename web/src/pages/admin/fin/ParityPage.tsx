import { useEffect, useMemo, useState } from 'react'
import { api } from '@/api/client'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { FinAction, FinAdminGate, FinTable } from './shell'

function DriftChart({ reports }: { reports: Array<Record<string, unknown>> }) {
  const points = useMemo(() => {
    return [...reports]
      .slice()
      .reverse()
      .map((row) => ({
        id: String(row.id || ''),
        bps: Number(row.drift_rate_bps || 0),
        label: String(row.window_start || '').slice(0, 10),
      }))
  }, [reports])
  const max = Math.max(50, ...points.map((p) => p.bps), 1)
  if (!points.length) return null
  return (
    <Card className="mb-4">
      <CardHeader className="pb-2">
        <CardTitle className="text-sm">Drift rate (bps) — last daily windows</CardTitle>
      </CardHeader>
      <CardContent>
        <div className="flex h-32 items-end gap-1">
          {points.map((p) => (
            <div
              key={p.id || p.label}
              className="flex-1 bg-muted"
              style={{ height: `${Math.max(4, (p.bps / max) * 100)}%` }}
              title={`${p.label}: ${p.bps} bps`}
            />
          ))}
        </div>
        <p className="mt-2 text-xs text-muted-foreground">50 bps = R093 cutover block</p>
      </CardContent>
    </Card>
  )
}

export function ParityPage() {
  const [reports, setReports] = useState<Array<Record<string, unknown>>>([])
  const [eligible, setEligible] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [note, setNote] = useState('')

  function reload() {
    void Promise.all([
      api.finGet('/cutover/parity'),
      api.finGet('/cutover/readiness'),
    ]).then(([parity, readiness]) => {
      setReports((parity.reports || []) as Array<Record<string, unknown>>)
      const attestation = (readiness.attestation || {}) as { eligible_to_sign?: boolean }
      setEligible(Boolean(attestation.eligible_to_sign))
    }).catch((err: Error) => setError(err.message))
  }

  useEffect(() => { reload() }, [])

  return (
    <FinAdminGate title="Parity">
      {error ? <p className="text-sm text-red-600">{error}</p> : null}
      <div className="mb-3 flex flex-wrap items-center gap-2">
        {eligible ? (
          <FinAction
            label="Sign attestation"
            onClick={() => {
              void api.finPost('/cutover/attest', { note }).then(() => reload())
            }}
          />
        ) : (
          <span className="text-sm text-muted-foreground">Sign-off gated on 30-day GREEN burn-in.</span>
        )}
        <input
          className="rounded border px-2 py-1 text-sm"
          placeholder="Note (optional)"
          value={note}
          onChange={(e) => setNote(e.target.value)}
          disabled={!eligible}
        />
      </div>
      <DriftChart reports={reports} />
      <FinTable
        columns={[
          'source', 'status', 'drift_rate_bps', 'rows_checked', 'rows_drifted',
          'window_start', 'window_end', 'generated_at',
        ]}
        rows={reports}
      />
    </FinAdminGate>
  )
}
