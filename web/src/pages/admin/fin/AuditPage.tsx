import { useEffect, useState } from 'react'
import { api } from '@/api/client'
import { FinAdminGate, FinTable } from './shell'

export function AuditPage() {
  const [rows, setRows] = useState<Array<Record<string, unknown>>>([])
  useEffect(() => {
    void api.finGet('/audit').then((body) => setRows((body.events || []) as Array<Record<string, unknown>>))
  }, [])
  return (
    <FinAdminGate title="Audit">
      <FinTable columns={['created_at', 'action', 'target_type', 'actor_email_snapshot', 'reason_code']} rows={rows} />
    </FinAdminGate>
  )
}
