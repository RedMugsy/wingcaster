import { useEffect, useState } from 'react'
import { api } from '@/api/client'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { FinAdminGate, FinTable } from './shell'

export function ConfigurationPage() {
  const [body, setBody] = useState<Record<string, unknown> | null>(null)
  useEffect(() => {
    void api.finGet('/configuration').then(setBody)
  }, [])
  const cases = ((body?.dunning_policies || []) as Array<Record<string, unknown>>)
  return (
    <FinAdminGate title="Configuration">
      <Card className="mb-4">
        <CardHeader><CardTitle className="text-sm">Tax registrations</CardTitle></CardHeader>
        <CardContent className="text-sm text-muted-foreground">Placeholder — fin.tax_registrations is not in Stage 12 scope.</CardContent>
      </Card>
      <h2 className="mb-2 text-lg font-semibold">Dunning cases (policy surface)</h2>
      <FinTable columns={['id', 'status', 'created_at']} rows={cases} />
    </FinAdminGate>
  )
}
