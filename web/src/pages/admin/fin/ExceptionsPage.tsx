import { useEffect, useState } from 'react'
import { api } from '@/api/client'
import { FinAdminGate, FinTable } from './shell'

export function ExceptionsPage() {
  const [rows, setRows] = useState<Array<Record<string, unknown>>>([])
  useEffect(() => {
    void api.finGet('/exceptions').then((body) => setRows((body.types || []) as Array<Record<string, unknown>>))
  }, [])
  return (
    <FinAdminGate title="Exceptions">
      <p className="mb-3 text-sm text-muted-foreground">Spec §107 — 18 exception types.</p>
      <FinTable columns={['type', 'count', 'deferred', 'dl']} rows={rows} />
    </FinAdminGate>
  )
}
