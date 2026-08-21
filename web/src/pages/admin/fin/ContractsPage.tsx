import { useEffect, useState } from 'react'
import { api } from '@/api/client'
import { FinAdminGate, FinTable } from './shell'

export function ContractsPage() {
  const [rows, setRows] = useState<Array<Record<string, unknown>>>([])
  useEffect(() => {
    void api.finGet('/contracts').then((body) => setRows((body.contracts || []) as Array<Record<string, unknown>>))
  }, [])
  return (
    <FinAdminGate title="Contracts">
      <FinTable columns={['id', 'contract_number', 'status', 'billing_currency']} rows={rows} />
    </FinAdminGate>
  )
}
