import { useEffect, useState } from 'react'
import { api } from '@/api/client'
import { FinAction, FinAdminGate, FinTable } from './shell'

export function InvoicesPage() {
  const [rows, setRows] = useState<Array<Record<string, unknown>>>([])
  function reload() {
    void api.finGet('/invoices').then((body) => setRows((body.invoices || []) as Array<Record<string, unknown>>))
  }
  useEffect(() => { reload() }, [])
  const first = rows[0]
  return (
    <FinAdminGate title="Invoices">
      <div className="mb-3 flex flex-wrap gap-2">
        <FinAction label="Void" onClick={() => {
          if (!first?.id) return
          void api.finPost(`/invoices/${String(first.id)}/void`).then(() => reload())
        }} />
        <FinAction label="Credit note" onClick={() => {
          if (!first?.id) return
          void api.finPost(`/invoices/${String(first.id)}/credit-note`, { amount_minor: 1 }).then(() => reload())
        }} />
        <FinAction label="Debit note" onClick={() => {
          if (!first?.id) return
          void api.finPost(`/invoices/${String(first.id)}/debit-note`, { amount_minor: 1 }).then(() => reload())
        }} />
      </div>
      <FinTable columns={['id', 'invoice_number', 'status', 'total_minor', 'due_at']} rows={rows} />
    </FinAdminGate>
  )
}
