import { useEffect, useState } from 'react'
import { api } from '@/api/client'
import { FinAction, FinAdminGate, FinTable } from './shell'

export function FacilitiesPage() {
  const [rows, setRows] = useState<Array<Record<string, unknown>>>([])
  function reload() {
    void api.finGet('/facilities').then((body) => setRows((body.facilities || []) as Array<Record<string, unknown>>))
  }
  useEffect(() => { reload() }, [])
  const first = rows[0]
  function act(path: string, body: Record<string, unknown> = {}) {
    if (!first?.id) return
    void api.finPost(`/facilities/${String(first.id)}${path}`, body).then(() => reload())
  }
  return (
    <FinAdminGate title="Facilities">
      <div className="mb-3 flex flex-wrap gap-2">
        <FinAction label="Pause" onClick={() => act('/pause')} />
        <FinAction label="Resume" onClick={() => act('/resume')} />
        <FinAction label="Suspend" onClick={() => act('/suspend')} />
        <FinAction label="Close" onClick={() => act('/close')} />
      </div>
      <FinTable columns={['id', 'currency', 'limit_minor', 'status', 'net_terms_days']} rows={rows} />
    </FinAdminGate>
  )
}
