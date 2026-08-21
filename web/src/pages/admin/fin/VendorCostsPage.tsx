import { useEffect, useState } from 'react'
import { api } from '@/api/client'
import { Card, CardContent } from '@/components/ui/card'
import { FinAdminGate, FinTable } from './shell'

export function VendorCostsPage() {
  const [body, setBody] = useState<Record<string, unknown> | null>(null)
  useEffect(() => {
    void api.finGet('/vendors').then(setBody).catch(() => setBody({ stage11: false, vendors: [] }))
  }, [])
  const vendors = (body?.vendors || []) as Array<Record<string, unknown>>
  return (
    <FinAdminGate title="Vendor costs">
      {body && body.stage11 === false ? (
        <Card>
          <CardContent className="py-6 text-sm text-muted-foreground">
            Stage 11 not merged — vendor rates, statements, and §106 margin drilldown will appear here after rebase.
          </CardContent>
        </Card>
      ) : (
        <FinTable columns={['id', 'code', 'name']} rows={vendors} />
      )}
    </FinAdminGate>
  )
}
