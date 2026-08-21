import { useEffect, useState } from 'react'
import { api } from '@/api/client'
import { FinAction, FinAdminGate, FinTable } from './shell'

export function ApprovalsPage() {
  const [rows, setRows] = useState<Array<Record<string, unknown>>>([])
  function reload() {
    void api.finGet('/approvals').then((body) => setRows((body.approvals || []) as Array<Record<string, unknown>>))
  }
  useEffect(() => { reload() }, [])
  const first = rows[0]
  return (
    <FinAdminGate title="Approvals">
      <p className="mb-3 text-sm text-muted-foreground">Maker-checker. Approve/reject commands are 501 until DecideApproval lands (DL-166).</p>
      <div className="mb-3 flex gap-2">
        <FinAction label="Approve" onClick={() => {
          if (!first?.id) return
          void api.finPost(`/approvals/${String(first.id)}/approve`).then(() => reload())
        }} />
        <FinAction label="Reject" onClick={() => {
          if (!first?.id) return
          void api.finPost(`/approvals/${String(first.id)}/reject`).then(() => reload())
        }} />
      </div>
      <FinTable columns={['id', 'action_kind', 'status', 'created_at']} rows={rows} />
    </FinAdminGate>
  )
}
