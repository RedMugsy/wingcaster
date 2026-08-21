import { useState } from 'react'
import { api } from '@/api/client'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Card, CardContent } from '@/components/ui/card'
import { FinAdminGate } from './shell'

export function PricingPage() {
  const [model, setModel] = useState('PER_UNIT')
  const [units, setUnits] = useState('1')
  const [rate, setRate] = useState('100')
  const [result, setResult] = useState<string | null>(null)

  async function simulate() {
    const body = await api.finGet(`/pricing?model=${encodeURIComponent(model)}&billable_units=${units}&unit_rate_minor=${rate}`)
    const sim = body.simulator as { amount_minor?: string } | undefined
    setResult(sim?.amount_minor ?? JSON.stringify(body))
  }

  return (
    <FinAdminGate title="Pricing simulator">
      <Card className="max-w-lg">
        <CardContent className="space-y-3 pt-6">
          <div>
            <Label>Model</Label>
            <Input value={model} onChange={(e) => setModel(e.target.value)} />
          </div>
          <div>
            <Label>Billable units</Label>
            <Input value={units} onChange={(e) => setUnits(e.target.value)} />
          </div>
          <div>
            <Label>Unit rate (minor)</Label>
            <Input value={rate} onChange={(e) => setRate(e.target.value)} />
          </div>
          <Button onClick={() => void simulate()}>Simulate</Button>
          {result ? <p className="text-sm">amount_minor: {result}</p> : null}
        </CardContent>
      </Card>
    </FinAdminGate>
  )
}
