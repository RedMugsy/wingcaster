import { useEffect, useState } from 'react'
import { api } from '@/api/client'
import { FinAdminGate, FinTable } from './shell'

export function HoldsPage() {
  const [rows, setRows] = useState<Array<Record<string, unknown>>>([])
  useEffect(() => {
    void api.finGet('/holds').then((body) => setRows((body.holds || []) as Array<Record<string, unknown>>))
  }, [])
  return (
    <FinAdminGate title="Holds">
      <FinTable columns={['id', 'units', 'status', 'expires_at']} rows={rows} />
    </FinAdminGate>
  )
}
