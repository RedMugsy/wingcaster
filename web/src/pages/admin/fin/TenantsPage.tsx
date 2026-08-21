import { useEffect, useState } from 'react'
import { api } from '@/api/client'
import { FinAdminGate, FinTable } from './shell'

export function TenantsPage() {
  const [rows, setRows] = useState<Array<Record<string, unknown>>>([])
  useEffect(() => {
    void api.finGet('/tenants').then((body) => setRows((body.tenants || []) as Array<Record<string, unknown>>))
  }, [])
  return (
    <FinAdminGate title="Tenants">
      <p className="mb-3 text-sm text-muted-foreground">Spec §104 tenant credit view.</p>
      <FinTable
        columns={['id', 'public_tenant_id', 'status', 'remaining_units', 'credit_exposure_minor', 'ar_outstanding_minor', 'dunning_status']}
        rows={rows}
      />
    </FinAdminGate>
  )
}
