import type { ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { useAuth } from '@/context/AuthContext'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'

export const FIN_NAV = [
  { path: '/admin/fin/overview', label: 'Overview' },
  { path: '/admin/fin/tenants', label: 'Tenants' },
  { path: '/admin/fin/usage', label: 'Usage' },
  { path: '/admin/fin/credits', label: 'Credits' },
  { path: '/admin/fin/holds', label: 'Holds' },
  { path: '/admin/fin/facilities', label: 'Facilities' },
  { path: '/admin/fin/contracts', label: 'Contracts' },
  { path: '/admin/fin/pricing', label: 'Pricing' },
  { path: '/admin/fin/invoices', label: 'Invoices' },
  { path: '/admin/fin/vendor-costs', label: 'Vendor Costs' },
  { path: '/admin/fin/reconciliation', label: 'Reconciliation' },
  { path: '/admin/fin/parity', label: 'Parity' },
  { path: '/admin/fin/exceptions', label: 'Exceptions' },
  { path: '/admin/fin/approvals', label: 'Approvals' },
  { path: '/admin/fin/audit', label: 'Audit' },
  { path: '/admin/fin/configuration', label: 'Configuration' },
]

export function FinAdminGate({ title, children }: { title: string; children: ReactNode }) {
  const { isAdmin } = useAuth()
  if (!isAdmin) {
    return (
      <div className="container mx-auto max-w-2xl px-4 py-8">
        <Card>
          <CardHeader><CardTitle>Platform admin required</CardTitle></CardHeader>
          <CardContent className="text-sm text-muted-foreground">
            {title} is restricted to platform admins.
          </CardContent>
        </Card>
      </div>
    )
  }
  return (
    <div className="container mx-auto px-4 py-8">
      <div className="mb-4 flex flex-wrap gap-2 text-sm">
        {FIN_NAV.map((item) => (
          <Link key={item.path} to={item.path} className="text-muted-foreground hover:underline">
            {item.label}
          </Link>
        ))}
      </div>
      <h1 className="mb-4 text-2xl font-bold">{title}</h1>
      {children}
    </div>
  )
}

export function FinTable({ columns, rows }: { columns: string[]; rows: Array<Record<string, unknown>> }) {
  if (!rows.length) {
    return <p className="text-sm text-muted-foreground">No rows.</p>
  }
  return (
    <Card>
      <CardContent className="p-0">
        <table className="w-full text-sm">
          <thead className="bg-muted/40 text-left">
            <tr>
              {columns.map((col) => (
                <th key={col} className="px-3 py-2 font-medium">{col}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row, idx) => (
              <tr key={String(row.id || idx)} className="border-t">
                {columns.map((col) => (
                  <td key={col} className="px-3 py-2">{String(row[col] ?? '')}</td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </CardContent>
    </Card>
  )
}

export function FinAction({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <Button size="sm" variant="outline" onClick={onClick}>{label}</Button>
  )
}
