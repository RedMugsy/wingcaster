import { useEffect, useState } from 'react'
import { api } from '@/api/client'
import { FinAdminGate, FinTable } from './shell'

export function UsagePage() {
  const [level, setLevel] = useState('tenant')
  const [rows, setRows] = useState<Array<Record<string, unknown>>>([])
  useEffect(() => {
    void api.finGet('/usage').then((body) => {
      setLevel(String(body.level || 'tenant'))
      setRows((body.rows || []) as Array<Record<string, unknown>>)
    })
  }, [])
  return (
    <FinAdminGate title="Usage drill">
      <p className="mb-3 text-sm text-muted-foreground">
        Spec §105 hierarchy: tenant → holder → billing_account → book → account_type → posting. Level: {level}
      </p>
      <FinTable columns={['id', 'public_tenant_id', 'status', 'environment']} rows={rows} />
    </FinAdminGate>
  )
}
