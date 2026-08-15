import { useEffect, useState } from 'react'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { isValidMultiplier, multiplierHint } from './helpers'

interface MultiplierInputProps {
  value: number
  onChange: (n: number) => void
  label?: string
  disabled?: boolean
  min?: number
  max?: number
  step?: number
  id?: string
}

export function MultiplierInput({
  value,
  onChange,
  label,
  disabled,
  min = 0.01,
  max = 20,
  step = 0.01,
  id = 'multiplier-input',
}: MultiplierInputProps) {
  const format = (n: number) => Number(n.toFixed(4)).toString()
  const [draft, setDraft] = useState(format(value))

  useEffect(() => {
    setDraft(format(value))
  }, [value])

  const percent = multiplierHint(Number(draft), min, max)

  return (
    <div className="space-y-1">
      {label ? <Label htmlFor={id}>{label}</Label> : null}
      <Input
        id={id}
        type="number"
        inputMode="decimal"
        min={min}
        max={max}
        step={step}
        disabled={disabled}
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={() => {
          const n = Number(draft)
          if (isValidMultiplier(n, min, max)) {
            const clean = Number(n.toFixed(4))
            setDraft(format(clean))
            onChange(clean)
          } else {
            setDraft(format(value))
          }
        }}
      />
      <p className="text-xs text-muted-foreground">≈ {percent}</p>
    </div>
  )
}
