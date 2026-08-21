import { useEffect, useState } from 'react'
import { api } from '@/api/client'
import { FinAction, FinAdminGate, FinTable } from './shell'

export function ReconciliationPage() {
  const [rows, setRows] = useState<Array<Record<string, unknown>>>([])
  function reload() {
    void api.finGet('/reconciliation/runs').then((body) => setRows((body.runs || []) as Array<Record<string, unknown>>))
  }
  useEffect(() => { reload() }, [])
  return (
    <FinAdminGate title="Reconciliation">
      <div className="mb-3">
        <FinAction label="Run now" onClick={() => { void api.finPost('/reconciliation/run').then(() => reload()) }} />
      </div>
      <FinTable columns={['id', 'status', 'scope', 'started_at']} rows={rows} />
    </FinAdminGate>
  )
}
