import { useEffect, useState } from 'react'
import { api } from '@/api/client'
import { FinAdminGate, FinTable } from './shell'

export function CreditsPage() {
  const [rows, setRows] = useState<Array<Record<string, unknown>>>([])
  useEffect(() => {
    void api.finGet('/credits/lots').then((body) => setRows((body.lots || []) as Array<Record<string, unknown>>))
  }, [])
  return (
    <FinAdminGate title="Credit lots">
      <FinTable
        columns={['id', 'source_kind', 'status', 'granted_units', 'remaining_units', 'consideration_minor', 'expires_at']}
        rows={rows}
      />
    </FinAdminGate>
  )
}
