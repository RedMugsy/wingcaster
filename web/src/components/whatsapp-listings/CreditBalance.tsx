import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'

interface CreditBalanceProps {
  balance: number
  reserved?: number
  threshold?: number
}

export function CreditBalance({ balance, reserved = 0, threshold = 1 }: CreditBalanceProps) {
  const available = balance - reserved
  const low = available < threshold
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-lg">AI Credits</CardTitle>
      </CardHeader>
      <CardContent>
        <div className="flex items-baseline gap-2">
          <span className={`text-3xl font-bold ${low ? 'text-destructive' : ''}`}>{available.toFixed(2)}</span>
          <span className="text-muted-foreground">credits available</span>
        </div>
        {reserved > 0 && <p className="text-sm text-muted-foreground">{reserved.toFixed(2)} reserved</p>}
        {low && <p className="mt-2 text-sm text-destructive">Credit balance is low. Top up soon.</p>}
      </CardContent>
    </Card>
  )
}
